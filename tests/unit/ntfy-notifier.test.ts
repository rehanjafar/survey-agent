import { afterEach, expect, it, vi } from "vitest";
import { NtfyNotifier } from "../../src/notifications/ntfy-notifier.js";
afterEach(() => vi.unstubAllGlobals());
it("publishes urgent CAPTCHA alerts with an authenticated remote-desktop destination", async () => {
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
      headers: expect.objectContaining({
        priority: "urgent",
        click: "https://remotedesktop.google.com/access",
        actions: "view, Open laptop, https://remotedesktop.google.com/access"
      }),
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
it("attaches a one-question phone link without sending personal question text", async () => {
  const fetchMock = vi.fn(async () => new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);
  await new NtfyNotifier("https://ntfy.sh/test-topic").notify({
    reason: "low_confidence",
    host: "survey.test",
    answerUrl: "https://laptop.test.ts.net/#private-question-token"
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://ntfy.sh/test-topic",
    expect.objectContaining({
      headers: expect.objectContaining({
        click: "https://laptop.test.ts.net/#private-question-token"
      }),
      body: expect.stringContaining("Tap this alert")
    })
  );
});

it.each(["authentication_required", "remote_desktop_test"])(
  "adds the Open laptop shortcut for %s",
  async (reason) => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await new NtfyNotifier("https://ntfy.sh/test-topic").notify({ reason, host: "chatgpt.com" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ntfy.sh/test-topic",
      expect.objectContaining({
        headers: expect.objectContaining({
          click: "https://remotedesktop.google.com/access",
          actions: "view, Open laptop, https://remotedesktop.google.com/access"
        }),
        body: expect.stringContaining(
          reason === "remote_desktop_test" ? "does not pause or change a survey" : "click Resume"
        )
      })
    );
  }
);
