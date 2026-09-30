import { createHash } from "node:crypto";
export function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
}
export function questionFingerprint(prompt: string, optionLabels: readonly string[]): string {
  return createHash("sha256")
    .update([normalizeText(prompt), ...optionLabels.map(normalizeText)].join("|"))
    .digest("hex")
    .slice(0, 32);
}
