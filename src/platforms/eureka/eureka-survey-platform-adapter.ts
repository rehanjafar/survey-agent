import { pageStopReason } from "../../validation/page-safety.js";
import { isAllowedUrl, NavigationBlockedError } from "../../browser/url-policy.js";
import type { BrowserSession, InteractiveControl, PageState } from "../../browser/index.js";

import type {
  EurekaDiscoveryResult,
  EurekaOffer,
  EurekaOpenResult,
  EurekaReviewReason,
  EurekaSurveyPlatformOptions
} from "./types.js";

const DURATION_PATTERN = /\b(\d+)\s*(?:min|mins|minutes)\b/i;
const DOLLAR_PATTERN = /\$\s*(\d+(?:\.\d{1,2})?)/;
const CENTS_PATTERN = /\b(\d+(?:\.\d+)?)\s*(?:¢|cents?\b)/i;

export class EurekaSurveyPlatformAdapter {
  private readonly allowedHosts: ReadonlySet<string>;

  public constructor(
    private readonly session: BrowserSession,
    private readonly options: EurekaSurveyPlatformOptions
  ) {
    this.allowedHosts = new Set(
      options.allowedHosts?.map((host) => host.toLowerCase()) ?? [
        new URL(options.startUrl).hostname
      ]
    );
  }

  public async discoverOffers(): Promise<EurekaDiscoveryResult> {
    const state = await this.session.capturePageState();
    const reviewReason = this.reviewReasonFor(state);
    if (reviewReason) {
      await this.recordReview(reviewReason, state.url);
      return { status: "review", reason: reviewReason };
    }

    const offers = rankOffers(
      state.controls
        .map((control) => offerFromControl(control))
        .filter((offer): offer is EurekaOffer => offer !== null),
      this.options.rankBy
    );

    if (offers.length === 0) {
      await this.recordReview("no_offers", state.url);
      return { status: "review", reason: "no_offers" };
    }

    await this.options.auditLogger.record({
      event: "offers_discovered",
      host: safeHost(state.url),
      offerCount: offers.length,
      rewardsCents: offers.map((offer) => offer.rewardCents),
      timestamp: new Date().toISOString()
    });

    return { status: "ready", offers, selectedOffer: offers[0]! };
  }

  public async openHighestRewardOffer(): Promise<EurekaOpenResult> {
    const discovery = await this.discoverOffers();
    if (discovery.status === "review") {
      return discovery;
    }

    const selectedOffer = discovery.selectedOffer;
    let navigation;
    try {
      navigation = await this.session.clickAndDetectNavigation(selectedOffer.selector);
    } catch (error) {
      if (!(error instanceof NavigationBlockedError)) throw error;
      await this.recordReview("external_redirect", this.session.currentUrl());
      return { status: "review", reason: "external_redirect" };
    }
    if (!navigation.navigated) {
      await this.recordReview("unexpected_page", navigation.url);
      return { status: "review", reason: "unexpected_page" };
    }

    if (!isAllowedHost(navigation.url, this.allowedHosts)) {
      await this.recordReview("external_redirect", navigation.url);
      return { status: "review", reason: "external_redirect" };
    }

    const state = await this.session.capturePageState();
    const reviewReason = this.reviewReasonFor(state);
    if (reviewReason) {
      await this.recordReview(reviewReason, state.url);
      return { status: "review", reason: reviewReason };
    }
    await this.options.auditLogger.record({
      event: "offer_selected",
      host: safeHost(navigation.url),
      rewardCents: selectedOffer.rewardCents,
      timestamp: new Date().toISOString()
    });

    return { status: "opened", offer: selectedOffer, url: navigation.url };
  }

  private reviewReasonFor(state: PageState): EurekaReviewReason | undefined {
    if (!isAllowedHost(state.url, this.allowedHosts)) {
      return "external_redirect";
    }

    return pageStopReason(state);
  }

  private async recordReview(reason: EurekaReviewReason, url: string): Promise<void> {
    await this.options.auditLogger.record({
      event: "review_required",
      host: safeHost(url),
      reason,
      timestamp: new Date().toISOString()
    });
  }
}

export function parseRewardCents(text: string): number | null {
  const dollarMatch = text.match(DOLLAR_PATTERN)?.[1];
  if (dollarMatch) {
    return Math.round(Number(dollarMatch) * 100);
  }

  const centsMatch = text.match(CENTS_PATTERN)?.[1];
  if (centsMatch) {
    return Math.round(Number(centsMatch));
  }

  return null;
}

export function rankOffers(
  offers: readonly EurekaOffer[],
  rankBy: "reward" | "reward_per_minute" = "reward"
): EurekaOffer[] {
  return offers
    .filter((offer) => offer.enabled && offer.rewardCents > 0)
    .sort((left, right) =>
      rankBy === "reward_per_minute"
        ? (right.durationMinutes && right.durationMinutes > 0
            ? right.rewardCents / right.durationMinutes
            : 0) -
            (left.durationMinutes && left.durationMinutes > 0
              ? left.rewardCents / left.durationMinutes
              : 0) || right.rewardCents - left.rewardCents
        : right.rewardCents - left.rewardCents
    );
}

function offerFromControl(control: InteractiveControl): EurekaOffer | null {
  if (control.kind !== "button" || control.disabled) {
    return null;
  }

  const text = [control.label, control.ariaLabel, control.value].filter(Boolean).join(" ");
  const rewardCents = parseRewardCents(text);
  if (!rewardCents || rewardCents <= 0) {
    return null;
  }

  return {
    durationMinutes: parseDurationMinutes(text),
    enabled: !control.disabled,
    id: control.id || control.selector,
    rewardCents,
    selector: control.selector,
    title: titleFromOfferText(text)
  };
}

function parseDurationMinutes(text: string): number | null {
  const duration = text.match(DURATION_PATTERN)?.[1];
  return duration ? Number(duration) : null;
}

function titleFromOfferText(text: string): string {
  return text
    .replace(DOLLAR_PATTERN, "")
    .replace(CENTS_PATTERN, "")
    .replace(DURATION_PATTERN, "")
    .replace(/[—–|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAllowedHost(url: string, allowedHosts: ReadonlySet<string>): boolean {
  return isAllowedUrl(url, allowedHosts);
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid-url";
  }
}
