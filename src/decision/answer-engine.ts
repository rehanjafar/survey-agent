import type { NormalizedQuestion, ReviewRequired, SurveyAction } from "../domain/survey.js";
import type { LlmProvider } from "../providers/types.js";
import type { SqliteStore } from "../storage/sqlite-store.js";
export type DecisionResult =
  | { readonly status: "action"; readonly action: SurveyAction; readonly source: "cache" | "llm" }
  | ReviewRequired;
export class AnswerDecisionEngine {
  public constructor(
    private readonly store: SqliteStore,
    private readonly provider: LlmProvider,
    private readonly minimumConfidence = 0.85
  ) {}
  public async decide(question: NormalizedQuestion): Promise<DecisionResult> {
    const cached = this.store.cachedAnswer(question.fingerprint);
    if (cached && cached.confidence >= this.minimumConfidence)
      return this.actionFor(question, cached.answer, "cache", cached.confidence);
    const decision = await this.provider.decide({
      question: question.prompt,
      type: question.type,
      options: question.options.map((option) => option.label),
      relevantProfileFacts: this.store
        .relevantFacts(question.prompt)
        .map(({ key, value }) => ({ key, value }))
    });
    if (decision.confidence < this.minimumConfidence)
      return this.review(
        "low_confidence",
        `Model confidence ${decision.confidence} is below ${this.minimumConfidence}.`
      );
    const answer = decision.selectedOption ?? decision.value;
    if (!answer)
      return this.review("unsupported_question", "Provider returned no executable answer.");
    this.store.saveAnswer({
      fingerprint: question.fingerprint,
      answer,
      confidence: decision.confidence
    });
    return this.actionFor(question, answer, "llm", decision.confidence);
  }
  private actionFor(
    question: NormalizedQuestion,
    answer: string,
    source: "cache" | "llm",
    confidence: number
  ): DecisionResult {
    const option = question.options.find(
      (candidate) => candidate.label === answer || candidate.id === answer
    );
    if (["single_choice", "scale"].includes(question.type) && option)
      return {
        status: "action",
        source,
        action: { kind: "select_one", selector: option.selector }
      };
    if (question.type === "dropdown" && option?.value !== undefined)
      return {
        status: "action",
        source,
        action: { kind: "select_dropdown", selector: option.selector, value: option.value }
      };
    if (["text", "numeric"].includes(question.type) && question.inputSelector)
      return {
        status: "action",
        source,
        action: { kind: "fill", selector: question.inputSelector, value: answer }
      };
    return this.review(
      "unsupported_question",
      `Answer cannot be validated for ${question.type} at confidence ${confidence}.`
    );
  }
  private review(reason: ReviewRequired["reason"], detail: string): ReviewRequired {
    this.store.recordReview(reason, detail);
    return { status: "review", reason, detail };
  }
}
