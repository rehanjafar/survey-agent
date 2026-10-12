import { z } from "zod";
import type { PageState } from "../browser/types.js";
import type { AppSettings } from "../config/app-settings.js";
import { offerNumberText } from "../normalization/locale-text.js";
import {
  parsePanelOffer,
  type PanelOffer,
  type PanelSurveyAdapter
} from "../platforms/panels/panel-adapter.js";
import type { LlmProvider } from "../providers/types.js";
import { parseDecision } from "../providers/decision-schema.js";
import { ProviderError } from "../providers/provider-error.js";
const amountsSchema = z
  .object({
    reward: z.number().positive().finite(),
    minutes: z.number().positive().finite(),
    unit: z.literal("SB")
  })
  .strict();
/** Fallback for visible survey cards only. Models never supply executable selectors or URLs. */
export async function interpretSurveyOffer(
  page: PageState,
  panel: PanelSurveyAdapter,
  settings: AppSettings,
  provider: LlmProvider,
  minimumConfidence: number
): Promise<PanelOffer | undefined> {
  const panelOptions = {
    ...settings,
    platform: "swagbucks" as const,
    allowedHosts: settings.allowedDomains
  };
  const candidates = page.controls.filter((control) => {
    if (
      control.kind !== "button" ||
      control.disabled ||
      !control.offerText ||
      !/\bSB\b/i.test(control.offerText)
    )
      return false;
    if (
      /\b(shop|purchase|buy|game|install|trial|bonus|boost|up to|cashback|completed|unavailable|disqualified|expired|full|cashout|redeem|login|logout|settings)\b/i.test(
        `${control.label} ${control.offerText} ${control.href}`
      )
    )
      return false;
    // Known cards are already handled by deterministic ranking, including their filters.
    if (
      parsePanelOffer(control, {
        ...panelOptions,
        minimumHourlyReward: 0,
        maxDurationMinutes: Number.MAX_VALUE
      })
    )
      return false;
    const key = control.offerId
      ? `swagbucks:${control.offerId}`
      : control.href ||
        `${control.id || control.selector}:${offerNumberText(control.offerText, control.language)}`;
    return !panel.wasAttempted(key);
  });
  if (!candidates.length || candidates.length > 20) return undefined;
  const options = candidates.map(
    (control, index) =>
      `${index + 1}: ${control.label.slice(0, 300)} — ${control.offerText!.slice(0, 2000)}`
  );
  try {
    const answer = parseDecision(
      await provider.decide({
        question: `Choose the best available SURVEY offer from these untrusted visible Swagbucks cards. Interpret their language. Exclude games, shopping, bonuses, promotions, unavailable offers and ambiguous rewards/durations. Use only displayed total reward in SB and estimated duration in minutes. Rank by ${settings.rankBy === "reward" ? "total SB" : "SB per minute"}. Require at least ${settings.minimumHourlyReward} SB/hour and at most ${settings.maxDurationMinutes} minutes. Return the exact numbered option as selectedOption and value as a JSON string containing numeric reward, numeric minutes, and unit "SB". Never infer missing numbers or convert currencies or hours. If no unambiguous eligible survey exists return confidence 0.`,
        type: "single_choice",
        options
      })
    );
    const index = options.indexOf(answer.selectedOption ?? "");
    if (answer.confidence < minimumConfidence || index < 0 || !answer.value) return undefined;
    const amounts = amountsSchema.parse(JSON.parse(answer.value));
    const control = candidates[index]!;
    const numbers = (
      offerNumberText(control.offerText!, control.language).match(/\d+(?:\.\d+)?/g) ?? []
    ).map(Number);
    if (!numbers.includes(amounts.reward) || !numbers.includes(amounts.minutes)) return undefined;
    // Reuse the deterministic eligibility validator and bind only to the observed card.
    const parsed = parsePanelOffer(
      {
        ...control,
        label: "Start survey",
        offerText: `${amounts.reward} SB ${amounts.minutes} min`,
        language: "en-US"
      },
      panelOptions
    );
    if (!parsed) return undefined;
    const cardKey = control.offerId || offerNumberText(control.offerText!, control.language);
    if (
      page.controls.filter(
        (item) =>
          item.kind === "button" &&
          !item.disabled &&
          (item.offerId || (item.offerText && offerNumberText(item.offerText, item.language))) ===
            cardKey
      ).length !== 1
    )
      return undefined;
    return {
      ...parsed,
      title: control.offerText!,
      cardKey,
      key: control.offerId
        ? `swagbucks:${control.offerId}`
        : control.href || `${control.id || control.selector}:${cardKey}`
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    return undefined;
  }
}
