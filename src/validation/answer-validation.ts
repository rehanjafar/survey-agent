import type { NormalizedQuestion, SurveyAction } from "../domain/survey.js";
import type { ProviderDecision } from "../providers/types.js";
import { parseDecision } from "../providers/decision-schema.js";

/** The only path from an answer to browser actions. Never accepts selectors from a model or user. */
export function validateAnswer(
  question: NormalizedQuestion,
  input: ProviderDecision
): SurveyAction {
  const answer = parseDecision(input);
  if (
    [answer.selectedOption, answer.selectedOptions, answer.value, answer.matrix].filter(
      (item) => item !== undefined
    ).length !== 1
  )
    throw new Error("Provide exactly one answer field.");
  const option = (label: string) => {
    const matches = question.options.filter((item) => item.label === label);
    if (matches.length !== 1) throw new Error("Answer must match one unambiguous option.");
    return matches[0]!;
  };
  switch (question.type) {
    case "single_choice":
    case "scale":
    case "dropdown": {
      if (answer.selectedOption === undefined) throw new Error("A single option is required.");
      const selected = option(answer.selectedOption);
      if (question.type === "dropdown") {
        if (selected.value === undefined) throw new Error("Dropdown option has no value.");
        return { kind: "select_dropdown", selector: selected.selector, value: selected.value };
      }
      return { kind: "select_one", selector: selected.selector };
    }
    case "multiple_choice": {
      const selected = answer.selectedOptions;
      if (
        !selected ||
        (question.required && selected.length === 0) ||
        new Set(selected).size !== selected.length
      )
        throw new Error("Invalid multiple selection.");
      selected.forEach(option);
      return {
        kind: "set_many",
        selections: question.options.map((item) => ({
          selector: item.selector,
          checked: selected.includes(item.label)
        }))
      };
    }
    case "matrix": {
      if (
        !answer.matrix ||
        answer.matrix.length !== question.rows.length ||
        new Set(answer.matrix.map((x) => x.row)).size !== question.rows.length
      )
        throw new Error("Every matrix row needs one answer.");
      return {
        kind: "answer_matrix",
        selections: question.rows.map((row) => {
          const selected = answer.matrix!.find((entry) => entry.row === row.id);
          const matches = row.options.filter((item) => item.label === selected?.option);
          if (matches.length !== 1) throw new Error("Invalid matrix option.");
          return { selector: matches[0]!.selector };
        })
      };
    }
    case "text":
    case "numeric": {
      if (
        answer.value === undefined ||
        !question.inputSelector ||
        (question.required && !answer.value.trim())
      )
        throw new Error("A value is required.");
      if (answer.value.length > (question.maxLength ?? 5000))
        throw new Error("Answer is too long.");
      if (question.type === "numeric") {
        if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(answer.value))
          throw new Error("A finite number is required.");
        const value = Number(answer.value);
        if (
          !Number.isFinite(value) ||
          (question.min !== undefined && value < question.min) ||
          (question.max !== undefined && value > question.max)
        )
          throw new Error("Number is outside the allowed range.");
        if (question.step !== undefined && question.step > 0) {
          const steps = (value - (question.min ?? 0)) / question.step;
          if (Math.abs(steps - Math.round(steps)) > 1e-8)
            throw new Error("Number does not match the required increment.");
        }
      }
      return { kind: "fill", selector: question.inputSelector, value: answer.value };
    }
  }
}
