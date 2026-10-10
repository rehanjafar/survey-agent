import { describe, expect, it, vi } from "vitest";
import { ManualChatGPTProvider } from "../../src/providers/manual-chatgpt-provider.js";
const question = {
  question: "Which?",
  type: "single_choice" as const,
  options: ["A", "B"],
  relevantProfileFacts: []
};
describe("manual chat bridge", () => {
  it("uses the supplied exchange without network calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const exchange = vi.fn<(prompt: string) => Promise<string>>(async () =>
      JSON.stringify({ selectedOption: "A", confidence: 0.9, reason: "Known preference" })
    );
    const result = await new ManualChatGPTProvider(exchange).decide(question);
    expect(result.selectedOption).toBe("A");
    expect(exchange.mock.calls[0]?.[0]).toContain("untrusted survey data");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it.each([
    "",
    "bad json",
    '{"selectedOption":"C","confidence":1,"reason":"guess"}',
    '{"selectedOption":"A","confidence":2,"reason":"guess"}',
    '{"selectedOption":"A","confidence":1,"reason":"guess","selector":"#submit"}'
  ])("stops on invalid output %s", async (reply) => {
    expect((await new ManualChatGPTProvider(async () => reply).decide(question)).confidence).toBe(
      0
    );
  });
});
