import { ProviderError, providerHttpError } from "./provider-error.js";
import { z } from "zod";
import type { LlmProvider, ProviderDecision, ProviderQuestion } from "./types.js";
import { parseDecision, instructions } from "./decision-schema.js";

export async function completedStreamText(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1_000_000) throw new Error("ChatGPT response exceeded size limit.");
      buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data) as {
          type?: string;
          delta?: string;
          response?: { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
        };
        if (
          event.type === "response.failed" ||
          event.type === "error" ||
          event.type === "response.incomplete"
        )
          throw new ProviderError(
            "ChatGPT plan request failed or reached its usage limit. Review ChatGPT Settings > Usage; no paid fallback was attempted."
          );
        if (event.type === "response.output_text.delta") text += event.delta ?? "";
        if (event.type === "response.completed") {
          const full = event.response?.output
            ?.flatMap((item) => item.content ?? [])
            .filter((item) => item.type === "output_text")
            .map((item) => item.text ?? "")
            .join("");
          return full || text;
        }
      }
    }
    throw new Error("ChatGPT stream ended without completion.");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export class ChatGPTPlanProvider implements LlmProvider {
  public constructor(
    private readonly getToken: () => Promise<string>,
    private readonly model: string
  ) {}
  public async models(): Promise<readonly string[]> {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${await this.getToken()}` },
      redirect: "error",
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw providerHttpError(response.status);
    const catalog = z
      .object({ models: z.array(z.object({ slug: z.string(), visibility: z.string() })) })
      .parse(await response.json());
    return catalog.models.filter((item) => item.visibility === "list").map((item) => item.slug);
  }
  public async decide(question: ProviderQuestion): Promise<ProviderDecision> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: {
        authorization: `Bearer ${await this.getToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        store: false,
        stream: true,
        input: [
          {
            role: "system",
            content: instructions
          },
          { role: "user", content: JSON.stringify(question) }
        ]
      })
    });
    if (!response.ok || !response.body) throw providerHttpError(response.status);
    return parseDecision(JSON.parse(await completedStreamText(response.body))) as ProviderDecision;
  }
}
