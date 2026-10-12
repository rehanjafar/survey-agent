import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createApplication } from "../../src/ui/server.js";
import { ChatGPTPlanProvider } from "../../src/providers/chatgpt-plan-provider.js";
import { ProviderError } from "../../src/providers/provider-error.js";
it("verifies an automatic answer through the dashboard and reports actionable failure without paid fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chatgpt-check-"));
  const models = vi
    .spyOn(ChatGPTPlanProvider.prototype, "models")
    .mockResolvedValue(["account-model"]);
  const decide = vi
    .spyOn(ChatGPTPlanProvider.prototype, "decide")
    .mockResolvedValue({ selectedOption: "4", confidence: 1, reason: "Arithmetic" });
  const app = await createApplication(directory);
  try {
    const origin = await app.listen(0);
    const html = await (await fetch(origin)).text();
    const token = html.match(/name="survey-token" content="([^"]+)"/)![1]!;
    const request = (authenticated = true) =>
      fetch(origin + "/api/chatgpt/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authenticated ? { "x-survey-token": token } : {})
        },
        body: JSON.stringify({ model: "account-model" })
      });
    expect((await request(false)).status).toBe(403);
    expect(decide).not.toHaveBeenCalled();
    expect((await request()).status).toBe(200);
    const state = async () =>
      (await (
        await fetch(origin + "/api/state", { headers: { "x-survey-token": token } })
      ).json()) as { chatgpt: { status: string } };
    expect((await state()).chatgpt.status).toContain("Verified");
    expect(decide).toHaveBeenCalledWith({
      question: "What is 2 + 2?",
      type: "single_choice",
      options: ["4", "5"],
      relevantProfileFacts: []
    });
    decide.mockRejectedValueOnce(
      new ProviderError("ChatGPT usage limit reached. No paid fallback was attempted.")
    );
    await request();
    expect((await state()).chatgpt.status).toContain("usage limit");
  } finally {
    await app.close();
    models.mockRestore();
    decide.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});
