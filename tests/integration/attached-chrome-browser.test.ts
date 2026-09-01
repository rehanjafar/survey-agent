import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PlaywrightChromiumBrowser } from "../../src/browser/index.js";

describe("attached Chrome mode", () => {
  const portProbe = createServer();
  let endpoint: string;
  let sourceBrowser: Browser;
  let sourcePage: Page;
  let attachedBrowser: PlaywrightChromiumBrowser;

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      portProbe.once("error", reject);
      portProbe.listen(0, "127.0.0.1", () => {
        portProbe.off("error", reject);
        resolve();
      });
    });
    const port = (portProbe.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) =>
      portProbe.close((error) => (error ? reject(error) : resolve()))
    );
    endpoint = `http://127.0.0.1:${port}`;

    sourceBrowser = await chromium.launch({
      headless: true,
      args: [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${port}`]
    });
    sourcePage = await sourceBrowser.newPage();
    await sourcePage.setContent("<title>Existing Chrome tab</title><button>Offer — 50¢</button>");

    attachedBrowser = new PlaywrightChromiumBrowser({
      mode: "attached_chrome",
      cdpEndpoint: endpoint
    });
    await attachedBrowser.launch();
  });

  afterAll(async () => {
    await attachedBrowser.close();
    await sourceBrowser.close();
  });

  it("uses an existing tab without closing it on agent disconnect", async () => {
    const session = await attachedBrowser.createSession();

    await expect(session.capturePageState()).resolves.toMatchObject({
      title: "Existing Chrome tab"
    });
    await session.close();
    expect(sourcePage.isClosed()).toBe(false);
    expect(sourceBrowser.isConnected()).toBe(true);
  });
});
