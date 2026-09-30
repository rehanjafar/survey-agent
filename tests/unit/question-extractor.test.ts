import { describe, expect, it } from "vitest";
import { extractCurrentQuestion } from "../../src/extraction/question-extractor.js";
describe("extractCurrentQuestion", () => {
  it("extracts only the active MCQ and its options", () => {
    const question = extractCurrentQuestion({
      url: "http://127.0.0.1/mock",
      title: "Mock",
      text: "Which color do you prefer?\nRed\nBlue\nUnrelated footer text",
      controls: [
        {
          kind: "radio",
          selector: "#red",
          id: "red",
          name: "color",
          label: "Red",
          ariaLabel: "",
          placeholder: "",
          value: "red",
          href: "",
          checked: false,
          disabled: false,
          required: true,
          options: []
        },
        {
          kind: "radio",
          selector: "#blue",
          id: "blue",
          name: "color",
          label: "Blue",
          ariaLabel: "",
          placeholder: "",
          value: "blue",
          href: "",
          checked: false,
          disabled: false,
          required: true,
          options: []
        }
      ]
    });
    expect(question).toMatchObject({
      prompt: "Which color do you prefer?",
      type: "single_choice",
      options: [{ label: "Red" }, { label: "Blue" }]
    });
  });
});
