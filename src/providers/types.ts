import type { QuestionType } from "../domain/survey.js";
export interface ProviderQuestion {
  readonly question: string;
  readonly requiresPersonalFacts?: boolean;
  readonly type: QuestionType;
  readonly options: readonly string[];
  readonly relevantProfileFacts: readonly { key: string; value: string }[];
  readonly rows?: readonly { id: string; label: string; options: readonly string[] }[];
}
export interface ProviderDecision {
  readonly selectedOption?: string;
  readonly value?: string;
  readonly confidence: number;
  readonly reason: string;
  readonly selectedOptions?: readonly string[];
  readonly matrix?: readonly { row: string; option: string }[];
}
export interface LlmProvider {
  readonly canRetrieveConfirmedFacts?: boolean;
  decide(question: ProviderQuestion): Promise<ProviderDecision>;
}
