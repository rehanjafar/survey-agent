import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PlaywrightChromiumBrowser } from "../../src/browser/index.js";
import { EurekaSurveyPlatformAdapter } from "../../src/platforms/eureka/index.js";
import type { EurekaAuditEvent, EurekaAuditLogger } from "../../src/platforms/eureka/index.js";

class MemoryAuditLogger implements EurekaAuditLogger {
  public readonly events: EurekaAuditEvent[] = [];

  public async record(event: EurekaAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

describe("EurekaSurveyPlatformAdapter", () => {
  const server = createServer();
  let baseUrl: string;
  let browser: PlaywrightChromiumBrowser;

  beforeAll(async () => {
    const fixture = await readFile(
      new URL("../fixtures/eureka-offers.html", import.meta.url),
      "utf8"
    );
    server.on("request", (request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        request.url === "/survey/high"
          ? "<title>Mock survey</title><p>Selected high-reward survey</p>"
          : fixture
      );
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = new PlaywrightChromiumBrowser({ allowedDomains: ["127.0.0.1"] });
    await browser.launch();
  });

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it("opens the highest valid reward from a local Eureka-like fixture", async () => {
    const session = await browser.createSession();
    await session.navigate(`${baseUrl}/surveys`);
    const auditLogger = new MemoryAuditLogger();
    const adapter = new EurekaSurveyPlatformAdapter(session, {
      startUrl: `${baseUrl}/surveys`,
      auditLogger
    });

    await expect(adapter.openHighestRewardOffer()).resolves.toMatchObject({
      status: "opened",
      offer: { id: "high", rewardCents: 125 },
      url: `${baseUrl}/survey/high`
    });
    expect(auditLogger.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "offers_discovered", offerCount: 2 }),
        expect.objectContaining({ event: "offer_selected", rewardCents: 125 })
      ])
    );

    await session.close();
  });
});
