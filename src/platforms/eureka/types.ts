export interface EurekaOffer {
  readonly durationMinutes: number | null;
  readonly enabled: boolean;
  readonly id: string;
  readonly rewardCents: number;
  readonly selector: string;
  readonly title: string;
}

export type EurekaReviewReason =
  | "authentication_required"
  | "captcha_detected"
  | "external_redirect"
  | "no_offers"
  | "unexpected_page";

export type EurekaDiscoveryResult =
  | {
      readonly offers: readonly EurekaOffer[];
      readonly selectedOffer: EurekaOffer;
      readonly status: "ready";
    }
  | {
      readonly reason: EurekaReviewReason;
      readonly status: "review";
    };

export type EurekaOpenResult =
  | {
      readonly offer: EurekaOffer;
      readonly status: "opened";
      readonly url: string;
    }
  | {
      readonly reason: EurekaReviewReason;
      readonly status: "review";
    };

export type EurekaAuditEvent =
  | {
      readonly event: "offers_discovered";
      readonly host: string;
      readonly offerCount: number;
      readonly rewardsCents: readonly number[];
      readonly timestamp: string;
    }
  | {
      readonly event: "offer_selected";
      readonly host: string;
      readonly rewardCents: number;
      readonly timestamp: string;
    }
  | {
      readonly event: "review_required";
      readonly host: string;
      readonly reason: EurekaReviewReason;
      readonly timestamp: string;
    };

export interface EurekaAuditLogger {
  record(event: EurekaAuditEvent): Promise<void>;
}

export interface EurekaSurveyPlatformOptions {
  readonly allowedHosts?: readonly string[];
  readonly auditLogger: EurekaAuditLogger;
  readonly startUrl: string;
}
