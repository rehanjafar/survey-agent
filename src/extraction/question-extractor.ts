import type { InteractiveControl, PageState } from "../browser/index.js";
import type { NormalizedQuestion, SurveyOption } from "../domain/survey.js";
import { questionFingerprint } from "../normalization/question-normalizer.js";

/** Extracts one active question from an already captured page state; it never navigates or acts. */
export function extractCurrentQuestion(state: PageState): NormalizedQuestion | undefined {
  const controls = state.controls.filter((control) => !control.disabled);
  const grouped = new Map<string, InteractiveControl[]>();
  for (const control of controls)
    if (control.kind === "radio" || control.kind === "checkbox") {
      const key = `${control.kind}:${control.name || control.selector}`;
      grouped.set(key, [...(grouped.get(key) ?? []), control]);
    }
  const choiceGroup = [...grouped.values()].find((group) => group.length > 0);
  if (choiceGroup) {
    const type = choiceGroup[0]?.kind === "radio" ? "single_choice" : "multiple_choice";
    const options = choiceGroup.map(toOption);
    return question(
      questionPrompt(state, choiceGroup),
      type,
      options,
      choiceGroup.some((x) => x.required)
    );
  }
  const dropdown = controls.find((control) => control.kind === "select");
  if (dropdown) {
    const options = dropdown.options
      .filter((option) => !option.disabled)
      .map((option, index) => ({
        id: option.value || String(index),
        label: option.label,
        selector: dropdown.selector,
        value: option.value
      }));
    return question(
      questionPrompt(state, [dropdown]),
      "dropdown",
      options,
      dropdown.required,
      dropdown.selector
    );
  }
  const input = controls.find(
    (control) => control.kind === "text" || control.kind === "textarea" || control.kind === "number"
  );
  if (input)
    return question(
      questionPrompt(state, [input]),
      input.kind === "number" ? "numeric" : "text",
      [],
      input.required,
      input.selector
    );
  return undefined;
}
function question(
  prompt: string,
  type: NormalizedQuestion["type"],
  options: readonly SurveyOption[],
  required: boolean,
  inputSelector?: string
): NormalizedQuestion {
  const base = {
    fingerprint: questionFingerprint(
      prompt,
      options.map((option) => option.label)
    ),
    prompt,
    type,
    options,
    rows: [],
    required
  };
  return inputSelector ? { ...base, inputSelector } : base;
}
function toOption(control: InteractiveControl): SurveyOption {
  return {
    id: control.value || control.id || control.selector,
    label: control.label || control.value,
    selector: control.selector,
    value: control.value
  };
}
function questionPrompt(state: PageState, controls: readonly InteractiveControl[]): string {
  const labels = controls.map((control) => control.label).filter(Boolean);
  const text = state.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    text.find((line) => !labels.includes(line) && line.length > 3) ??
    labels[0] ??
    "Untitled question"
  );
}
