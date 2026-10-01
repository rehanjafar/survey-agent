import { randomUUID } from "node:crypto";
import { mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { BrowserAutomationDriver, BrowserSession, PageState } from "../browser/index.js";
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
  question: NormalizedQuestion | null;
  reason: string | null;
  prompt: string | null;
  busy: boolean;
  pendingNavigation: { hostname: string; canContinue: boolean } | null;
}
export class SurveyRunner {
  private run: RunRecord | null = null;
  private question: NormalizedQuestion | null = null;
  private reason: string | null = null;
  private session: BrowserSession | undefined;
  private driver: BrowserAutomationDriver | undefined;
  private settings: AppSettings | undefined;
  private task: Promise<void> | undefined;
  private answered = new Set<string>();
  private lastNavigation: string | undefined;
  private lastPageUrl: string | undefined;
  public constructor(
    private readonly store: SqliteStore,
    private readonly makeDriver: (settings: AppSettings) => BrowserAutomationDriver,
    private readonly engineFactory: (settings: AppSettings) => AnswerDecisionEngine,
    private readonly dataDirectory: string
  ) {}
  public state(): RunnerState {
    return {
      run: this.run ? { ...this.run } : null,
      question: this.question,
      reason: this.reason,
      prompt: this.question ? chatPrompt(providerQuestion(this.question, this.store)) : null,
      busy: Boolean(this.task),
      pendingNavigation: this.session?.pendingNavigation?.() ?? null
    };
  }
  public async start(settings: AppSettings): Promise<void> {
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
    this.lastNavigation = undefined;
    this.lastPageUrl = undefined;
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
      await this.session.navigate(settings.startUrl);
      if (this.run?.status !== "running") return;
      await this.loop();
    });
  }
  public pause(): void {
    if (this.run?.status === "running") this.status("paused", "Paused. The browser remains open.");
  }
  public async stop(): Promise<void> {
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
        const result = this.engineFactory(this.settings!).human(fresh, input);
        if (result.status === "review") {
          await this.review(result.reason, result.detail);
          return;
        }
        await this.apply(fresh, result.action, { ...input, confidence: 1 }, "human", remember);
      } else if (wasSubmit && confirmSubmit) {
        const next = navigation(current);
        if (!next || !next.submit) {
          await this.review("unexpected_page", "Submit control changed.");
          return;
        }
        await this.navigateNext(current, next.selector);
      }
      this.question = null;
      this.reason = null;
      await this.loop();
    });
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
      if (this.run?.status === "running") await this.loop();
    });
  }
  private launchTask(work: () => Promise<void>): void {
    this.task = work()
      .catch(async () => {
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
  private async loop(): Promise<void> {
    const settings = this.settings!;
    const engine = this.engineFactory(settings);
    while (this.run?.status === "running") {
      if (this.run.steps >= settings.maxSteps) {
        await this.review(
          "step_limit",
          "This run reached its action limit. Stop it before starting another."
        );
        return;
      }
      const page = await this.session!.capturePageState();
      this.run.url = safeUrl(page.url);
      if (await this.guard(page)) return;
      if (page.url !== this.lastPageUrl) {
        this.answered.clear();
        this.lastPageUrl = page.url;
      }
      if (page.complete) {
        this.status("completed", "Survey completion detected.");
        return;
      }
      let questions: NormalizedQuestion[];
      try {
        questions = extractQuestions(page);
      } catch {
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
        const decision = await engine.decide(question);
        if (this.run.status !== "running") return;
        if (decision.status === "review") {
          await this.review(decision.reason, decision.detail);
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
      const next = navigation(page);
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
      await this.review(
        "no_question_found",
        "No supported question, continuation button or survey offer was found."
      );
      return;
    }
  }
  private async guard(page: PageState): Promise<boolean> {
    let reason: ReviewReason | undefined;
    if (
      !isAllowedUrl(
        page.url,
        new Set(this.settings!.allowedDomains),
        this.settings!.navigationMode === "compatible"
      )
    )
      reason = "unexpected_page";
    else if (page.hasCaptcha || /\b(captcha|verify you are human)\b/i.test(page.text))
      reason = "captcha_detected";
    else if (page.hasAuthentication) reason = "authentication_required";
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
    remember = source === "profile"
  ): Promise<void> {
    if (this.run?.status !== "running") return;
    await executeAction(this.session!, action);
    this.answered.add(binding(question));
    if (answer) {
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
  private async review(reason: ReviewReason, message: string): Promise<void> {
    if (!this.run || this.run.status === "stopped") return;
    this.reason = reason;
    this.status("review", message);
    this.store.recordReview(reason, message);
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
      /^(next|continue|submit|finish|complete survey)(\s*[→›»])?$/i.test(control.label.trim())
  );
  if (controls.length > 1) throw new Error("Ambiguous navigation controls.");
  const control = controls[0];
  return control
    ? {
        selector: control.selector,
        submit: /^(submit|finish|complete survey)/i.test(control.label)
      }
    : undefined;
}
