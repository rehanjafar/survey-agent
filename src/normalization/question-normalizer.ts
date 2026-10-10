import { createHash } from "node:crypto";
export function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}
export function questionFingerprint(
  prompt: string,
  optionLabels: readonly string[],
  context = ""
): string {
  return createHash("sha256")
    .update(JSON.stringify([normalizeText(prompt), optionLabels.map(normalizeText), context]))
    .digest("hex");
}
