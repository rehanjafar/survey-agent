import { z } from "zod";
import { instructions, parseDecision, wireJsonSchema } from "./decision-schema.js";
import type { LlmProvider, ProviderDecision, ProviderQuestion } from "./types.js";
abstract class JsonHttpProvider implements LlmProvider {
  public constructor(
    protected readonly key: string,
    protected readonly model: string,
    private readonly request: typeof fetch = fetch
  ) {}
  public async decide(question: ProviderQuestion): Promise<ProviderDecision> {
    const response = await this.request(this.endpoint(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.body(question)),
      signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok)
      throw new Error(
        `Provider returned HTTP ${response.status}. Check configuration, quota and connectivity.`
      );
    const raw = parseDecision(this.extract(await response.json()));
    return {
      confidence: raw.confidence,
      reason: raw.reason,
      ...(raw.selectedOption !== undefined ? { selectedOption: raw.selectedOption } : {}),
      ...(raw.selectedOptions !== undefined ? { selectedOptions: raw.selectedOptions } : {}),
      ...(raw.value !== undefined ? { value: raw.value } : {}),
      ...(raw.matrix !== undefined ? { matrix: raw.matrix } : {})
    };
  }
  protected abstract endpoint(): string;
  protected abstract headers(): Record<string, string>;
  protected abstract body(question: ProviderQuestion): unknown;
  protected abstract extract(response: unknown): unknown;
}
export class OpenAIProvider extends JsonHttpProvider {
  public constructor(key: string, model = "gpt-4.1-mini", request: typeof fetch = fetch) {
    super(key, model, request);
  }
  protected endpoint() {
    return "https://api.openai.com/v1/responses";
  }
  protected headers() {
    return { authorization: `Bearer ${this.key}`, "content-type": "application/json" };
  }
  protected body(question: ProviderQuestion) {
    return {
      model: this.model,
      store: false,
      max_output_tokens: 1200,
      instructions,
      input: JSON.stringify(question),
      text: {
        format: { type: "json_schema", name: "survey_answer", strict: true, schema: wireJsonSchema }
      }
    };
  }
  protected extract(response: unknown): unknown {
    const result = z
      .object({
        status: z.literal("completed"),
        output: z.array(
          z.object({
            type: z.string(),
            content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional()
          })
        )
      })
      .parse(response);
    const parts = result.output.flatMap((item) => item.content ?? []);
    if (parts.some((part) => part.type === "refusal"))
      throw new Error("Provider declined the question.");
    return JSON.parse(
      parts
        .filter((part) => part.type === "output_text")
        .map((part) => part.text ?? "")
        .join("")
    );
  }
}
export class AnthropicProvider extends JsonHttpProvider {
  public constructor(key: string, model = "claude-haiku-4-5", request: typeof fetch = fetch) {
    super(key, model, request);
  }
  protected endpoint() {
    return "https://api.anthropic.com/v1/messages";
  }
  protected headers() {
    return {
      "x-api-key": this.key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    };
  }
  protected body(question: ProviderQuestion) {
    return {
      model: this.model,
      max_tokens: 1200,
      system: instructions,
      tools: [
        {
          name: "answer_survey",
          description: "Return the structured survey decision",
          input_schema: wireJsonSchema
        }
      ],
      tool_choice: { type: "tool", name: "answer_survey" },
      messages: [{ role: "user", content: JSON.stringify(question) }]
    };
  }
  protected extract(response: unknown): unknown {
    const result = z
      .object({
        stop_reason: z.literal("tool_use"),
        content: z.array(
          z.object({ type: z.string(), name: z.string().optional(), input: z.unknown().optional() })
        )
      })
      .parse(response);
    const answers = result.content.filter(
      (item) => item.type === "tool_use" && item.name === "answer_survey"
    );
    if (answers.length !== 1) throw new Error("Expected one structured answer.");
    return answers[0]?.input;
  }
}
