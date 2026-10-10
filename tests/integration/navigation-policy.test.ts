import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlaywrightChromiumBrowser } from "../../src/browser/index.js";

describe("navigation policy and sessions", () => {
  let port: number;
  let blockedRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === "/forbidden") blockedRequests++;
    if (req.url === "/redirect") {
      res.writeHead(302, { location: `http://localhost:${port}/forbidden` });
      res.end();
      return;
    }
    if (req.url === "/save-session")
      res.setHeader("set-cookie", "login=retained; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600");
    res.setHeader("content-type", "text/html");
    res.end(
      `<title>${req.headers.cookie?.includes("login=retained") ? "Saved session" : "Mock survey"}</title><a id="popup" target="_blank" href="http://localhost:${port}/question">Survey</a><a id="blocked" href="/redirect">Redirect</a><button id="save" onclick="localStorage.setItem('session','saved')">Save</button><div>${req.url}</div><script>if(localStorage.getItem('session')) document.title='Saved session';</script>`
    );
  });
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it("follows authorized external popups", async () => {
    const browser = new PlaywrightChromiumBrowser({ allowedDomains: ["127.0.0.1", "localhost"] });
    try {
      const session = await browser.createSession();
      await session.navigate(`http://127.0.0.1:${port}/`);
      const nav = await session.clickAndDetectNavigation("#popup", 500);
      expect(nav.url).toBe(`http://localhost:${port}/question`);
      expect((await session.capturePageState()).text).toContain("/question");
      await session.close();
    } finally {
      await browser.close();
    }
  });
  it("blocks redirect requests before the forbidden host receives them", async () => {
    const browser = new PlaywrightChromiumBrowser({ allowedDomains: ["127.0.0.1"] });
    try {
      const session = await browser.createSession();
      await session.navigate(`http://127.0.0.1:${port}/`);
      await expect(session.clickAndDetectNavigation("#blocked", 500)).rejects.toThrow(
        "Navigation blocked"
      );
      expect(blockedRequests).toBe(0);
      await expect(session.capturePageState()).rejects.toThrow("Navigation blocked");
      await session.close();
    } finally {
      await browser.close();
    }
  });
  it("blocks an unauthorized popup before requesting its destination", async () => {
    const browser = new PlaywrightChromiumBrowser({ allowedDomains: ["127.0.0.1"] });
    try {
      const session = await browser.createSession();
      await session.navigate(`http://127.0.0.1:${port}/`);
      await expect(session.clickAndDetectNavigation("#popup", 500)).rejects.toThrow(
        "Navigation blocked"
      );
      await expect(session.capturePageState()).rejects.toThrow("Navigation blocked");
      await session.close();
    } finally {
      await browser.close();
    }
  });
  it("an explicit empty allowlist fails closed", async () => {
    const browser = new PlaywrightChromiumBrowser({ allowedDomains: [] });
    try {
      const session = await browser.createSession();
      await expect(session.navigate(`http://127.0.0.1:${port}/`)).rejects.toThrow(
        "Navigation blocked"
      );
      await session.close();
    } finally {
      await browser.close();
    }
  });
  it("retains a managed profile between launches", async () => {
    const directory = await mkdtemp(join(tmpdir(), "survey-profile-"));
    const options = { allowedDomains: ["127.0.0.1"], userDataDirectory: directory };
    try {
      const first = new PlaywrightChromiumBrowser(options);
      try {
        const session = await first.createSession();
        await session.navigate(`http://127.0.0.1:${port}/`);
        await session.navigate(`http://127.0.0.1:${port}/save-session`);
      } finally {
        await first.close();
      }
      const second = new PlaywrightChromiumBrowser(options);
      try {
        const session = await second.createSession();
        expect((await session.navigate(`http://127.0.0.1:${port}/`)).title).toBe("Saved session");
      } finally {
        await second.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
