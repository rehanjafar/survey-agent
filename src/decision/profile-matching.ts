import { normalizeText } from "../normalization/question-normalizer.js";
/** Conservative semantic equivalence: exact text or numeric bands, never a new personal fact. */
export function optionRepresentsFact(fact: string, label: string): boolean {
  if (normalizeText(fact) === normalizeText(label)) return true;
  if (!/^\d+(?:\.\d+)?$/.test(fact.trim())) return false;
  const value = Number(fact);
  const text = label
    .toLowerCase()
    .trim()
    .replace(/\s+(?:years?(?: old)?|people|persons?|members?)$/, "")
    .trim();
  const range = text.match(/^(\d+(?:\.\d+)?)\s*(?:[-–—]|to)\s*(\d+(?:\.\d+)?)$/);
  if (range) return value >= Number(range[1]) && value <= Number(range[2]);
  const lower = text.match(/^(\d+(?:\.\d+)?)\s*(?:\+|or (?:older|more|above))$/);
  if (lower) return value >= Number(lower[1]);
  const under = text.match(/^(?:under|less than)\s+(\d+(?:\.\d+)?)$/);
  if (under) return value < Number(under[1]);
  const upper = text.match(/^(\d+(?:\.\d+)?)\s+or (?:younger|less|below)$/);
  if (upper) return value <= Number(upper[1]);
  return /^\d+(?:\.\d+)?$/.test(text) && value === Number(text);
}
