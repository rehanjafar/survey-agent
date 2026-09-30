import { z } from "zod";
import type { LlmProvider, ProviderDecision, ProviderQuestion } from "./types.js";
const decisionSchema = z.object({
  selectedOption: z.string().optional(),
  value: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(500)
});
const instructions =
  "Return only JSON matching {selectedOption?:string,value?:string,confidence:number,reason:string}. Choose an option exactly when options are present. Never invent user facts.";
abstract class JsonHttpProvider implements LlmProvider {
  public constructor(private readonly apiKey: string) {}
  public async decide(question: ProviderQuestion): Promise<ProviderDecision> {
    const response = await fetch(this.endpoint(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(this.body(question))
    });
    if (!response.ok) throw new Error(`LLM request failed with HTTP ${response.status}.`);
    const parsed = decisionSchema.parse(this.extract(await response.json()));
    return {
      ...(parsed.selectedOption ? { selectedOption: parsed.selectedOption } : {}),
      ...(parsed.value ? { value: parsed.value } : {}),
      confidence: parsed.confidence,
      reason: parsed.reason
    };
  }
  protected abstract endpoint(): string;
  protected abstract headers(): Record<string, string>;
  protected abstract body(question: ProviderQuestion): unknown;
  protected abstract extract(response: unknown): unknown;
  protected payload(question: ProviderQuestion): string {
    return JSON.stringify(question);
  }
  protected get key(): string {
    return this.apiKey;
  }
}
export class OpenAIProvider extends JsonHttpProvider {
  protected endpoint(): string {
    return "https://api.openai.com/v1/responses";
  }
  protected headers(): Record<string, string> {
    return { authorization: `Bearer ${this.key}`, "content-type": "application/json" };
  }
  protected body(question: ProviderQuestion): unknown {
    return {
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: instructions },
        { role: "user", content: this.payload(question) }
      ],
      text: { format: { type: "json_object" } }
    };
  }
  protected extract(response: unknown): unknown {
    const item = response as { output_text?: string };
    return JSON.parse(item.output_text ?? "");
  }
}
export class AnthropicProvider extends JsonHttpProvider {
  protected endpoint(): string {
    return "https://api.anthropic.com/v1/messages";
  }
  protected headers(): Record<string, string> {
    return {
      "x-api-key": this.key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    };
  }
  protected body(question: ProviderQuestion): unknown {
    return {
      model: "claude-haiku-4-5",
      max_tokens: 250,
      system: instructions,
      messages: [{ role: "user", content: this.payload(question) }]
    };
  }
  protected extract(response: unknown): unknown {
    const item = response as { content?: Array<{ text?: string }> };
    return JSON.parse(item.content?.[0]?.text ?? "");
  }
}
