import { expect, it, vi } from "vitest";
import type { BrowserSession, PageState, InteractiveControl } from "../../src/browser/index.js";
import { runSurveys, pageStopReason } from "../../src/orchestration/survey-runner.js";
const control: InteractiveControl = {
  kind: "radio",
  selector: "#a",
  name: "choice",
  id: "a",
  label: "A",
  questionPrompt: "Which?",
  ariaLabel: "",
  placeholder: "",
  value: "A",
  href: "",
  checked: false,
  disabled: false,
  required: true,
  options: []
};
const state: PageState = {
  url: "https://survey.example.test/q",
  title: "Survey",
  text: "Which?\nA\nNext",
  controls: [control, { ...control, kind: "button", selector: "#next", label: "Next" }]
};
function setup() {
  let current = state;
  const session: BrowserSession = {
    capturePageState: vi.fn(async () => current),
    currentUrl: () => current.url,
    navigate: vi.fn(async () => state),
    close: vi.fn(async () => undefined),
    click: vi.fn(async () => {
      current = { ...state, text: "Survey completed", controls: [] };
    }),
    selectRadio: vi.fn(async () => undefined),
    type: vi.fn(async () => undefined),
    setCheckbox: vi.fn(async () => undefined),
    selectDropdown: vi.fn(async () => undefined),
    waitForNavigation: vi.fn(),
    clickAndDetectNavigation: vi.fn()
  };
  const notifier = { notify: vi.fn(async () => undefined) };
  const engine = {
    decide: vi.fn(async () => ({
      status: "action" as const,
      source: "llm" as const,
      action: { kind: "select_one" as const, selector: "#a" }
    }))
  };
  return {
    session,
    notifier,
    engine,
    allowedDomains: new Set(["survey.example.test"]),
    openOffer: vi.fn(async () => ({ status: "opened" as const })),
    startUrl: "https://survey.example.test/offers",
    maxSurveys: 1,
    maxSteps: 5,
    reviewTimeoutMs: 1000,
    pollMs: 1,
    wait: async () => undefined,
    setState: (value: PageState) => {
      current = value;
    }
  };
}
it("automatically answers, advances, and returns to offers", async () => {
  const options = setup();
  expect(await runSurveys(options)).toEqual({
    status: "finished",
    reason: "survey_limit_reached",
    surveys: 1
  });
  expect(options.session.selectRadio).toHaveBeenCalledWith("#a");
  expect(options.session.click).toHaveBeenCalledWith("#next");
  expect(options.notifier.notify).not.toHaveBeenCalled();
});
it("alerts once and waits for a human to clear CAPTCHA before acting", async () => {
  const options = setup();
  options.setState({ ...state, text: "Verify you are human" });
  let polls = 0;
  options.wait = async () => {
    if (++polls === 2) options.setState(state);
  };
  expect((await runSurveys(options)).status).toBe("finished");
  expect(options.notifier.notify).toHaveBeenCalledOnce();
  expect(options.notifier.notify).toHaveBeenCalledWith({
    reason: "captcha_detected",
    host: "survey.example.test"
  });
});
it("does not act when notification delivery fails", async () => {
  const options = setup();
  options.setState({ ...state, text: "CAPTCHA" });
  options.notifier.notify.mockRejectedValue(new Error("offline"));
  expect((await runSurveys(options)).reason).toBe("notification_failed");
  expect(options.engine.decide).not.toHaveBeenCalled();
  expect(options.session.selectRadio).not.toHaveBeenCalled();
});
it("rechecks safety after the model replies", async () => {
  const options = setup();
  options.engine.decide.mockImplementation(async () => {
    options.setState({ ...state, text: "CAPTCHA" });
    return { status: "action", source: "llm", action: { kind: "select_one", selector: "#a" } };
  });
  options.reviewTimeoutMs = 1;
  expect((await runSurveys(options)).status).toBe("review");
  expect(options.session.selectRadio).not.toHaveBeenCalled();
});
it("detects framed CAPTCHA and password controls", () => {
  expect(pageStopReason({ ...state, captchaDetected: true })).toBe("captcha_detected");
  expect(pageStopReason({ ...state, controls: [{ ...control, inputType: "password" }] })).toBe(
    "authentication_required"
  );
});

it("stops when the page changes while deciding", async () => {
  const options = setup();
  options.engine.decide.mockImplementation(async () => {
    options.setState({ ...state, text: "A different question" });
    return { status: "action", source: "llm", action: { kind: "select_one", selector: "#a" } };
  });
  expect((await runSurveys(options)).reason).toBe("page_changed_during_decision");
  expect(options.session.selectRadio).not.toHaveBeenCalled();
});
it("does not guess between multiple continue controls", async () => {
  const options = setup();
  options.setState({
    ...state,
    controls: [
      ...state.controls,
      { ...control, kind: "button", selector: "#also-next", label: "Continue" }
    ]
  });
  expect((await runSurveys(options)).reason).toBe("ambiguous_continue_control");
  expect(options.session.click).not.toHaveBeenCalled();
});
it("handles an interrupt without an alert or browser action", async () => {
  const options = setup();
  const controller = new AbortController();
  controller.abort();
  expect((await runSurveys({ ...options, signal: controller.signal })).reason).toBe("interrupted");
  expect(options.notifier.notify).not.toHaveBeenCalled();
  expect(options.engine.decide).not.toHaveBeenCalled();
});

it("allows a human-solved widget to clear the CAPTCHA stop without exposing the token", () => {
  expect(
    pageStopReason({
      ...state,
      captchaDetected: true,
      captchaResponsePresent: true,
      text: "Please complete the CAPTCHA"
    })
  ).toBeUndefined();
});

it("never answers on an auth-only host and resumes after manual login", async () => {
  const options = setup();
  options.setState({ ...state, url: "https://login.example.test/", text: "Continue to account" });
  let polls = 0;
  options.wait = async () => {
    if (++polls === 2) options.setState(state);
  };
  const result = await runSurveys({
    ...options,
    authenticationDomains: new Set(["login.example.test"])
  });
  expect(result.status).toBe("finished");
  expect(options.notifier.notify).toHaveBeenCalledOnce();
  expect(options.notifier.notify).toHaveBeenCalledWith({
    reason: "authentication_required",
    host: "login.example.test"
  });
});

it("does not send platform account or completion forms to the answer engine", async () => {
  const options = setup();
  expect((await runSurveys({ ...options, surveyPageAllowed: () => false })).reason).toBe(
    "platform_page_requires_review"
  );
  expect(options.engine.decide).not.toHaveBeenCalled();
  expect(options.session.selectRadio).not.toHaveBeenCalled();
});

it("reports the blocked destination hostname in the phone alert", async () => {
  const options = setup();
  options.session.blockedNavigationHost = () => "unknown-study.test";
  const result = await runSurveys({
    ...options,
    openOffer: async () => ({ status: "review", reason: "external_redirect" })
  });
  expect(result.reason).toBe("external_redirect");
  expect(options.notifier.notify).toHaveBeenCalledWith({
    reason: "external_redirect",
    host: "unknown-study.test"
  });
});
