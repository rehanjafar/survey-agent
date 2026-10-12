import { get } from "node:http";
import { expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { PhoneAnswerServer } from "../../src/ui/phone-answer-server.js";
import type { RunnerState } from "../../src/runtime/survey-runner.js";
import { phoneAnswerOrigin } from "../../src/notifications/phone-setup.js";

function fixture() {
  const state: RunnerState = {
    run: {
      id: "run",
      status: "review",
      url: "https://survey.test",
      steps: 1,
      message: "Waiting",
      updatedAt: new Date().toISOString()
    },
    reviewId: "review-1",
    reason: "low_confidence",
    busy: false,
    pendingNavigation: null,
    prompt: null,
    question: {
      fingerprint: "q",
      prompt: "ما إجابتك؟",
      type: "single_choice",
      required: true,
      options: [{ id: "a", label: "نعم", selector: "#secret-selector" }],
      rows: []
    }
  };
  const answerFromPhone = vi.fn(async () => undefined);
  return {
    state,
    answerFromPhone,
    service: new PhoneAnswerServer({ state: () => state, answerFromPhone })
  };
}
it("limits remote access to a single live question and rejects stale, duplicate, unauthorized and cross-origin replies", async () => {
  const { state, answerFromPhone, service } = fixture();
  await service.configure("https://laptop.test.ts.net", 0);
  try {
    const url = service.status().localOrigin;
    const token = new URL(service.answerLink()!).hash.slice(1);
    const headers = { "x-answer-token": token };
    expect((await fetch(url + "/question")).status).toBe(410);
    expect((await fetch(url + "/api/state", { headers })).status).toBe(404);
    expect(
      (await fetch(url + "/question", { headers: { ...headers, origin: "https://evil.test" } }))
        .status
    ).toBe(403);
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      get(url + "/question", { headers: { ...headers, host: "evil.test" } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on("error", reject);
    });
    expect(badHost).toBe(403);
    const question = await (await fetch(url + "/question", { headers })).text();
    expect(question).toContain("نعم");
    expect(question).not.toContain("secret-selector");
    const post = (body: unknown) =>
      fetch(url + "/answer", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body)
      });
    expect(
      (await post({ value: "x", confidence: 1, reason: "", selector: "#injected" })).status
    ).toBe(400);
    expect(answerFromPhone).not.toHaveBeenCalled();
    state.busy = true;
    expect((await post({ selectedOption: "نعم", confidence: 1, reason: "" })).status).toBe(409);
    state.busy = false;
    expect((await post({ selectedOption: "نعم", confidence: 1, reason: "" })).status).toBe(202);
    expect((await post({ selectedOption: "نعم", confidence: 1, reason: "" })).status).toBe(410);
    expect(answerFromPhone).toHaveBeenCalledTimes(1);
    state.reviewId = "review-2";
    const next = service.answerLink();
    expect(next).not.toContain(token);
    expect((await fetch(url + "/question", { headers })).status).toBe(410);
    state.run!.status = "stopped";
    expect(service.answerLink()).toBeUndefined();
    expect(
      (
        await fetch(url + "/question", {
          headers: { "x-answer-token": new URL(next!).hash.slice(1) }
        })
      ).status
    ).toBe(410);
  } finally {
    await service.close();
  }
});

it("provides an isolated phone connection test without touching the survey", async () => {
  const { answerFromPhone, service } = fixture();
  const browser = await chromium.launch();
  await service.configure("https://laptop.test.ts.net", 0);
  try {
    const token = new URL(service.testLink()).hash;
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(service.status().localOrigin + "/" + token);
    await page.getByLabel("Yes, this works").check();
    await page.getByRole("button", { name: "Send answer to laptop" }).click();
    await expect
      .poll(() => page.locator("#status").textContent())
      .toContain("Phone replies are working");
    expect(answerFromPhone).not.toHaveBeenCalled();
  } finally {
    await browser.close();
    await service.close();
  }
});

it.each(["text", "numeric", "multiple_choice", "matrix", "dropdown"] as const)(
  "renders %s phone input and submits exactly the user's selection",
  async (type) => {
    const { state, answerFromPhone, service } = fixture();
    state.question = {
      ...state.question!,
      type,
      inputSelector: "#input",
      options: type === "dropdown" || type === "multiple_choice" ? state.question!.options : [],
      rows:
        type === "matrix"
          ? [{ id: "row-id", label: "A row", options: state.question!.options }]
          : []
    };
    const browser = await chromium.launch();
    await service.configure("https://laptop.test.ts.net", 0);
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(service.status().localOrigin + "/" + new URL(service.answerLink()!).hash);
      if (type === "text" || type === "numeric")
        await page.getByLabel("ما إجابتك؟").fill(type === "text" ? "إجابتي" : "42");
      else await page.getByLabel("نعم", { exact: true }).check();
      await page.locator("#send").click();
      await expect.poll(() => answerFromPhone.mock.calls.length).toBe(1);
      const expected =
        type === "matrix"
          ? { matrix: [{ row: "row-id", option: "نعم" }] }
          : type === "multiple_choice"
            ? { selectedOptions: ["نعم"] }
            : type === "dropdown"
              ? { selectedOption: "نعم" }
              : { value: type === "text" ? "إجابتي" : "42" };
      expect(answerFromPhone).toHaveBeenCalledWith("review-1", expect.objectContaining(expected));
    } finally {
      await browser.close();
      await service.close();
    }
  }
);

it.each([
  "http://laptop.test.ts.net",
  "https://public.example.com",
  "https://a.ts.net.evil.test",
  "https://user:pass@laptop.test.ts.net",
  "https://laptop.test.ts.net/path",
  "https://laptop.test.ts.net?x=1"
])("rejects unsuitable phone endpoints %s", (url) => {
  expect(() => phoneAnswerOrigin(url)).toThrow();
});
