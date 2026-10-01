import type { NormalizedQuestion, ReviewRequired, SurveyAction } from "../domain/survey.js";
import type { LlmProvider, ProviderDecision, ProviderQuestion } from "../providers/types.js";
import { parseDecision } from "../providers/decision-schema.js";
import type { SqliteStore } from "../storage/sqlite-store.js";
import { normalizeText } from "../normalization/question-normalizer.js";
import { validateAnswer } from "../validation/answer-validation.js";
export type DecisionResult =
  | {
      readonly status: "action";
      readonly action: SurveyAction;
      readonly source: "cache" | "profile" | "llm" | "human";
      readonly answer?: ProviderDecision;
    }
  | ReviewRequired;
export function providerQuestion(
  question: NormalizedQuestion,
  store: SqliteStore
): ProviderQuestion {
  return {
    question: question.prompt,
    type: question.type,
    options: question.options.map((option) => option.label),
    relevantProfileFacts: store
      .relevantFacts(question.factKey ?? question.prompt)
      .filter((fact) => fact.established)
      .map(({ key, value }) => ({ key, value })),
    ...(question.rows.length
      ? {
          rows: question.rows.map((row) => ({
            id: row.id,
            label: row.label,
            options: row.options.map((option) => option.label)
          }))
        }
      : {})
  };
}
export class AnswerDecisionEngine {
  public constructor(
    private readonly store: SqliteStore,
    private readonly provider: LlmProvider,
    private readonly minimumConfidence = 0.9
  ) {}
  public async decide(question: NormalizedQuestion): Promise<DecisionResult> {
    // A semantic binding must be established by the extractor or a site adapter, never the model.
    const fact = question.factKey
      ? this.store
          .facts()
          .find(
            (item) => item.key === question.factKey && item.established && item.kind !== "temporary"
          )
      : undefined;
    if (fact) {
      const answer: ProviderDecision = ["text", "numeric"].includes(question.type)
        ? { value: fact.value, confidence: 1, reason: "Established profile fact." }
        : {
            selectedOption:
              question.options.find(
                (option) => normalizeText(option.label) === normalizeText(fact.value)
              )?.label ?? fact.value,
            confidence: 1,
            reason: "Established profile fact."
          };
      return this.validate(question, answer, "profile");
    }
    const cached = this.store.cachedAnswer(question.fingerprint);
    if (cached && cached.confidence >= this.minimumConfidence) {
      try {
        // Old scalar mappings remain readable; new mappings are structured and selector-free.
        const answer = cached.answer.startsWith("{")
          ? (parseDecision(JSON.parse(cached.answer)) as ProviderDecision)
          : {
              selectedOption: cached.answer,
              confidence: cached.confidence,
              reason: "Previously confirmed answer."
            };
        return this.validate(question, answer, "cache", false);
      } catch {
        return this.review("contradiction", "Stored answer no longer matches this question.");
      }
    }
    const payload = providerQuestion(question, this.store);
    if (payload.relevantProfileFacts.length === 0)
      return this.review(
        "missing_information",
        "Add the relevant profile fact or supply an answer in the review panel."
      );
    try {
      return this.validate(question, await this.provider.decide(payload), "llm");
    } catch {
      return this.review(
        "provider_error",
        "The provider could not return a valid answer. Check credentials, model, quota and connectivity."
      );
    }
  }
  public human(question: NormalizedQuestion, answer: ProviderDecision): DecisionResult {
    return this.validate(question, { ...answer, confidence: 1 }, "human");
  }
  public remember(question: NormalizedQuestion, answer: ProviderDecision): void {
    // Called only after the browser has verified the action.
    this.store.saveAnswer({
      fingerprint: question.fingerprint,
      answer: JSON.stringify({ ...answer, reason: "" }),
      confidence: answer.confidence
    });
  }
  private validate(
    question: NormalizedQuestion,
    input: ProviderDecision,
    source: "cache" | "profile" | "llm" | "human",
    includeAnswer = true
  ): DecisionResult {
    const answer = parseDecision(input) as ProviderDecision;
    if (answer.confidence < this.minimumConfidence)
      return this.review("low_confidence", "The answer needs your confirmation.");
    const fact = question.factKey
      ? this.store
          .facts()
          .find(
            (item) => item.key === question.factKey && item.established && item.kind !== "temporary"
          )
      : undefined;
    const value = answer.value ?? answer.selectedOption;
    if (fact && value !== undefined && normalizeText(fact.value) !== normalizeText(value))
      return this.review("contradiction", "The answer conflicts with an established profile fact.");
    const remembered = this.store.cachedAnswer(question.fingerprint);
    if (remembered && source === "human") {
      try {
        const old: Partial<ProviderDecision> = remembered.answer.startsWith("{")
          ? (JSON.parse(remembered.answer) as ProviderDecision)
          : { selectedOption: remembered.answer };
        if (
          JSON.stringify([old.selectedOption, old.selectedOptions, old.value, old.matrix]) !==
          JSON.stringify([
            answer.selectedOption,
            answer.selectedOptions,
            answer.value,
            answer.matrix
          ])
        )
          return this.review(
            "contradiction",
            "This differs from a saved answer. Clear the answer memory explicitly before replacing it."
          );
      } catch {
        return this.review("contradiction", "Saved answer needs review before replacement.");
      }
    }
    try {
      const action = validateAnswer(question, answer);
      return { status: "action", action, source, ...(includeAnswer ? { answer } : {}) };
    } catch {
      return this.review(
        "unsupported_question",
        "The answer does not match the question's controls or constraints."
      );
    }
  }
  private review(reason: ReviewRequired["reason"], detail: string): ReviewRequired {
    this.store.recordReview(reason, detail);
    return { status: "review", reason, detail };
  }
}
