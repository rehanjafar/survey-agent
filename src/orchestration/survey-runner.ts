import type { BrowserSession, PageState } from "../browser/index.js";
import { isAllowedUrl, NavigationBlockedError } from "../browser/url-policy.js";
import { extractCurrentQuestion } from "../extraction/question-extractor.js";
import { executeAction } from "../execution/action-executor.js";
import type { AnswerDecisionEngine } from "../decision/answer-engine.js";
import { pageStopReason } from "../validation/page-safety.js";
export { pageStopReason } from "../validation/page-safety.js";
import type { ReviewNotifier } from "../notifications/ntfy-notifier.js";

export interface RunnerOptions {
  readonly session: BrowserSession;
  readonly engine: Pick<AnswerDecisionEngine, "decide">;
  readonly allowedDomains: ReadonlySet<string>;
  readonly authenticationDomains?: ReadonlySet<string>;
  readonly notifier: ReviewNotifier;
  readonly openOffer: () => Promise<{ status: "opened" | "review"; reason?: string }>;
  readonly startUrl: string;
  readonly maxSurveys: number;
  readonly maxSteps: number;
  readonly reviewTimeoutMs: number;
  readonly pollMs?: number;
  readonly surveyPageAllowed?: (state: PageState) => boolean;
  readonly signal?: AbortSignal;
  readonly wait?: (ms: number) => Promise<void>;
}
export interface RunnerResult {
  readonly status: "finished" | "review";
  readonly reason: string;
  readonly surveys: number;
}

/** Only deterministic validated actions run; model text never drives navigation or selectors. */
export async function runSurveys(options: RunnerOptions): Promise<RunnerResult> {
  const { session, notifier } = options;
  const wait = options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let surveys = 0;
  const notify = async (reason: string): Promise<void> => {
    let host = "unknown";
    try {
      host = new URL(session.currentUrl()).hostname;
    } catch {
      /* No raw URL in alerts. */
    }
    if (reason === "external_redirect") host = session.blockedNavigationHost?.() ?? host;
    await notifier.notify({ reason, host });
  };
  const stop = async (reason: string): Promise<RunnerResult> => {
    await notify(reason);
    return { status: "review", reason, surveys };
  };
  const capture = async (): Promise<PageState> => {
    const state = await session.capturePageState();
    if (
      !isAllowedUrl(state.url, options.allowedDomains) &&
      !isAllowedUrl(state.url, options.authenticationDomains ?? new Set())
    )
      throw new NavigationBlockedError("Unexpected survey host.");
    return state;
  };
  const stateStopReason = (state: PageState): string | undefined =>
    !isAllowedUrl(state.url, options.allowedDomains) ||
    isAllowedUrl(state.url, options.authenticationDomains ?? new Set())
      ? "authentication_required"
      : pageStopReason(state);
  const pause = async (reason: string): Promise<boolean> => {
    await notify(reason);
    const until = Date.now() + options.reviewTimeoutMs;
    let clearCount = 0;
    while (Date.now() < until && !options.signal?.aborted) {
      await wait(options.pollMs ?? 2000);
      const current = await capture();
      if (stateStopReason(current)) clearCount = 0;
      else if (++clearCount >= 2) return true;
    }
    return false;
  };
  try {
    while (surveys < options.maxSurveys) {
      if (options.signal?.aborted) return { status: "finished", reason: "interrupted", surveys };
      const initial = await capture();
      const initialStop = stateStopReason(initial);
      if (initialStop && !(await pause(initialStop)))
        return { status: "review", reason: initialStop, surveys };
      const opened = await options.openOffer();
      if (opened.status === "review") {
        const landingStop = stateStopReason(await capture());
        if (landingStop === "authentication_required" || landingStop === "captcha_detected")
          opened.reason = landingStop;
        if (opened.reason === "captcha_detected" || opened.reason === "authentication_required") {
          if (!(await pause(opened.reason)))
            return { status: "review", reason: opened.reason, surveys };
          // The offer may already have opened; never click another offer blindly.
        } else return await stop(opened.reason ?? "unexpected_page");
      }
      let completed = false;
      for (let step = 0; step < options.maxSteps; step++) {
        if (options.signal?.aborted) return { status: "finished", reason: "interrupted", surveys };
        let state = await capture();
        const reason = stateStopReason(state);
        if (reason) {
          if (!(await pause(reason))) return { status: "review", reason, surveys };
          state = await capture();
        }
        if (
          /\b(thank you for completing|survey completed|survey complete|you have been disqualified|not eligible for this survey)\b/i.test(
            state.text
          ) &&
          !extractCurrentQuestion(state)
        ) {
          surveys++;
          completed = true;
          await session.navigate(options.startUrl);
          break;
        }
        if (options.surveyPageAllowed && !options.surveyPageAllowed(state))
          return await stop("platform_page_requires_review");
        const question = extractCurrentQuestion(state);
        if (!question) return await stop("no_question_found");
        const decision = await options.engine.decide(question);
        if (decision.status !== "action") return await stop(decision.reason);
        const latest = await capture();
        const latestStop = stateStopReason(latest);
        if (latestStop) {
          if (!(await pause(latestStop))) return { status: "review", reason: latestStop, surveys };
          continue;
        }
        if (
          latest.url !== state.url ||
          latest.text !== state.text ||
          JSON.stringify(extractCurrentQuestion(latest)) !== JSON.stringify(question)
        )
          return await stop("page_changed_during_decision");
        await executeAction(session, decision.action);
        const afterAnswer = await capture();
        if (stateStopReason(afterAnswer)) continue;
        // Some pages auto-advance when an option is selected.
        if (
          afterAnswer.url !== state.url ||
          extractCurrentQuestion(afterAnswer)?.fingerprint !== question.fingerprint
        )
          continue;
        const next = afterAnswer.controls.filter(
          (control) =>
            control.kind === "button" &&
            !control.disabled &&
            /^(next|continue|submit|finish)(?:\s*(?:>|→))?$/i.test(control.label.trim())
        );
        if (next.length !== 1) return await stop("ambiguous_continue_control");
        await executeAction(session, { kind: "continue", selector: next[0]!.selector });
        let changed = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          await wait(300);
          const current = await capture();
          if (
            stateStopReason(current) ||
            current.url !== afterAnswer.url ||
            current.text !== afterAnswer.text ||
            extractCurrentQuestion(current)?.fingerprint !== question.fingerprint
          ) {
            changed = true;
            break;
          }
        }
        if (!changed) return await stop("page_did_not_advance");
      }
      if (!completed) return await stop("step_limit_reached");
    }
    return { status: "finished", reason: "survey_limit_reached", surveys };
  } catch (error) {
    if (options.signal?.aborted) return { status: "finished", reason: "interrupted", surveys };
    const reason =
      error instanceof NavigationBlockedError ? "external_redirect" : "runner_or_provider_error";
    try {
      await notify(reason);
    } catch {
      return { status: "review", reason: "notification_failed", surveys };
    }
    return { status: "review", reason, surveys };
  }
}
