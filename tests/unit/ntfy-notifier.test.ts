import { afterEach, expect, it, vi } from "vitest";
import { NtfyNotifier } from "../../src/notifications/ntfy-notifier.js";
afterEach(() => vi.unstubAllGlobals());
it("publishes urgent CAPTCHA alerts with only host and reason", async () => {
  const fetchMock = vi.fn(async () => new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);
  await new NtfyNotifier("https://ntfy.sh/test-topic", "token").notify({
    reason: "captcha_detected",
    host: "survey.example.test"
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://ntfy.sh/test-topic",
    expect.objectContaining({
      redirect: "error",
      headers: expect.objectContaining({ priority: "urgent" }),
      body: expect.stringContaining("captcha_detected on survey.example.test")
    })
  );
});
it("fails closed when phone delivery fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("limited", { status: 429 }))
  );
  await expect(
    new NtfyNotifier("https://ntfy.sh/test-topic").notify({
      reason: "captcha_detected",
      host: "test"
    })
  ).rejects.toThrow("remains paused");
});
it.each([
  "http://ntfy.sh/topic",
  "https://user:pass@ntfy.sh/topic",
  "https://ntfy.sh/topic?token=secret"
])("rejects unsafe notification URLs %s", (url) => {
  expect(() => new NtfyNotifier(url)).toThrow();
});
