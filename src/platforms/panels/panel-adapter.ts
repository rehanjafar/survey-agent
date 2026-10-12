import { offerNumberText, minuteDurations } from "../../normalization/locale-text.js";
import type { BrowserSession, InteractiveControl, PageState } from "../../browser/types.js";
import { isAllowedUrl, NavigationBlockedError } from "../../browser/url-policy.js";
import { pageStopReason } from "../../validation/page-safety.js";

export interface PanelOffer {
  readonly selector: string;
  readonly key: string;
  readonly title: string;
  readonly cardKey: string;
  readonly reward: number;
  readonly unit: "USD" | "GBP" | "points" | "SB";
  readonly minutes: number;
  readonly hourlyReward: number;
}
export interface PanelOptions {
  readonly platform: "prolific" | "branded" | "swagbucks";
  readonly rankBy?: "reward_per_minute" | "reward";
  readonly startUrl: string;
  readonly allowedHosts: readonly string[];
  readonly currency: "USD" | "GBP";
  readonly minimumHourlyReward: number;
  readonly maxDurationMinutes: number;
}

/** Only compare offers in the same unit. Points and currencies are never silently converted. */
export function parsePanelOffer(
  control: InteractiveControl,
  options: PanelOptions
): PanelOffer | undefined {
  if (control.kind !== "button" || control.disabled) return undefined;
  const text = offerNumberText(
    control.offerText || [control.label, control.ariaLabel].filter(Boolean).join(" "),
    control.language
  );
  if (
    /\b(full|no places|0 places|unavailable|completed|invite friends|referral|cash out|bonus|boost|up to|cashback|shop|buy|purchase|game|install|trial|disqualified|expired)\b/i.test(
      text
    )
  )
    return undefined;
  // Reject arbitrary account/reward buttons even when a surrounding card mentions money.
  const action = `${control.label} ${control.ariaLabel}`.trim();
  if (
    !control.href &&
    !control.offerId &&
    !/\b(study|survey|start|participate|take|view)\b/i.test(action)
  )
    return undefined;
  if (
    control.href &&
    /\b(login|logout|settings|cashout|redeem|referral|help|shop|discover|games|purchase|rewards-store)\b/i.test(
      control.href
    )
  )
    return undefined;
  const durations = minuteDurations(text, control.language);
  if (!durations.length || new Set(durations).size !== 1) return undefined;
  const minutes = durations[0]!;
  if (minutes <= 0 || minutes > options.maxDurationMinutes) return undefined;
  const unit =
    options.platform === "swagbucks"
      ? "SB"
      : options.platform === "branded"
        ? "points"
        : options.currency;
  // Hourly rates shown alongside the total reward are not the reward itself.
  const withoutHourlyRates = text.replace(
    /(?:[$£]\s*\d+(?:\.\d+)?|\bSB\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:USD|GBP|points|pts|SB))\s*(?:\/\s*(?:hr|hour|h)\b|per\s+hour\b)/gi,
    ""
  );
  const pattern =
    unit === "SB"
      ? /\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*SB\b|\bSB\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\b/gi
      : unit === "points"
        ? /\b(\d+(?:\.\d+)?)\s*(?:points|pts)\b/gi
        : unit === "USD"
          ? /\$\s*(\d+(?:\.\d{1,2})?)|\b(\d+(?:\.\d{1,2})?)\s*USD\b/gi
          : /£\s*(\d+(?:\.\d{1,2})?)|\b(\d+(?:\.\d{1,2})?)\s*GBP\b/gi;
  // A card containing both currencies needs review, not an implicit exchange rate.
  if ((unit === "USD" && /£|\bGBP\b/.test(text)) || (unit === "GBP" && /\$|\bUSD\b/.test(text)))
    return undefined;
  if (unit === "SB" && /[$£]|\b(?:USD|GBP|points|pts)\b/i.test(withoutHourlyRates))
    return undefined;
  const amounts = [...withoutHourlyRates.matchAll(pattern)].map((match) =>
    Number((match[1] ?? match[2])!.replaceAll(",", ""))
  );
  if (!amounts.length || new Set(amounts).size !== 1) return undefined;
  const reward = amounts[0]!;
  const hourlyReward = (reward * 60) / minutes;
  if (!Number.isFinite(hourlyReward) || reward <= 0 || hourlyReward < options.minimumHourlyReward)
    return undefined;
  return {
    selector: control.selector,
    key: control.offerId
      ? `${options.platform}:${control.offerId}`
      : control.href || `${control.id || control.selector}:${text}`,
    title: text,
    cardKey: control.offerId || text,
    reward,
    unit,
    minutes,
    hourlyReward
  };
}

export function rankPanelOffers(
  controls: readonly InteractiveControl[],
  options: PanelOptions
): PanelOffer[] {
  const offers = controls
    .map((control) => parsePanelOffer(control, options))
    .filter((offer): offer is PanelOffer => !!offer);
  // Multiple actionable controls in one card are ambiguous; never guess which starts it.
  const counts = new Map<string, number>();
  for (const offer of offers) counts.set(offer.cardKey, (counts.get(offer.cardKey) ?? 0) + 1);
  return offers
    .filter((offer) => counts.get(offer.cardKey) === 1)
    .sort(
      (a, b) =>
        (options.rankBy === "reward" ? b.reward - a.reward : b.hourlyReward - a.hourlyReward) ||
        a.minutes - b.minutes ||
        b.reward - a.reward
    );
}

export class PanelSurveyAdapter {
  private readonly attempted = new Set<string>();
  private readonly allowed: ReadonlySet<string>;
  public constructor(
    private readonly session: BrowserSession,
    private readonly options: PanelOptions
  ) {
    this.allowed = new Set(options.allowedHosts);
  }
  public markAttempted(key: string): void {
    this.attempted.add(key);
  }
  private review(state: PageState): string | undefined {
    return !isAllowedUrl(state.url, this.allowed) ? "external_redirect" : pageStopReason(state);
  }
  public async discoverOffers(): Promise<
    { status: "ready"; offers: PanelOffer[] } | { status: "review"; reason: string }
  > {
    const state = await this.session.capturePageState();
    const reason = this.review(state);
    if (reason) return { status: "review", reason };
    // Discovery is valid only on this platform, never on an external survey page.
    if (new URL(state.url).origin !== new URL(this.options.startUrl).origin)
      return { status: "review", reason: "unexpected_page" };
    const offers = rankPanelOffers(state.controls, this.options).filter(
      (offer) => !this.attempted.has(offer.key)
    );
    return offers.length
      ? { status: "ready", offers }
      : { status: "review", reason: "no_matching_offers" };
  }
  public async openBestOffer(): Promise<
    { status: "opened"; offer: PanelOffer; url: string } | { status: "review"; reason: string }
  > {
    try {
      const discovered = await this.discoverOffers();
      if (discovered.status === "review") return discovered;
      const offer = discovered.offers[0]!;
      this.markAttempted(offer.key);
      let selector = offer.selector;
      let pageUrl = this.options.startUrl;
      const clicked = new Set<string>();
      for (let hop = 0; hop < 3; hop++) {
        const actionKey = `${pageUrl}:${selector}`;
        if (clicked.has(actionKey))
          return { status: "review", reason: "study_handoff_did_not_advance" };
        clicked.add(actionKey);
        await this.session.clickAndDetectNavigation(selector);
        const state = await this.session.capturePageState();
        const reason = this.review(state);
        if (reason) return { status: "review", reason };
        if (new URL(state.url).origin !== new URL(this.options.startUrl).origin) {
          return { status: "opened", offer, url: state.url };
        }
        // Prolific exposes a study details page before the external study handoff.
        // Never accept consent, enter a completion code, cash out, or click generic Continue here.
        const starts = state.controls.filter(
          (control) =>
            control.kind === "button" &&
            !control.disabled &&
            /^(start now|start study|start survey|take survey|open study)$/i.test(
              control.label.trim()
            )
        );
        if (starts.length !== 1) return { status: "review", reason: "ambiguous_study_handoff" };
        pageUrl = state.url;
        selector = starts[0]!.selector;
      }
      return { status: "review", reason: "study_handoff_limit" };
    } catch (error) {
      if (error instanceof NavigationBlockedError)
        return { status: "review", reason: "external_redirect" };
      throw error;
    }
  }
}
