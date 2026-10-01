export type QuestionType =
  "single_choice" | "multiple_choice" | "dropdown" | "text" | "numeric" | "scale" | "matrix";
export interface SurveyOption {
  readonly id: string;
  readonly label: string;
  readonly selector: string;
  readonly value?: string;
}
export interface MatrixRow {
  readonly id: string;
  readonly label: string;
  readonly options: readonly SurveyOption[];
}
export interface NormalizedQuestion {
  readonly fingerprint: string;
  readonly prompt: string;
  readonly required: boolean;
  readonly type: QuestionType;
  readonly options: readonly SurveyOption[];
  readonly rows: readonly MatrixRow[];
  readonly inputSelector?: string;
  readonly factKey?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly maxLength?: number;
}
export type SurveyAction =
  | { readonly kind: "select_one"; readonly selector: string }
  | {
      readonly kind: "set_many";
      readonly selections: readonly { selector: string; checked: boolean }[];
    }
  | { readonly kind: "select_dropdown"; readonly selector: string; readonly value: string }
  | { readonly kind: "fill"; readonly selector: string; readonly value: string }
  | { readonly kind: "answer_matrix"; readonly selections: readonly { selector: string }[] }
  | { readonly kind: "continue"; readonly selector: string };
export type ReviewReason =
  | "authentication_required"
  | "captcha_detected"
  | "contradiction"
  | "low_confidence"
  | "no_question_found"
  | "unexpected_page"
  | "provider_error"
  | "missing_information"
  | "submission_confirmation"
  | "step_limit"
  | "unsupported_question";
export interface ReviewRequired {
  readonly status: "review";
  readonly reason: ReviewReason;
  readonly detail: string;
}
