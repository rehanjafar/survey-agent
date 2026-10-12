import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatGPTPlanProvider,
  completedStreamText
} from "../../src/providers/chatgpt-plan-provider.js";
function stream(events: unknown[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")
  );
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    }
  });
}
afterEach(() => vi.unstubAllGlobals());
describe("ChatGPT plan provider", () => {
  it("requires a completed stream and handles chunk boundaries", async () => {
    await expect(
      completedStreamText(
        stream([
          { type: "response.output_text.delta", delta: "hello" },
          { type: "response.completed" }
        ])
      )
    ).resolves.toBe("hello");
    await expect(
      completedStreamText(stream([{ type: "response.output_text.delta", delta: "partial" }]))
    ).rejects.toThrow("without completion");
  });
  it("stops on a streaming usage-limit failure", async () => {
    await expect(
      completedStreamText(
        stream([
          {
            type: "response.failed",
            response: { error: { code: "subscription_sharing_usage_limit_exceeded" } }
          }
        ])
      )
    ).rejects.toThrow("usage limit");
  });
  it("uses OAuth and never a paid key or ChatGPT private endpoint", async () => {
    const reply = { selectedOption: "A", confidence: 0.99, reason: "Known fact" };
    const fetchMock = vi.fn(
      async () =>
        new Response(
          stream([
            { type: "response.output_text.delta", delta: JSON.stringify(reply) },
            { type: "response.completed" }
          ])
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new ChatGPTPlanProvider(async () => "test-oauth", "account-model").decide({
      question: "Which?",
      type: "single_choice",
      options: ["A"],
      relevantProfileFacts: []
    });
    expect(result).toEqual(reply);
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(call[1].body as string)).toMatchObject({
      store: false,
      stream: true,
      model: "account-model"
    });
    expect(call[1].headers).toMatchObject({ authorization: "Bearer test-oauth" });
  });
  it("does not retry or switch billing on HTTP errors", async () => {
    const fetchMock = vi.fn(async () => new Response("limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new ChatGPTPlanProvider(async () => "test", "model").decide({
        question: "Q",
        type: "text",
        options: [],
        relevantProfileFacts: []
      })
    ).rejects.toThrow(/no paid fallback/i);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

it("parses CRLF event boundaries split across network chunks", async () => {
  const encoded = new TextEncoder().encode(
    'data: {"type":"response.output_text.delta","delta":"ok"}\r\n\r\ndata: {"type":"response.completed"}\r\n\r\n'
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of encoded) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    }
  });
  await expect(completedStreamText(body)).resolves.toBe("ok");
});
