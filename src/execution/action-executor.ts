import type { BrowserSession } from "../browser/index.js";
import type { SurveyAction } from "../domain/survey.js";
export async function executeAction(session: BrowserSession, action: SurveyAction): Promise<void> {
  switch (action.kind) {
    case "select_one":
      return session.selectRadio(action.selector);
    case "set_many":
      for (const item of action.selections) await session.setCheckbox(item.selector, item.checked);
      return;
    case "select_dropdown":
      return session.selectDropdown(action.selector, action.value);
    case "fill":
      return session.type(action.selector, action.value);
    case "answer_matrix":
      for (const item of action.selections) await session.selectRadio(item.selector);
      return;
    case "continue":
      return session.click(action.selector);
  }
}
