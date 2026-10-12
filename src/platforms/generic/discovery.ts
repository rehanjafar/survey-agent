import type { InteractiveControl, PageState } from "../../browser/types.js";

export interface SurveyDestination {
  selector: string;
  key: string;
  kind: "offer" | "hub" | "start";
  unit?: string;
  hourly?: number;
  minutes?: number;
}
const excluded =
  /\b(sign[ -]?in|log[ -]?in|sign[ -]?out|log[ -]?out|register|account|profile|settings|cash.?out|redeem|withdraw|purchase|buy|payment|referral|invite|privacy|terms|consent|agree|accept|completed|unavailable|full)\b/i;
function destination(control: InteractiveControl, pageUrl: string): SurveyDestination | undefined {
  if (control.kind !== "button" || control.disabled) return undefined;
  const label = control.label.trim();
  if (excluded.test(label)) return undefined;
  if (control.href && excluded.test(new URL(control.href, pageUrl).pathname)) return undefined;
  const card = control.offerText || label;
  if (/\b(no places|0 places|unavailable|completed|survey full)\b/i.test(card)) return undefined;
  const minutes = card.match(/\b(\d+(?:\.\d+)?)\s*(?:mins?|minutes?)\b/i)?.[1];
  const reward = card
    .replace(/[$£]\s*\d+(?:\.\d+)?\s*\/\s*(?:hr|hour|h)\b/gi, "")
    .match(/([$£])\s*(\d+(?:\.\d{1,2})?)|\b(\d+(?:\.\d+)?)\s*(points|pts|SB)\b/i);
  const key = control.href || `${pageUrl}:${control.selector}:${label}`;
  const looksLikeStudy =
    /\b(survey|study|participate|start|take|view|begin|open)\b/i.test(label) ||
    /\/(?:surveys?|studies)\//i.test(control.href);
  if (minutes && reward && looksLikeStudy) {
    const duration = Number(minutes);
    const amount = Number(reward[2] ?? reward[3]);
    if (duration > 0 && amount > 0)
      return {
        selector: control.selector,
        key,
        kind: "offer",
        unit: reward[1] || (reward[4]?.toUpperCase() === "SB" ? "SB" : "points"),
        hourly: (amount * 60) / duration,
        minutes: duration
      };
  }
  if (
    /^(?:available |paid |find |view |browse |my |all )?(?:surveys|studies)(?: available)?$|^(?:earn|opportunities|find a survey|take a survey|explore studies)$/i.test(
      label
    )
  )
    return { selector: control.selector, key, kind: "hub" };
  if (
    /^(?:start|begin|open|launch|take|participate in)(?: the| this| a)? (?:survey|study)(?: now)?$|^start now$/i.test(
      label
    )
  )
    return { selector: control.selector, key, kind: "start" };
  return undefined;
}
/** Works from visible page semantics, without a hard-coded platform name or destination URL. */
export function discoverSurveyDestination(
  page: PageState,
  visited: ReadonlySet<string>,
  filters?: { unit: string; minimumHourlyReward: number; maxDurationMinutes: number }
): SurveyDestination | undefined {
  const candidates = page.controls
    .map((control) => destination(control, page.url))
    .filter((item): item is SurveyDestination => !!item && !visited.has(item.key));
  const offers = candidates.filter(
    (item) =>
      item.kind === "offer" &&
      (!filters ||
        (item.unit === filters.unit &&
          item.hourly! >= filters.minimumHourlyReward &&
          item.minutes! <= filters.maxDurationMinutes))
  );
  if (offers.length) {
    // Compare advertised rates only when all offers use the same unit.
    if (new Set(offers.map((item) => item.unit)).size === 1)
      offers.sort((a, b) => b.hourly! - a.hourly!);
    return offers[0];
  }
  const starts = candidates.filter((item) => item.kind === "start");
  if (starts.length === 1) return starts[0];
  const hubs = candidates.filter((item) => item.kind === "hub");
  if (hubs.length === 1) return hubs[0];
  // Desktop/mobile duplicate links with the same destination are equivalent.
  if (hubs.length && new Set(hubs.map((item) => item.key)).size === 1) return hubs[0];
  return undefined;
}
