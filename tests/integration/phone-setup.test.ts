import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { createApplication } from "../../src/ui/server.js";
import { NtfyNotifier } from "../../src/notifications/ntfy-notifier.js";
import { readPhoneSetup } from "../../src/notifications/phone-setup.js";

it("walks through phone setup in the dashboard and preserves the topic without sending live notifications", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phone-setup-"));
  const delivery = vi.spyOn(NtfyNotifier.prototype, "notify").mockResolvedValue(undefined);
  const app = await createApplication(directory);
  const browser = await chromium.launch();
  try {
    const origin = await app.listen(0);
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.locator('[data-panel="settings"]').click();
    await page.locator("#phone-setup").click();
    await expect
      .poll(async () => page.locator("#phone-topic").textContent())
      .toMatch(/^survey-agent-[a-f0-9]{32}$/);
    expect(await page.locator("#phone-server").textContent()).toBe("https://ntfy.sh");
    const first = await readPhoneSetup(directory);
    expect(first?.confirmed).toBe(false);
    expect(delivery).not.toHaveBeenCalled();
    expect(await page.locator("#phone-confirm").isDisabled()).toBe(true);
    await page.locator("#phone-test").click();
    await expect.poll(async () => page.locator("#phone-confirm").isEnabled()).toBe(true);
    await page.locator("#phone-confirm").click();
    await expect.poll(async () => (await readPhoneSetup(directory))?.confirmed).toBe(true);
    await page.locator("#phone-setup").click();
    expect((await readPhoneSetup(directory))?.topicUrl).toBe(first?.topicUrl);
    expect(delivery).toHaveBeenCalledExactlyOnceWith({
      reason: "test_notification",
      host: "local-agent"
    });
    await page.locator("#platform").selectOption("swagbucks");
    expect(await page.locator("#start-url").inputValue()).toBe("https://www.swagbucks.com/surveys");
    expect(await page.locator("#minimum-rate-label").textContent()).toContain("SB/hour");
    expect(await page.locator("#currency").isDisabled()).toBe(true);
    await page.locator("#platform").selectOption("prolific");
    expect(await page.locator("#start-url").inputValue()).toBe("https://app.prolific.com/studies");
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await app.close();
    delivery.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});

it("requires authenticated confirmation and prevents automatic runs before phone setup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "phone-api-"));
  const app = await createApplication(directory);
  try {
    const origin = await app.listen(0);
    const html = await (await fetch(origin)).text();
    const token = html.match(/name="survey-token" content="([^"]+)"/)![1]!;
    const post = (path: string, body = {}, authenticated = true) =>
      fetch(origin + "/api/" + path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authenticated ? { "x-survey-token": token } : {})
        },
        body: JSON.stringify(body)
      });
    expect((await post("phone/setup", {}, false)).status).toBe(403);
    expect((await post("phone/confirm", { received: true })).status).toBe(400);
    const state = await (
      await fetch(origin + "/api/state", { headers: { "x-survey-token": token } })
    ).json();
    expect(
      (
        await post("settings", {
          ...state.settings,
          provider: "chatgpt_plan",
          chatgptModel: "test"
        })
      ).status
    ).toBe(200);
    const run = await post("start");
    expect(run.status).toBe(400);
    expect((await run.json()).error).toContain("phone alerts");
    expect(app.runner.state().run).toBeNull();
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
