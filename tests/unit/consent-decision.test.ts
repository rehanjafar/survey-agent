import { expect, it, vi } from "vitest";
import { AnswerDecisionEngine } from "../../src/decision/answer-engine.js";
import { SqliteStore } from "../../src/storage/sqlite-store.js";
import type { PageState, InteractiveControl } from "../../src/browser/types.js";
const control: InteractiveControl = {
  kind: "checkbox",
  selector: "#consent",
  id: "",
  name: "",
  label: "أوافق على سياسة الخصوصية",
  ariaLabel: "",
  placeholder: "",
  value: "",
  href: "",
  checked: false,
  disabled: false,
  required: true,
  options: []
};
const page: PageState = {
  url: "https://survey.test/?secret=token",
  title: "Privacy",
  text: "Privacy consent",
  controls: [control]
};
it.each(["checkbox", "button"] as const)(
  "binds authorized %s consent to the observed control",
  async (kind) => {
    const store = new SqliteStore(":memory:");
    try {
      const provider = {
        decide: vi.fn(async () => ({
          selectedOption: `1: ${kind} — ${control.label}`,
          value: "consent",
          confidence: 1,
          reason: ""
        }))
      };
      expect(
        await new AnswerDecisionEngine(store, provider).consent({
          ...page,
          controls: [{ ...control, kind }]
        })
      ).toEqual({ selector: "#consent", kind });
      expect(JSON.stringify(provider.decide.mock.calls)).not.toMatch(/secret|#consent/);
    } finally {
      store.close();
    }
  }
);
it.each([
  { selectedOption: "#invented", value: "consent", confidence: 1 },
  { selectedOption: `1: checkbox — ${control.label}`, value: "consent", confidence: 0.5 },
  { selectedOption: `1: checkbox — ${control.label}`, value: "continue", confidence: 1 }
])("rejects unbound or uncertain consent (%j)", async (answer) => {
  const store = new SqliteStore(":memory:");
  try {
    expect(
      await new AnswerDecisionEngine(store, {
        decide: async () => ({ ...answer, reason: "" })
      }).consent(page)
    ).toBeUndefined();
  } finally {
    store.close();
  }
});
it("does not offer already checked consent, purchases, or disabled controls", async () => {
  const store = new SqliteStore(":memory:");
  const provider = { decide: vi.fn(async () => ({ confidence: 0, reason: "" })) };
  try {
    expect(
      await new AnswerDecisionEngine(store, provider).consent({
        ...page,
        controls: [
          { ...control, checked: true },
          { ...control, kind: "button", label: "Purchase subscription" },
          { ...control, disabled: true }
        ]
      })
    ).toBeUndefined();
    expect(provider.decide).not.toHaveBeenCalled();
  } finally {
    store.close();
  }
});
