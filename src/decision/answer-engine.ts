import { optionRepresentsFact } from "./profile-matching.js";
import { ProviderError } from "../providers/provider-error.js";
import type { PageState } from "../browser/types.js";
import type { NormalizedQuestion, ReviewRequired, SurveyAction } from "../domain/survey.js";
import type { LlmProvider, ProviderDecision, ProviderQuestion } from "../providers/types.js";
import { parseDecision } from "../providers/decision-schema.js";
import type { SqliteStore } from "../storage/sqlite-store.js";
import { validateAnswer } from "../validation/answer-validation.js";
export type DecisionResult =
  | {
      readonly status: "action";
      readonly action: SurveyAction;
      readonly source: "cache" | "profile" | "llm" | "human" | "survey_memory";
      readonly answer?: ProviderDecision;
    }
  | ReviewRequired;
export function providerQuestion(
  question: NormalizedQuestion,
  store: SqliteStore
): ProviderQuestion {
  return {
    question: question.prompt,
    requiresPersonalFacts:
      Boolean(question.factKey) ||
      /^(country|age|gender|income|occupation|household size)[?*: ]*$/i.test(question.prompt) ||
      /\b(your|you (?:live|own|prefer|work|earn|feel))\b/i.test(question.prompt),
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
    private readonly minimumConfidence = 0.9,
    private readonly fallbackProvider?: LlmProvider
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
    const matches = fact
      ? question.options.filter((option) => optionRepresentsFact(fact.value, option.label))
      : [];
    if (fact && (["text", "numeric"].includes(question.type) || matches.length === 1)) {
      const answer: ProviderDecision = ["text", "numeric"].includes(question.type)
        ? { value: fact.value, confidence: 1, reason: "Established profile fact." }
        : {
            selectedOption: matches[0]!.label,
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
        return this.validate(question, answer, "cache");
      } catch {
        return this.review("contradiction", "Stored answer no longer matches this question.");
      }
    }
    const payload = providerQuestion(question, this.store);
    if (payload.relevantProfileFacts.length === 0 && payload.requiresPersonalFacts)
      return this.provider.canRetrieveConfirmedFacts
        ? this.fromFallback(question, payload, this.provider)
        : this.fallbackProvider?.canRetrieveConfirmedFacts
          ? this.fromFallback(question, payload)
          : this.review(
              "missing_information",
              "Add the relevant profile fact or supply an answer in the review panel."
            );
    try {
      const decision = this.validate(question, await this.provider.decide(payload), "llm");
      if (
        decision.status === "review" &&
        this.fallbackProvider &&
        ["low_confidence", "unsupported_question"].includes(decision.reason)
      )
        return this.fromFallback(question, payload);
      return decision;
    } catch (error) {
      if (this.fallbackProvider) return this.fromFallback(question, payload);
      return this.review(
        error instanceof ProviderError ? error.reviewReason : "provider_error",
        error instanceof ProviderError
          ? error.message
          : "The provider could not return a valid answer. Run Test ChatGPT in Connections & setup to check the connection.",
        error instanceof ProviderError ? error.reviewHost : undefined
      );
    }
  }
  private async fromFallback(
    question: NormalizedQuestion,
    payload: ProviderQuestion,
    provider: LlmProvider = this.fallbackProvider!
  ): Promise<DecisionResult> {
    try {
      return this.validate(question, await provider.decide(payload), "llm");
    } catch (error) {
      return this.review(
        error instanceof ProviderError ? error.reviewReason : "provider_error",
        error instanceof ProviderError
          ? error.message
          : "The ordinary-chat fallback could not answer. Inspect the chat before resuming.",
        error instanceof ProviderError ? error.reviewHost : undefined
      );
    }
  }
  /** Ask only about observed control labels; the model cannot invent URLs or selectors. */
  public async navigation(
    page: PageState
  ): Promise<{ selector: string; submit: boolean } | undefined> {
    const candidates = page.controls.filter(
      (control) =>
        control.kind === "button" &&
        !control.disabled &&
        /\b(next|continue|proceed|begin|start|launch|ready|survey|study)\b|^[→›»]$/i.test(
          control.label
        ) &&
        !/\b(consent|agree|accept|purchase|buy|pay|delete|withdraw|return|cancel|back|login|sign|account|settings|privacy|terms|help|logout|cash|redeem|submit|finish|complete)\b/i.test(
          control.label
        )
    );
    if (!candidates.length || candidates.length > 20) return undefined;
    const options = candidates.map(
      (control, index) => `${index + 1}: ${control.label.slice(0, 300)}`
    );
    try {
      const answer = parseDecision(
        await this.provider.decide({
          question:
            "Which ONE of these visible controls proceeds to the next survey/study page? Choose only an unambiguous continuation or start action. Never choose consent, account changes, payments, completion codes or final submission. If unclear return confidence 0.",
          type: "single_choice",
          options,
          relevantProfileFacts: []
        })
      );
      const index = options.indexOf(answer.selectedOption ?? "");
      if (answer.confidence < this.minimumConfidence || index < 0) return undefined;
      return { selector: candidates[index]!.selector, submit: false };
    } catch (error) {
      if (error instanceof ProviderError && error.reviewReason !== "provider_error") throw error;
      return undefined;
    }
  }
  public replay(question: NormalizedQuestion, answer: ProviderDecision): DecisionResult {
    return this.validate(question, answer, "survey_memory");
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
    source: "cache" | "profile" | "llm" | "human" | "survey_memory"
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
    if (fact && value !== undefined && !optionRepresentsFact(fact.value, value))
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
      return { status: "action", action, source, answer };
    } catch {
      return this.review(
        "unsupported_question",
        "The answer does not match the question's controls or constraints."
      );
    }
  }
  private review(
    reason: ReviewRequired["reason"],
    detail: string,
    reviewHost?: string
  ): ReviewRequired {
    this.store.recordReview(reason, detail);
    return { status: "review", reason, detail, ...(reviewHost ? { reviewHost } : {}) };
  }
}
