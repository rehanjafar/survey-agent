import type { PageState } from "../../browser/types.js";
/** Explicit terminal messages only; a survey question mentioning disqualification is not an outcome. */
export function swagbucksOutcome(
  page: PageState
): "survey_screened_out" | "survey_unavailable" | undefined {
  if (
    page.controls.some(
      (control) =>
        ["radio", "checkbox", "select", "text", "number", "textarea"].includes(control.kind) &&
        !control.disabled
    )
  )
    return undefined;
  const text = `${page.title}\n${page.text}`;
  if (
    /\b(?:you (?:did not|do not|didn't|don't) qualify for (?:this|the) survey|you (?:have been|were) disqualified|not every survey can be a winner|you (?:have been|were) screened out)\b/i.test(
      text
    )
  )
    return "survey_screened_out";
  if (
    /\b(?:(?:this|the) survey is (?:now )?(?:full|unavailable|closed)|survey (?:has reached|reached) its quota)\b/i.test(
      text
    )
  )
    return "survey_unavailable";
  return undefined;
}
