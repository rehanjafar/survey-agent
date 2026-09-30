import type { QuestionType } from "../domain/survey.js";
export interface ProviderQuestion {
  readonly question: string;
  readonly type: QuestionType;
  readonly options: readonly string[];
  readonly relevantProfileFacts: readonly { key: string; value: string }[];
}
export interface ProviderDecision {
  readonly selectedOption?: string;
  readonly value?: string;
  readonly confidence: number;
  readonly reason: string;
}
export interface LlmProvider {
  decide(question: ProviderQuestion): Promise<ProviderDecision>;
}
