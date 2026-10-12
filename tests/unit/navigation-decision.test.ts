import { expect, it, vi } from "vitest";
import { AnswerDecisionEngine } from "../../src/decision/answer-engine.js";
import { SqliteStore } from "../../src/storage/sqlite-store.js";
import type { PageState, InteractiveControl } from "../../src/browser/types.js";
const button = (label: string, selector: string): InteractiveControl => ({
  kind: "button",
  selector,
  label,
  id: "",
  name: "",
  ariaLabel: "",
  placeholder: "",
  value: "",
  href: "",
  checked: false,
  disabled: false,
  required: false,
  options: []
});
const page: PageState = {
  url: "https://survey.test/private?token=secret",
  title: "Survey",
  text: "Private page text",
  controls: [
    button("I'm ready to proceed", "#next"),
    button("Start purchase", "#buy"),
    button("Accept study consent", "#consent")
  ]
};
it("limits automatic navigation decisions to observed eligible labels without sending URLs or page text", async () => {
  const store = new SqliteStore(":memory:");
  const provider = {
    decide: vi.fn(async () => ({
      selectedOption: "1: I'm ready to proceed",
      confidence: 0.99,
      reason: "Continue"
    }))
  };
  try {
    expect(await new AnswerDecisionEngine(store, provider).navigation(page)).toEqual({
      selector: "#next",
      submit: false
    });
    const payload = provider.decide.mock.calls as unknown;
    expect(JSON.stringify(payload)).not.toMatch(
      /secret|Private page|#next|purchase|Accept study consent/
    );
  } finally {
    store.close();
  }
});
it.each([
  { selectedOption: "#next", confidence: 1 },
  { selectedOption: "1: I'm ready to proceed", confidence: 0.5 }
])("rejects invented selectors and uncertain navigation", async (answer) => {
  const store = new SqliteStore(":memory:");
  try {
    expect(
      await new AnswerDecisionEngine(store, {
        decide: async () => ({ ...answer, reason: "" })
      }).navigation(page)
    ).toBeUndefined();
  } finally {
    store.close();
  }
});
