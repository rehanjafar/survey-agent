import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PlaywrightChromiumBrowser } from "../../src/browser/index.js";
import { createApplication } from "../../src/ui/server.js";
import { settingsSchema } from "../../src/config/app-settings.js";

let origin: string;
let target: string;
let received = 0;
const server = createServer((request, response) => {
  if (request.url === "/chain") {
    response.writeHead(302, { location: origin + "/redirect" });
    response.end();
    return;
  }
  if (request.url === "/redirect") {
    response.writeHead(302, { location: target + "/question?private_token=secret" });
    response.end();
    return;
  }
  response.setHeader("content-type", "text/html");
  if (request.url === "/popup") {
    response.end(
      `<a target="_blank" href="${target}/question">Open survey</a><button onclick="window.open('${target}/question')">Open window</button>`
    );
    return;
  }
  if (request.url === "/form") {
    response.end(
      `<form method="post" action="${target}/question"><button>Continue</button></form>`
    );
    return;
  }
  if (request.url?.startsWith("/question")) received++;
  response.end('<label for="age">How old are you?</label><input id="age" type="number">');
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  origin = "http://localhost:" + port;
  target = "http://127.0.0.1:" + port;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it.each(["/redirect", "/chain"])(
  "continues an explicitly approved provider through the dashboard API without restarting the run (%s)",
  async (startPath) => {
    const directory = await mkdtemp(join(tmpdir(), "provider-handoff-"));
    const settings = settingsSchema.parse({
      startUrl: origin + startPath,
      allowedDomains: ["localhost"],
      platform: "generic",
      headless: true
    });
    const app = await createApplication(directory, settings);
    try {
      const dashboard = await app.listen(0);
      const html = await (await fetch(dashboard)).text();
      const token = html.match(/name="survey-token" content="([^"]+)"/)![1]!;
      const approve = (hostname: string, authenticated = true) =>
        fetch(dashboard + "/api/provider/approve", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(authenticated ? { "x-survey-token": token } : {})
          },
          body: JSON.stringify({ hostname, confirmed: true })
        });
      const before = received;
      await app.runner.start(settings);
      await app.runner.idle();
      const first = app.runner.state();
      expect(first.pendingNavigation).toEqual({ hostname: "127.0.0.1", canContinue: true });
      expect(JSON.stringify(first)).not.toContain("private_token");
      expect(received).toBe(before);
      expect((await approve("127.0.0.1", false)).status).toBe(403);
      expect((await approve("different.invalid")).status).toBe(400);
      expect((await approve("127.0.0.1")).status).toBe(200);
      await app.runner.idle();
      expect(app.runner.state()).toMatchObject({
        run: { id: first.run!.id, status: "review" },
        question: { type: "numeric" },
        pendingNavigation: null
      });
      expect(received).toBeGreaterThan(before);
      expect(JSON.stringify(app.store.events())).not.toContain("private_token");
      await app.runner.stop();
      await app.runner.start(settings);
      await app.runner.idle();
      expect(app.runner.state().pendingNavigation?.hostname).toBe("127.0.0.1");
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it("does not replay a cross-provider POST even after domain approval", async () => {
  const driver = new PlaywrightChromiumBrowser({ allowedDomains: ["localhost"] });
  try {
    const session = await driver.createSession();
    await session.navigate(origin + "/form");
    const before = received;
    await expect(session.click("button")).rejects.toThrow();
    expect(session.pendingNavigation?.()).toEqual({ hostname: "127.0.0.1", canContinue: false });
    await expect(session.approveNavigation!("127.0.0.1")).rejects.toThrow();
    expect(received).toBe(before);
  } finally {
    await driver.close();
  }
});

it("follows redirects to preconfigured providers without an approval interruption", async () => {
  const driver = new PlaywrightChromiumBrowser({ allowedDomains: ["localhost", "127.0.0.1"] });
  try {
    const session = await driver.createSession();
    const page = await session.navigate(origin + "/redirect");
    expect(page.url).toContain(target);
    expect(session.pendingNavigation?.()).toBeNull();
  } finally {
    await driver.close();
  }
});

it.each(["a", "button"])(
  "opens an approved new-window link in the same managed tab (%s)",
  async (selector) => {
    const driver = new PlaywrightChromiumBrowser({
      allowedDomains: ["localhost", "127.0.0.1"],
      navigationMode: "compatible"
    });
    try {
      const session = await driver.createSession();
      await session.navigate(origin + "/popup");
      await session.click(selector);
      await session.waitForNavigation(origin + "/popup");
      const page = await session.capturePageState();
      expect(page.url).toBe(target + "/question");
      expect(session.pendingNavigation?.()).toBeNull();
    } finally {
      await driver.close();
    }
  }
);

it("keeps a new-window destination pending when it needs approval", async () => {
  const driver = new PlaywrightChromiumBrowser({
    allowedDomains: ["localhost"],
    navigationMode: "compatible"
  });
  try {
    const session = await driver.createSession();
    await session.navigate(origin + "/popup");
    const before = received;
    await session.click("button").catch(() => undefined);
    await expect
      .poll(() => session.pendingNavigation?.())
      .toEqual({ hostname: "127.0.0.1", canContinue: true });
    expect(received).toBe(before);
    await expect(session.capturePageState()).rejects.toThrow();
    await session.approveNavigation!("127.0.0.1");
    expect((await session.capturePageState()).url).toBe(target + "/question");
  } finally {
    await driver.close();
  }
});

it("opens explicitly supplied links, stays paused and never stores the link token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "manual-link-"));
  const settings = settingsSchema.parse({
    startUrl: origin + "/redirect",
    allowedDomains: ["localhost"],
    platform: "generic",
    headless: true
  });
  const app = await createApplication(directory, settings);
  try {
    const dashboard = await app.listen(0);
    const html = await (await fetch(dashboard)).text();
    const token = html.match(/name="survey-token" content="([^"]+)"/)![1]!;
    const open = (url: string, authenticated = true) =>
      fetch(dashboard + "/api/browser/open", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authenticated ? { "x-survey-token": token } : {})
        },
        body: JSON.stringify({ url, confirmed: true })
      });
    await app.runner.start(settings);
    await app.runner.idle();
    expect((await open(target, false)).status).toBe(403);
    expect((await open("file:///tmp/private")).status).toBe(400);
    expect((await open(target + "/question/magic-link-token?secret=magic-link-token")).status).toBe(
      200
    );
    await app.runner.idle();
    expect(app.runner.state()).toMatchObject({
      run: { status: "paused", url: target },
      pendingNavigation: null
    });
    expect(
      JSON.stringify([app.store.runs(), app.store.events(), app.runner.state()])
    ).not.toContain("magic-link-token");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
