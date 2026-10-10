import type { LlmProvider, ProviderQuestion } from "./types.js";
import { instructions } from "./decision-schema.js";

/** This provider performs no network requests and cannot incur model charges. */
export class NoCostProvider implements LlmProvider {
  public async decide() {
    return {
      confidence: 0,
      reason: "Copy the compact prompt to ChatGPT and paste the answer here."
    };
  }
}
export function chatPrompt(question: ProviderQuestion): string {
  return (
    instructions +
    "\n\n" +
    JSON.stringify(question) +
    "\nIf the facts do not establish an answer, ask me; do not invent it."
  );
}
