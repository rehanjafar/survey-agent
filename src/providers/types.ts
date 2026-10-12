import type { QuestionType } from "../domain/survey.js";
export interface ProviderQuestion {
  readonly question: string;
  readonly language?: string;
  readonly resolution?: "best_supported_answer";
  readonly type: QuestionType;
  readonly options: readonly string[];
  readonly rows?: readonly { id: string; label: string; options: readonly string[] }[];
}
export interface ProviderDecision {
  readonly selectedOption?: string;
  readonly value?: string;
  readonly basis?: "objective" | "personal_context" | "abstention";
  readonly confidence: number;
  readonly reason: string;
  readonly selectedOptions?: readonly string[];
  readonly matrix?: readonly { row: string; option: string }[];
}
export interface LlmProvider {
  decide(question: ProviderQuestion): Promise<ProviderDecision>;
}
