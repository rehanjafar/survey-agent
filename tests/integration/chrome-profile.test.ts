import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { chromeExecutable, chromeProfile } from "../../src/browser/chrome-login.js";
import { PlaywrightChromiumBrowser } from "../../src/browser/index.js";
const installed = await chromeExecutable().then(
  () => true,
  () => false
);
it.runIf(installed)(
  "opens installed Chrome with a separate persistent profile and reuses its local login cookie",
  async () => {
    const server = createServer((req, res) => {
      if (req.url === "/login")
        res.setHeader(
          "Set-Cookie",
          "mock_session=present; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax"
        );
      res.setHeader("content-type", "text/html");
      res.end(
        req.headers.cookie?.includes("mock_session=present")
          ? "Authenticated local mock"
          : "Local login"
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    const url = `http://127.0.0.1:${address.port}`;
    const directory = await mkdtemp(join(tmpdir(), "chrome-agent-test-"));
    const options = {
      channel: "chrome" as const,
      headless: true,
      allowedDomains: ["127.0.0.1"],
      userDataDirectory: chromeProfile(directory, "swagbucks")
    };
    let driver = new PlaywrightChromiumBrowser(options);
    try {
      const first = await driver.createSession();
      await first.navigate(url + "/login");
      await driver.close();
      driver = new PlaywrightChromiumBrowser(options);
      const second = await driver.createSession();
      expect((await second.navigate(url)).text).toContain("Authenticated local mock");
    } finally {
      await driver.close();
      await rm(directory, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  20000
);
