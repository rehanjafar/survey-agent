import { expect, it } from "vitest";
import { discoverSurveyDestination } from "../../src/platforms/generic/discovery.js";
import type { InteractiveControl, PageState } from "../../src/browser/types.js";
const control = (label: string, selector: string, offerText = ""): InteractiveControl => ({
  kind: "button",
  selector,
  label,
  offerText,
  id: "",
  name: "",
  ariaLabel: "",
  placeholder: "",
  value: "",
  href: "",
  checked: false,
  disabled: false,
  required: false,
  options: []
});
const page = (controls: InteractiveControl[]): PageState => ({
  url: "https://arbitrary-authorized.test/",
  title: "My panel",
  text: "",
  controls
});
it("discovers a survey hub independent of platform identity", () => {
  expect(
    discoverSurveyDestination(
      page([control("Available surveys", "#surveys"), control("Redeem rewards", "#cash")]),
      new Set()
    )
  ).toMatchObject({ selector: "#surveys", kind: "hub" });
});
it("chooses advertised value without changing participant facts, and respects configured filters", () => {
  const p = page([
    control("Start survey", "#slow", "$5 · 60 min"),
    control("View study", "#fast", "$2 · 5 min")
  ]);
  expect(discoverSurveyDestination(p, new Set())?.selector).toBe("#fast");
  expect(
    discoverSurveyDestination(p, new Set(), {
      unit: "$",
      minimumHourlyReward: 50,
      maxDurationMinutes: 30
    })
  ).toBeUndefined();
});
it("does not guess between unrelated hubs, revisit attempted destinations or accept consent", () => {
  const p = page([control("Studies", "#studies"), control("Surveys", "#surveys")]);
  expect(discoverSurveyDestination(p, new Set())).toBeUndefined();
  const single = page([control("Start survey", "#start")]);
  const first = discoverSurveyDestination(single, new Set())!;
  expect(discoverSurveyDestination(single, new Set([first.key]))).toBeUndefined();
  expect(
    discoverSurveyDestination(page([control("Accept study consent", "#consent")]), new Set())
  ).toBeUndefined();
});
