/** Normalize display numbers for deterministic offer parsing; never translate answer labels. */
export function offerNumberText(text: string, language?: string): string {
  let locale = "en-US";
  try {
    if (language && Intl.NumberFormat.supportedLocalesOf([language]).length) locale = language;
  } catch {
    // Invalid HTML language hints must not interrupt a survey.
  }
  const format = new Intl.NumberFormat(locale);
  const parts = format.formatToParts(12345.6);
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  const group = parts.find((part) => part.type === "group")?.value;
  let result = text.normalize("NFKC");
  for (let digit = 0; digit <= 9; digit++) {
    const local = new Intl.NumberFormat(locale, { useGrouping: false }).format(digit);
    result = result.replaceAll(local.normalize("NFKC"), String(digit));
  }
  return result.replace(/[0-9][0-9.,\u066b\u066c\s]*[0-9]|[0-9]/gu, (number) => {
    let value = number;
    if (group) value = value.replaceAll(group.normalize("NFKC"), "");
    return value.replaceAll(decimal.normalize("NFKC"), ".");
  });
}

/** Intl supplies minute names and plural forms for the document locale. */
export function minuteDurations(text: string, language?: string): number[] {
  const units = new Set(["min", "mins", "minute", "minutes"]);
  try {
    if (language) {
      for (const unitDisplay of ["long", "short", "narrow"] as const) {
        const format = new Intl.NumberFormat(language, {
          style: "unit",
          unit: "minute",
          unitDisplay
        });
        for (const n of [0, 1, 2, 3, 5, 11, 21, 100]) {
          for (const part of format.formatToParts(n)) {
            if (part.type === "unit") units.add(part.value.normalize("NFKC"));
          }
        }
      }
    }
  } catch {
    // Fall back to standard minute abbreviations for missing/invalid locale metadata.
  }
  const names = [...units]
    .sort((a, b) => b.length - a.length)
    .map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return [
    ...text.matchAll(new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*(?:${names})(?![\\p{L}\\p{N}])`, "giu"))
  ].map((match) => Number(match[1]));
}
