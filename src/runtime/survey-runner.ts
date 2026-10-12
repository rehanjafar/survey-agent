import { BrowserSetupError } from "../browser/types.js";
import { swagbucksOutcome } from "../platforms/swagbucks/outcome.js";
import { normalizeText } from "../normalization/question-normalizer.js";
import { ProviderError } from "../providers/provider-error.js";
import { discoverSurveyDestination } from "../platforms/generic/discovery.js";
import { effectiveSurveyDomains } from "../config/survey-hosts.js";
import type { ReviewNotification } from "../notifications/ntfy-notifier.js";
import { PanelSurveyAdapter } from "../platforms/panels/panel-adapter.js";
import { pageStopReason } from "../validation/page-safety.js";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  BrowserAutomationDriver,
  BrowserSession,
  PageState,
  InteractiveControl
} from "../browser/index.js";
import { isAllowedUrl } from "../browser/index.js";
import type { AppSettings } from "../config/app-settings.js";
import { providerQuestion } from "../decision/answer-engine.js";
import type { AnswerDecisionEngine } from "../decision/answer-engine.js";
import type { NormalizedQuestion, ReviewReason, SurveyAction } from "../domain/survey.js";
import { executeAction } from "../execution/action-executor.js";
import { extractQuestions } from "../extraction/question-extractor.js";
import { audit } from "../logging/audit.js";
import { EurekaSurveyPlatformAdapter } from "../platforms/eureka/index.js";
import { chatPrompt } from "../providers/no-cost-provider.js";
import type { ProviderDecision } from "../providers/types.js";
import type { RunRecord, SqliteStore } from "../storage/sqlite-store.js";

export interface RunnerState {
  run: RunRecord | null;
  reviewId: string | null;
  question: NormalizedQuestion | null;
  reason: string | null;
  prompt: string | null;
  busy: boolean;
  pendingNavigation: { hostname: string; canContinue: boolean } | null;
}
export class SurveyRunner {
  private panel: PanelSurveyAdapter | undefined;
  private panelOfferActive = false;
  private surveyStartSteps = 0;
  private lastConsentCheck: string | undefined;
  private acceptedConsents = new Set<string>();
  private captchaTimer: ReturnType<typeof setTimeout> | undefined;
  private run: RunRecord | null = null;
  private question: NormalizedQuestion | null = null;
  private reason: string | null = null;
  private reviewId: string | null = null;
  private session: BrowserSession | undefined;
  private driver: BrowserAutomationDriver | undefined;
  private settings: AppSettings | undefined;
  private task: Promise<void> | undefined;
  private answered = new Set<string>();
  private explored = new Set<string>();
  private surveyAnswers = new Map<string, ProviderDecision>();
  private lastNavigation: string | undefined;
  private lastPageUrl: string | undefined;
  private readWaitStarted: number | undefined;
  public constructor(
    private readonly store: SqliteStore,
    private readonly makeDriver: (settings: AppSettings) => BrowserAutomationDriver,
    private readonly engineFactory: (settings: AppSettings) => AnswerDecisionEngine,
    private readonly dataDirectory: string,
    private readonly notify?: (event: ReviewNotification) => Promise<void | boolean>
  ) {}
  public state(): RunnerState {
    return {
      run: this.run ? { ...this.run } : null,
      reviewId: this.run?.status === "review" ? this.reviewId : null,
      question: this.question,
      reason: this.reason,
      prompt: this.question ? chatPrompt(providerQuestion(this.question)) : null,
      busy: Boolean(this.task),
      pendingNavigation: this.session?.pendingNavigation?.() ?? null
    };
  }
  public async start(settings: AppSettings): Promise<void> {
    settings = { ...settings, allowedDomains: effectiveSurveyDomains(settings) };
    if (this.task || (this.run && ["running", "paused", "review"].includes(this.run.status)))
      throw new Error("Stop the current run first.");
    if (
      !isAllowedUrl(
        settings.startUrl,
        new Set(settings.allowedDomains),
        settings.navigationMode === "compatible"
      )
    )
      throw new Error("Start URL must be in the allowed domains.");
    await this.closeBrowser();
    this.settings = { ...settings };
    this.answered.clear();
    this.explored.clear();
    this.panelOfferActive = false;
    this.surveyStartSteps = 0;
    this.lastConsentCheck = undefined;
    this.acceptedConsents.clear();
    this.surveyAnswers.clear();
    this.lastNavigation = undefined;
    this.lastPageUrl = undefined;
    this.readWaitStarted = undefined;
    this.question = null;
    this.reason = null;
    this.run = {
      id: randomUUID(),
      status: "running",
      url: safeUrl(settings.startUrl),
      steps: 0,
      message: "Opening the survey browser…",
      updatedAt: new Date().toISOString()
    };
    this.persist();
    this.launchTask(async () => {
      this.driver = this.makeDriver(settings);
      this.session = await this.driver.createSession();
      this.panel =
        settings.platform === "prolific" ||
        settings.platform === "branded" ||
        settings.platform === "swagbucks"
          ? new PanelSurveyAdapter(this.session, {
              platform: settings.platform,
              rankBy: settings.rankBy,
              startUrl: settings.startUrl,
              allowedHosts: settings.allowedDomains,
              currency: settings.currency,
              minimumHourlyReward: settings.minimumHourlyReward,
              maxDurationMinutes: settings.maxDurationMinutes
            })
          : undefined;
      await this.session.navigate(settings.startUrl);
      if (this.run?.status !== "running") return;
      await this.runContinuously();
    });
  }
  public pause(): void {
    if (this.run?.status === "running") this.status("paused", "Paused. The browser remains open.");
  }
  public async stop(): Promise<void> {
    clearTimeout(this.captchaTimer);
    if (this.run && ["running", "paused", "review"].includes(this.run.status))
      this.status("stopped", "Run stopped.");
    await this.task;
    await this.closeBrowser();
  }
  public async resume(
    input?: ProviderDecision,
    confirmSubmit = false,
    remember = false
  ): Promise<void> {
    if (this.session?.pendingNavigation?.())
      throw new Error("Review the new provider below before continuing.");
    if (this.reason === "step_limit")
      throw new Error("Stop this run before starting another; its action limit has been reached.");
    if (
      this.task ||
      !this.run ||
      !["paused", "review"].includes(this.run.status) ||
      !this.session ||
      !this.settings
    )
      throw new Error("No idle paused run to resume.");
    clearTimeout(this.captchaTimer);
    const reviewedQuestion = this.question;
    const wasSubmit = this.reason === "submission_confirmation";
    this.status("running", "Checking the current page…");
    this.launchTask(async () => {
      const current = await this.session!.capturePageState();
      if (await this.guard(current)) return;
      if (input) {
        if (!reviewedQuestion) throw new Error("No question awaiting review.");
        const fresh = extractQuestions(current).find(
          (question) =>
            question.fingerprint === reviewedQuestion.fingerprint &&
            binding(question) === binding(reviewedQuestion)
        );
        if (!fresh) {
          await this.review("unexpected_page", "The page changed. Inspect it before resuming.");
          return;
        }
        const prior = this.surveyAnswers.get(surveyQuestionKey(fresh));
        if (prior && answerMeaning(prior) !== answerMeaning(input)) {
          await this.review(
            "contradiction",
            "This differs from your earlier answer to the same question in this survey. Inspect the survey before proceeding."
          );
          return;
        }
        const result = this.engineFactory(this.settings!).human(fresh, input);
        if (result.status === "review") {
          await this.review(result.reason, result.detail);
          return;
        }
        await this.apply(fresh, result.action, { ...input, confidence: 1 }, "human", remember);
      } else if (wasSubmit && confirmSubmit) {
        const next =
          navigation(current) ?? (await this.engineFactory(this.settings!).navigation(current));
        if (!next || !next.submit) {
          await this.review("unexpected_page", "Submit control changed.");
          return;
        }
        await this.navigateNext(current, next.selector);
      }
      this.question = null;
      this.reason = null;
      await this.runContinuously();
    });
  }
  public async answerFromPhone(reviewId: string, answer: ProviderDecision): Promise<void> {
    if (
      this.run?.status !== "review" ||
      this.reviewId !== reviewId ||
      !this.question ||
      !this.settings ||
      this.task ||
      !["low_confidence", "missing_information", "unsupported_question"].includes(this.reason ?? "")
    )
      throw new Error(
        "This question is no longer ready for a phone answer. Open the latest alert."
      );
    const result = this.engineFactory(this.settings).human(this.question, answer);
    if (result.status !== "action") throw new Error(result.detail);
    await this.resume(answer);
  }
  public async idle(): Promise<void> {
    await this.task;
  }
  public async openLink(value: string): Promise<void> {
    if (
      this.task ||
      !this.session?.openLink ||
      !this.settings ||
      !this.run ||
      !["paused", "review"].includes(this.run.status)
    )
      throw new Error("Pause the active browser run before opening a link.");
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("Use an HTTP(S) link without embedded credentials.");
    // Explicit user input approves only this host for this run. Do not persist
    // magic-link query strings or fragments in configuration, history or logs.
    this.settings = {
      ...this.settings,
      allowedDomains: [...new Set([...this.settings.allowedDomains, url.hostname])]
    };
    this.question = null;
    this.reason = null;
    this.lastNavigation = undefined;
    this.answered.clear();
    this.status("running", "Opening your link in the survey browser…");
    this.launchTask(async () => {
      await this.session!.openLink!(url.href);
      this.run!.url = safeUrl(this.session!.currentUrl());
      if (this.run?.status === "running")
        this.status("paused", "Link opened. Finish signing in manually, then Resume when ready.");
    });
  }
  public async approveProvider(hostname: string): Promise<void> {
    const pending = this.session?.pendingNavigation?.();
    if (
      this.task ||
      this.run?.status !== "review" ||
      !this.settings ||
      !pending?.canContinue ||
      pending.hostname !== hostname ||
      !this.session?.approveNavigation
    )
      throw new Error("No matching provider is awaiting approval.");
    this.settings = {
      ...this.settings,
      allowedDomains: [...new Set([...this.settings.allowedDomains, hostname])]
    };
    this.question = null;
    this.reason = null;
    this.lastNavigation = undefined;
    this.answered.clear();
    this.status("running", "Opening the approved provider…");
    audit(this.store, "provider_approved", { runId: this.run.id });
    this.launchTask(async () => {
      await this.session!.approveNavigation!(hostname);
      if (this.run?.status === "running") await this.runContinuously();
    });
  }
  private launchTask(work: () => Promise<void>): void {
    this.task = work()
      .catch(async (error: unknown) => {
        if (this.run?.status === "running" && error instanceof BrowserSetupError) {
          await this.review("authentication_required", error.message);
          return;
        }
        if (this.run?.status === "running" && error instanceof ProviderError) {
          await this.review(error.reviewReason, error.message, error.reviewHost);
          return;
        }
        if (this.run?.status === "running")
          await this.review(
            "unexpected_page",
            this.session?.pendingNavigation?.()
              ? "This survey is moving to another provider. Review its domain below before continuing."
              : "Browser or page operation failed. Inspect the browser, verify allowed domains and resume."
          );
      })
      .finally(() => {
        this.task = undefined;
      });
  }
  private async runContinuously(): Promise<void> {
    while (this.run?.status === "running") {
      try {
        await this.loop();
      } catch (error) {
        if (this.run?.status !== "running") return;
        if (error instanceof ProviderError)
          await this.review(error.reviewReason, error.message, error.reviewHost);
        else if (this.recoverAutomatically() && this.panelOfferActive)
          await this.review(
            "unexpected_page",
            "Survey operation failed; moving to another survey."
          );
        else throw error;
      }
    }
  }
  private recoverAutomatically(): boolean {
    return (
      this.continuous() && this.settings!.autonomousRecovery && this.settings!.provider !== "manual"
    );
  }
  private async loop(): Promise<void> {
    const settings = this.settings!;
    const engine = this.engineFactory(settings);
    while (this.run?.status === "running") {
      const page = await this.session!.capturePageState();
      this.run.url = safeUrl(page.url);
      if (await this.guard(page)) return;
      if (page.url !== this.lastPageUrl) {
        this.answered.clear();
        this.acceptedConsents.clear();
        this.lastConsentCheck = undefined;
        this.lastPageUrl = page.url;
      }
      const onOfferList = Boolean(
        this.panel &&
        new URL(page.url).origin === new URL(settings.startUrl).origin &&
        new URL(page.url).pathname.replace(/\/+$/, "") ===
          new URL(settings.startUrl).pathname.replace(/\/+$/, "")
      );
      if (settings.platform === "swagbucks" && !onOfferList) {
        const outcome = swagbucksOutcome(page);
        if (outcome) {
          if (this.continuous() && this.panelOfferActive) {
            await this.returnToOffers(outcome);
            continue;
          }
          await this.review(
            outcome,
            outcome === "survey_screened_out"
              ? "This survey screened you out. No completion or SB credit was assumed. Review the dashboard before starting another survey."
              : "This survey is full or unavailable. Review the dashboard before starting another survey."
          );
          return;
        }
      }
      if (page.complete && !onOfferList) {
        if (this.continuous() && this.panelOfferActive) {
          await this.returnToOffers("survey_completed");
          continue;
        }
        this.status("completed", "Survey completion detected.");
        return;
      }
      if (onOfferList && this.panelOfferActive) {
        this.surveyAnswers.clear();
        this.answered.clear();
        this.lastNavigation = undefined;
        this.panelOfferActive = false;
        this.acceptedConsents.clear();
        this.lastConsentCheck = undefined;
        if (this.continuous()) this.surveyStartSteps = this.run.steps;
      }
      if (this.run.steps - this.surveyStartSteps >= settings.maxSteps) {
        await this.review(
          "step_limit",
          "This run reached its action limit. Stop it before starting another."
        );
        return;
      }
      if (settings.autoAcceptConsent) {
        const signature =
          pageSignature(page) +
          JSON.stringify(page.controls.map((control) => [control.selector, control.checked]));
        if (signature !== this.lastConsentCheck) {
          const consent = await engine.consent(page);
          if (this.run.status !== "running") return;
          this.lastConsentCheck = signature;
          if (consent) {
            if (consent.kind === "button") await this.navigateNext(page, consent.selector);
            else {
              const fresh = await this.session!.capturePageState();
              if (await this.guard(fresh)) return;
              const control = fresh.controls.find(
                (item) =>
                  item.selector === consent.selector &&
                  item.kind === "checkbox" &&
                  !item.disabled &&
                  !item.checked
              );
              if (!control || pageSignature(fresh) !== pageSignature(page)) {
                await this.review("unexpected_page", "Consent page changed before acceptance.");
                return;
              }
              await executeAction(this.session!, {
                kind: "set_many",
                selections: [{ selector: consent.selector, checked: true }]
              });
              this.acceptedConsents.add(consentBinding(control));
              this.run.steps++;
              this.readWaitStarted = undefined;
              audit(this.store, "consent_accepted", { runId: this.run.id });
              this.persist();
            }
            continue;
          }
        }
      }
      if (
        this.panel &&
        new URL(page.url).origin === new URL(settings.startUrl).origin &&
        new URL(page.url).pathname.replace(/\/+$/, "") ===
          new URL(settings.startUrl).pathname.replace(/\/+$/, "")
      ) {
        const discovered = await this.panel.discoverOffers();
        if (discovered.status === "ready") {
          this.panel.markAttempted(discovered.offers[0]!.key);
          this.panelOfferActive = true;
          await this.navigateNext(page, discovered.offers[0]!.selector);
          continue;
        }
        if (settings.platform === "swagbucks") {
          if (await this.waitForPage()) continue;
          const interpreted = await engine.surveyOffer(page, this.panel, settings);
          if (this.run.status !== "running") return;
          if (interpreted) {
            this.panel.markAttempted(interpreted.key);
            this.panelOfferActive = true;
            await this.navigateNext(page, interpreted.selector);
            continue;
          }
          if (this.continuous()) {
            this.status(
              "running",
              `Waiting for new eligible surveys; checking again in ${settings.offerPollSeconds} seconds…`
            );
            if (!(await this.waitWhileRunning(settings.offerPollSeconds * 1000))) return;
            await this.session!.navigate(settings.startUrl);
            this.lastNavigation = undefined;
            this.readWaitStarted = undefined;
            continue;
          }
          await this.review(
            "no_matching_offers",
            "No unattempted Swagbucks surveys match your SB/hour and duration filters. Check the offers or adjust your settings."
          );
          return;
        }
      }
      let questions: NormalizedQuestion[];
      try {
        questions = extractQuestions({
          ...page,
          controls: page.controls.filter(
            (control) => !this.acceptedConsents.has(consentBinding(control))
          )
        });
      } catch {
        if (await this.waitForPage()) continue;
        await this.review(
          "unsupported_question",
          "The page has ambiguous or unsupported question controls."
        );
        return;
      }
      const question = questions.find((item) => !this.answered.has(binding(item)));
      if (question) {
        this.question = question;
        this.persist();
        const prior = this.surveyAnswers.get(surveyQuestionKey(question));
        const decision = prior ? engine.replay(question, prior) : await engine.decide(question);
        if (this.run.status !== "running") return;
        if (decision.status === "review") {
          await this.review(decision.reason, decision.detail, decision.reviewHost);
          return;
        }
        const fresh = await this.session!.capturePageState();
        if (await this.guard(fresh)) return;
        const same = extractQuestions(fresh).some(
          (candidate) =>
            candidate.fingerprint === question.fingerprint &&
            binding(candidate) === binding(question)
        );
        if (!same) {
          await this.review(
            "unexpected_page",
            "Question changed before the answer could be applied."
          );
          return;
        }
        await this.apply(question, decision.action, decision.answer, decision.source);
        await delay(settings.stepDelayMs);
        continue;
      }
      this.question = null;
      const destination = discoverSurveyDestination(
        page,
        this.explored,
        this.panel
          ? {
              unit:
                settings.platform === "swagbucks"
                  ? "SB"
                  : settings.platform === "branded"
                    ? "points"
                    : settings.currency === "GBP"
                      ? "£"
                      : "$",
              minimumHourlyReward: settings.minimumHourlyReward,
              maxDurationMinutes: settings.maxDurationMinutes
            }
          : undefined
      );
      if (destination) {
        this.explored.add(destination.key);
        await this.navigateNext(page, destination.selector);
        continue;
      }
      const next = navigation(page) ?? (await engine.navigation(page));
      if (this.run.status !== "running") return;
      if (next) {
        if (next.submit && !settings.autoSubmit) {
          await this.review(
            "submission_confirmation",
            "Answers are ready. Confirm submission to finish this survey."
          );
          return;
        }
        await this.navigateNext(page, next.selector);
        if (this.run.status !== "running") return;
        continue;
      }
      if (
        settings.platform === "eureka" &&
        new URL(page.url).hostname === new URL(settings.startUrl).hostname
      ) {
        const adapter = new EurekaSurveyPlatformAdapter(this.session!, {
          startUrl: settings.startUrl,
          allowedHosts: settings.allowedDomains,
          rankBy: settings.rankBy,
          auditLogger: {
            record: async (event) => {
              audit(this.store, event.event, { runId: this.run!.id });
            }
          }
        });
        const discovered = await adapter.discoverOffers();
        if (discovered.status === "ready") {
          const offer = discovered.selectedOffer;
          await this.navigateNext(page, offer.selector);
          continue;
        }
      }
      if (await this.waitForPage()) continue;
      if (this.continuous() && this.panelOfferActive) {
        const outcome = await engine.terminalOutcome(page);
        if (this.run.status !== "running") return;
        if (outcome) {
          await this.returnToOffers(outcome);
          continue;
        }
      }
      await this.review(
        "no_question_found",
        "No supported question, continuation button or survey offer was found."
      );
      return;
    }
  }
  private continuous(): boolean {
    return this.settings?.platform === "swagbucks" && this.settings.continuousSurveys;
  }
  private async waitWhileRunning(milliseconds: number): Promise<boolean> {
    const end = Date.now() + milliseconds;
    while (this.run?.status === "running" && Date.now() < end)
      await delay(Math.min(250, end - Date.now()));
    return this.run?.status === "running";
  }
  private async returnToOffers(outcome: string): Promise<void> {
    audit(this.store, "survey_finished", { runId: this.run!.id, reason: outcome });
    this.status("running", "Returning to Swagbucks to choose the next survey…");
    if (!(await this.waitWhileRunning(this.settings!.stepDelayMs))) return;
    await this.session!.navigate(this.settings!.startUrl);
    this.readWaitStarted = undefined;
    this.lastNavigation = undefined;
    this.question = null;
  }
  private async waitForPage(): Promise<boolean> {
    this.readWaitStarted ??= Date.now();
    if (Date.now() - this.readWaitStarted >= 4000) return false;
    this.status("running", "Waiting for the page's survey controls to finish loading…");
    await delay(400);
    return true;
  }
  private async guard(page: PageState): Promise<boolean> {
    let reason: ReviewReason | undefined;
    if (
      !isAllowedUrl(
        page.url,
        new Set([...this.settings!.allowedDomains, ...this.settings!.authDomains]),
        this.settings!.navigationMode === "compatible"
      )
    )
      reason = "unexpected_page";
    else if (pageStopReason(page) === "captcha_detected") reason = "captcha_detected";
    else if (
      pageStopReason(page) === "authentication_required" ||
      (page.documentUrls ?? [page.url]).some((url) =>
        isAllowedUrl(
          url,
          new Set(this.settings!.authDomains),
          this.settings!.navigationMode === "compatible"
        )
      ) ||
      !isAllowedUrl(
        page.url,
        new Set(this.settings!.allowedDomains),
        this.settings!.navigationMode === "compatible"
      )
    )
      reason = "authentication_required";
    else if (
      /\/(?:account|profile|settings|payments?|cashout|redeem|withdraw)(?:\/|$)/i.test(
        new URL(page.url).pathname
      )
    )
      reason = "unexpected_page";
    else if (page.hasUnsupported) reason = "unsupported_question";
    else if (page.validationErrors?.length) reason = "unexpected_page";
    if (!reason) return false;
    await this.review(
      reason,
      reason === "authentication_required"
        ? "Sign in manually in the survey browser, then resume."
        : reason === "captcha_detected"
          ? "Complete the verification manually, then resume."
          : "Inspect this page in the survey browser before continuing."
    );
    return true;
  }
  private async apply(
    question: NormalizedQuestion,
    action: SurveyAction,
    answer: ProviderDecision | undefined,
    source: string,
    remember = false
  ): Promise<void> {
    if (this.run?.status !== "running") return;
    await executeAction(this.session!, action);
    this.readWaitStarted = undefined;
    this.answered.add(binding(question));
    if (answer) {
      this.surveyAnswers.set(surveyQuestionKey(question), answer);
      if (remember) this.engineFactory(this.settings!).remember(question, answer);
      this.store.recordAnswer(
        this.run.id,
        question.fingerprint,
        JSON.stringify({ ...answer, reason: "" }),
        source
      );
    }
    this.run.steps++;
    audit(this.store, "answer_applied", {
      runId: this.run.id,
      fingerprint: question.fingerprint,
      source
    });
    this.persist();
  }
  private async navigateNext(page: PageState, selector: string): Promise<void> {
    if (this.run?.status !== "running") return;
    const before = pageSignature(page);
    if (this.lastNavigation === before) {
      await this.review(
        "unexpected_page",
        "Page did not advance; stopped to prevent duplicate submission."
      );
      return;
    }
    const fresh = await this.session!.capturePageState();
    if (await this.guard(fresh)) return;
    if (
      pageSignature(fresh) !== before ||
      !fresh.controls.some(
        (control) => control.selector === selector && control.kind === "button" && !control.disabled
      )
    ) {
      await this.review(
        "unexpected_page",
        "Page changed before navigation. Inspect it before resuming."
      );
      return;
    }
    this.readWaitStarted = undefined;
    this.lastNavigation = before;
    await executeAction(this.session!, { kind: "continue", selector });
    this.run.steps++;
    this.persist();
    audit(this.store, "navigation_applied", { runId: this.run.id });
    // Support both URL navigation and same-URL conditional/SPA page transitions.
    for (let attempt = 0; attempt < 30 && this.run.status === "running"; attempt++) {
      await delay(250);
      const after = await this.session!.capturePageState();
      if (pageSignature(after) !== before) {
        this.answered.clear();
        return;
      }
    }
    if (this.run.status === "running")
      await this.review(
        "unexpected_page",
        "Page did not advance. Check for validation errors or an unsupported transition."
      );
  }
  private async review(reason: ReviewReason, message: string, reviewHost?: string): Promise<void> {
    if (!this.run || this.run.status === "stopped") return;
    if (this.recoverAutomatically() && reason === "provider_error") {
      this.question = null;
      this.reason = null;
      audit(this.store, "provider_wait", { runId: this.run.id, reason });
      this.status("running", "ChatGPT is unavailable. Waiting 60 seconds before checking again…");
      await this.waitWhileRunning(60_000);
      return;
    }
    this.reason = reason;
    this.reviewId = randomUUID();
    this.status("review", message);
    this.store.recordReview(reason, message);
    let delivered = false;
    if (this.notify && this.session) {
      try {
        const result = await this.notify({
          reason,
          host:
            reviewHost ??
            this.session.pendingNavigation?.()?.hostname ??
            new URL(this.session.currentUrl()).hostname
        });
        delivered = result !== false;
      } catch {
        this.status(
          "review",
          "Phone alert failed. The run remains stopped for review; check phone setup and connectivity."
        );
      }
    }
    if (reason === "captcha_detected" && delivered && this.continuous() && !reviewHost)
      this.watchCaptcha();
    audit(this.store, "review_required", { runId: this.run.id, reason });
    if (this.session?.screenshot) {
      const directory = join(this.dataDirectory, "screenshots");
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await this.session.screenshot(join(directory, this.run.id + ".png"));
        const files = (await readdir(directory)).filter((file) => /^[a-f0-9-]+\.png$/.test(file));
        if (files.length > 20)
          for (const file of files
            .filter((file) => file !== this.run!.id + ".png")
            .slice(0, files.length - 20))
            await unlink(join(directory, file));
      } catch {
        audit(this.store, "screenshot_unavailable", { runId: this.run.id });
      }
    }
  }
  /** Read-only polling after an alert; CAPTCHA controls are never operated by the agent. */
  private watchCaptcha(clearChecks = 0): void {
    clearTimeout(this.captchaTimer);
    this.captchaTimer = setTimeout(() => {
      void (async () => {
        if (this.run?.status !== "review" || this.reason !== "captcha_detected" || !this.session)
          return;
        if (this.task) {
          this.watchCaptcha(clearChecks);
          return;
        }
        const page = await this.session.capturePageState();
        if (this.run?.status !== "review" || this.reason !== "captcha_detected") return;
        if (pageStopReason(page) === "captcha_detected") {
          this.watchCaptcha(0);
          return;
        }
        if (clearChecks < 1) {
          this.watchCaptcha(clearChecks + 1);
          return;
        }
        await this.resume();
      })().catch(() => {
        if (this.run?.status === "review")
          this.status(
            "review",
            "Could not recheck verification. Inspect the browser and Resume manually."
          );
      });
    }, 2000);
    this.captchaTimer.unref();
  }
  private status(status: RunRecord["status"], message: string): void {
    if (this.run) {
      this.run.status = status;
      this.run.message = message;
      this.persist();
    }
  }
  private persist(): void {
    if (this.run) {
      this.run.updatedAt = new Date().toISOString();
      this.store.saveRun(this.run);
    }
  }
  private async closeBrowser() {
    await this.session?.close().catch(() => undefined);
    this.session = undefined;
    await this.driver?.close().catch(() => undefined);
    this.driver = undefined;
  }
}
function consentBinding(control: InteractiveControl): string {
  return JSON.stringify([control.selector, control.label, control.question]);
}
function safeUrl(value: string) {
  const url = new URL(value);
  return url.origin;
}
function binding(question: NormalizedQuestion) {
  return JSON.stringify([
    question.fingerprint,
    question.inputSelector,
    question.options.map((option) => option.selector),
    question.rows.flatMap((row) => row.options.map((option) => option.selector))
  ]);
}
function pageSignature(page: PageState) {
  return JSON.stringify([
    page.url,
    page.text,
    page.controls.map((control) => [control.selector, control.label, control.disabled]),
    page.complete
  ]);
}
function navigation(page: PageState): { selector: string; submit: boolean } | undefined {
  const controls = page.controls.filter(
    (control) =>
      control.kind === "button" &&
      !control.disabled &&
      /^(next(?: page| question)?|continue(?: to (?:survey|study|next page))?|save (?:and|&) continue|begin(?: survey| study)?|start(?: survey| study| now)?|proceed|submit(?: answers| survey)?|finish|complete survey)(\s*[→›»])?$/i.test(
        control.label.trim()
      )
  );
  if (controls.length > 1) return undefined;
  const control = controls[0];
  return control
    ? {
        selector: control.selector,
        submit: /^(submit|finish|complete survey)/i.test(control.label)
      }
    : undefined;
}

function surveyQuestionKey(question: NormalizedQuestion): string {
  return JSON.stringify([normalizeText(question.prompt), question.type]);
}
function answerMeaning(answer: ProviderDecision): string {
  return JSON.stringify([
    answer.selectedOption && normalizeText(answer.selectedOption),
    answer.value && normalizeText(answer.value),
    answer.selectedOptions?.map(normalizeText).sort(),
    answer.matrix
      ?.map((item) => [item.row, normalizeText(item.option)])
      .sort((a, b) => a[0]!.localeCompare(b[0]!))
  ]);
}
