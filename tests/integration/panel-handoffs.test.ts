import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PlaywrightChromiumBrowser } from "../../src/browser/index.js";
import { PanelSurveyAdapter } from "../../src/platforms/panels/panel-adapter.js";

const server = createServer();
let base: string;
let external: string;
let browser: PlaywrightChromiumBrowser;
beforeAll(async () => {
  server.on("request", (request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (request.url === "/prolific")
      response.end(
        `<title>Mock studies</title><article><h2>Long study</h2><p>$5.00 50 minutes</p><a href="/details">View study</a></article><article><h2>Short study</h2><p>$2.00 $24.00/hr 5 minutes</p><a id="best" href="/details">View study</a></article>`
      );
    else if (request.url === "/details")
      response.end(
        `<title>Study details</title><a href="${external}/question" target="_blank">Start now</a>`
      );
    else if (request.url === "/branded")
      response.end(
        `<title>Mock surveys</title><div class="survey-card"><p>Low rate 100 points 30 minutes</p><a href="${external}/slow">Take survey</a></div><div class="survey-card"><p>Higher rate 80 pts 5 minutes</p><a id="best" href="${external}/redirect">Take survey</a></div>`
      );
    else if (request.url === "/redirect") {
      response.end(`<script>location.href='/question'</script>`);
    } else
      response.end(
        `<title>Mock question</title><fieldset><legend>Which color?</legend><label><input type="radio" name="color">Blue</label></fieldset>`
      );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  // A distinct origin on the same allowed host mimics an external provider locally.
  external = `http://localhost:${port}`;
  browser = new PlaywrightChromiumBrowser({ allowedDomains: ["127.0.0.1", "localhost"] });
  await browser.launch();
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

it.each(["prolific", "branded"] as const)(
  "extracts %s card metadata and follows a real local handoff",
  async (platform) => {
    const session = await browser.createSession();
    try {
      await session.navigate(`${base}/${platform}`);
      const adapter = new PanelSurveyAdapter(session, {
        platform,
        startUrl: `${base}/${platform}`,
        allowedHosts: ["127.0.0.1", "localhost"],
        currency: "USD",
        minimumHourlyReward: 0,
        maxDurationMinutes: 60
      });
      const result = await adapter.openBestOffer();
      expect(result).toMatchObject({
        status: "opened",
        offer: { selector: "#best", reward: platform === "prolific" ? 2 : 80 }
      });
      expect(new URL(session.currentUrl()).hostname).toBe("localhost");
    } finally {
      await session.close();
    }
  }
);
