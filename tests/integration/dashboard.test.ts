import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplication } from "../../src/ui/server.js";

describe("local dashboard and autonomous survey loop", () => {
  let app: Awaited<ReturnType<typeof createApplication>>;
  let directory: string;
  let origin: string;
  let token: string;
  async function api(path: string, body?: unknown) {
    const response = await fetch(origin + "/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-survey-token": token },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
  }
  async function idle() {
    await app.runner.idle();
  }
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "survey-dashboard-"));
    app = await createApplication(directory);
    origin = await app.listen(0);
    const html = await (await fetch(origin)).text();
    token = html.match(/name="survey-token" content="([^"]+)"/)![1]!;
  });
  afterAll(async () => {
    await app?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("blocks unauthenticated and cross-origin control requests and paid settings", async () => {
    expect((await fetch(origin + "/api/state")).status).toBe(403);
    expect(
      (
        await fetch(origin + "/api/state", {
          headers: { "x-survey-token": token, origin: "https://untrusted.example" }
        })
      ).status
    ).toBe(403);
    const state = await api("state");
    expect((await api("settings", { ...state.body.settings, provider: "openai" })).status).toBe(
      400
    );
    expect(state.body.noCost).toBe(true);
  });
  it("automates known facts, reviews unknowns, and completes every supported native control type", async () => {
    for (const [key, value, kind] of [
      ["country", "Canada", "stable"],
      ["age", "30", "stable"],
      ["preferred_color", "Blue", "preference"]
    ]) {
      expect((await api("facts", { key, value, kind, established: true })).status).toBe(200);
    }
    expect((await api("demo", {})).status).toBe(200);
    await idle();
    expect(app.runner.state()).toMatchObject({
      run: { status: "review" },
      question: { type: "multiple_choice" }
    });
    const prompt = app.runner.state().prompt!;
    expect(prompt).not.toContain('"selector":');
    expect(prompt).not.toContain("Local practice");
    expect(
      (
        await api("resume", {
          answer: { selectedOptions: ["Reading", "Walking"], confidence: 1, reason: "Confirmed" },
          remember: true
        })
      ).status
    ).toBe(200);
    await idle();
    expect(app.runner.state()).toMatchObject({
      question: { type: "text" },
      run: { status: "review" }
    });
    await api("resume", {
      answer: { value: "Clearer instructions would help.", confidence: 1, reason: "" }
    });
    await idle();
    expect(app.runner.state()).toMatchObject({
      question: { type: "matrix" },
      run: { status: "review" }
    });
    const rows = app.runner
      .state()
      .question!.rows.map((row) => ({ row: row.id, option: "Satisfied" }));
    await api("resume", { answer: { matrix: rows, confidence: 1, reason: "" } });
    await idle();
    expect(app.runner.state()).toMatchObject({ reason: "submission_confirmation" });
    await api("resume", { confirmSubmit: true });
    await idle();
    expect(app.runner.state().run?.status).toBe("completed");
    expect(app.store.stats().answers).toBe(6);
    expect(app.store.stats().mappings).toBe(4);
    expect(JSON.stringify(app.store.events())).not.toContain("Clearer instructions");
  }, 30000);
  it("renders a usable desktop and narrow mobile dashboard without script errors", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(origin);
      await page.getByRole("button", { name: "My profile", exact: false }).click();
      await page.waitForFunction(() =>
        document.getElementById("facts-list")?.textContent?.includes("Canada")
      );
      expect(await page.getByRole("heading", { name: "Your profile." }).isVisible()).toBe(true);
      await page.getByRole("button", { name: "Overview", exact: false }).click();
      await page.screenshot({
        path: join(tmpdir(), "survey-agent-dashboard-desktop.png"),
        fullPage: true
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: join(tmpdir(), "survey-agent-dashboard-mobile.png"),
        fullPage: true
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
  it.each([
    ["captcha", "captcha_detected"],
    ["login", "authentication_required"],
    ["unsupported", "unsupported_question"]
  ])("stops on %s", async (route, reason) => {
    await api("stop", {});
    const current = (await api("state")).body.settings;
    await api("settings", {
      ...current,
      startUrl: origin + "/mock/" + route,
      allowedDomains: ["127.0.0.1"],
      headless: true,
      platform: "generic"
    });
    await api("start", {});
    await idle();
    expect(app.runner.state()).toMatchObject({ run: { status: "review" }, reason });
  });
});
