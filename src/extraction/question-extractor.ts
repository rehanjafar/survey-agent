import type { InteractiveControl, PageState } from "../browser/index.js";
import type { NormalizedQuestion, SurveyOption } from "../domain/survey.js";
import { questionFingerprint } from "../normalization/question-normalizer.js";

export function extractCurrentQuestion(state: PageState): NormalizedQuestion | undefined {
  return extractQuestions(state)[0];
}
export function extractQuestions(state: PageState): NormalizedQuestion[] {
  const controls = state.controls.filter(
    (control) => !control.disabled && control.kind !== "button"
  );
  const questions: NormalizedQuestion[] = [];
  const consumed = new Set<string>();
  const origin = new URL(state.url).origin;
  for (const control of controls) {
    if (consumed.has(control.selector)) continue;
    if (control.kind === "other" || control.inputType === "password")
      throw new Error("Unsupported question controls.");
    if (control.matrix) {
      const cells = controls.filter((candidate) => candidate.matrix === control.matrix);
      cells.forEach((cell) => consumed.add(cell.selector));
      const rows = [...new Set(cells.map((cell) => cell.row))].map((row, index) => ({
        id: String(index),
        label: cells.find((cell) => cell.row === row)?.rowLabel ?? "",
        options: cells.filter((cell) => cell.row === row).map(toOption)
      }));
      if (rows.some((row) => !row.label || !row.options.length))
        throw new Error("Matrix lacks row or column labels.");
      const prompt = control.question;
      if (!prompt) throw new Error("Matrix needs a question caption.");
      questions.push({
        fingerprint: questionFingerprint(
          prompt,
          rows.flatMap((row) => [row.label, ...row.options.map((option) => option.label)]),
          origin + ":matrix"
        ),
        prompt,
        type: "matrix",
        rows,
        options: [],
        required: true
      });
      continue;
    }
    const group = ["radio", "checkbox"].includes(control.kind)
      ? controls.filter(
          (candidate) =>
            candidate.kind === control.kind &&
            (control.name
              ? candidate.name === control.name && candidate.group === control.group
              : Boolean(control.group) && candidate.group === control.group)
        )
      : [control];
    if (!group.length) throw new Error("Choice controls have no semantic group.");
    group.forEach((item) => consumed.add(item.selector));
    const prompt = questionPrompt(state, control);
    const options =
      control.kind === "select"
        ? control.options
            .filter((option) => !option.disabled && option.value !== "")
            .map((option) => ({
              id: option.value,
              label: option.label,
              selector: control.selector,
              value: option.value
            }))
        : ["radio", "checkbox"].includes(control.kind)
          ? group.map(toOption)
          : [];
    if (
      options.some((option) => !option.label) ||
      new Set(options.map((option) => option.label)).size !== options.length
    )
      throw new Error("Ambiguous or missing option labels.");
    const type: NormalizedQuestion["type"] =
      control.kind === "radio"
        ? control.scale
          ? "scale"
          : "single_choice"
        : control.kind === "checkbox"
          ? "multiple_choice"
          : control.kind === "select"
            ? "dropdown"
            : control.kind === "number"
              ? "numeric"
              : "text";
    const factKey = inferFactKey(prompt);
    const constraints = {
      ...(control.min !== undefined ? { min: control.min } : {}),
      ...(control.max !== undefined ? { max: control.max } : {}),
      ...(control.step !== undefined ? { step: control.step } : {}),
      ...(control.maxLength !== undefined ? { maxLength: control.maxLength } : {})
    };
    questions.push({
      fingerprint: questionFingerprint(
        prompt,
        options.map((option) => option.label),
        JSON.stringify([origin, type, constraints])
      ),
      prompt,
      type,
      options,
      rows: [],
      required: group.some((item) => item.required),
      ...(["text", "numeric", "dropdown"].includes(type)
        ? { inputSelector: control.selector }
        : {}),
      ...(factKey ? { factKey } : {}),
      ...constraints
    });
  }
  return questions;
}
function toOption(control: InteractiveControl): SurveyOption {
  return {
    id: control.value || control.id || control.selector,
    label: control.label,
    selector: control.selector,
    value: control.value
  };
}
function questionPrompt(state: PageState, control: InteractiveControl): string {
  if (control.question?.trim()) return control.question.trim();
  const candidates = state.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith("?"));
  if (candidates.length === 1) return candidates[0]!;
  if (["text", "number", "textarea", "select"].includes(control.kind) && control.label)
    return control.label;
  throw new Error("Could not confidently associate a prompt with its controls.");
}
// Exact, conservative bindings only; website data-fact-key attributes are not trusted.
export function inferFactKey(prompt: string): string | undefined {
  const cleaned = prompt.toLowerCase().replace(/[?*:]/g, "").trim();
  const bindings: Record<string, string> = {
    age: "age",
    "what is your age": "age",
    "how old are you": "age",
    country: "country",
    "what country do you live in": "country",
    "which country do you live in": "country",
    "household size": "household_size",
    "how many people live in your household": "household_size",
    "which color do you prefer": "preferred_color",
    "preferred color": "preferred_color"
  };
  return bindings[cleaned];
}
