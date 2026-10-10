import type { InteractiveControl, InteractiveControlKind, PageState } from "./types.js";

/** Runs inside the page. Do not add imports or model calls inside this function. */
export function snapshot(maxText: number): PageState {
  const visible = (element: Element) => {
    const style = getComputedStyle(element);
    return (
      element.getClientRects().length > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      !element.closest("[hidden],[inert]")
    );
  };
  const selectorFor = (element: Element): string => {
    if (element.id && document.querySelectorAll("#" + CSS.escape(element.id)).length === 1)
      return "#" + CSS.escape(element.id);
    const parent = element.parentElement;
    if (!parent) return element.tagName.toLowerCase();
    const siblings = Array.from(parent.children).filter(
      (child) => child.tagName === element.tagName
    );
    return (
      selectorFor(parent) +
      " > " +
      element.tagName.toLowerCase() +
      ":nth-of-type(" +
      (siblings.indexOf(element) + 1) +
      ")"
    );
  };
  const text = (element: Element | null): string =>
    element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const ariaText = (element: Element) =>
    (element.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id) => text(document.getElementById(id)))
      .filter(Boolean)
      .join(" ");
  const kind = (element: Element): InteractiveControlKind => {
    if (element.matches("button,a[href],[role=button]")) return "button";
    if (element instanceof HTMLSelectElement) return element.multiple ? "other" : "select";
    if (element instanceof HTMLTextAreaElement) return "textarea";
    if (element instanceof HTMLInputElement) {
      if (["button", "submit", "reset"].includes(element.type)) return "button";
      if (["radio", "checkbox", "number"].includes(element.type))
        return element.type as InteractiveControlKind;
      if (["text", "email", "tel", "url", "search", "password"].includes(element.type))
        return "text";
    }
    return "other";
  };
  const elements = Array.from(
    document.querySelectorAll<HTMLElement>(
      "input,select,textarea,button,a[href],[role=button],[role=radio],[role=checkbox],[role=slider],[role=combobox]"
    )
  );
  const controls: InteractiveControl[] = elements
    .filter((element) => {
      if (element instanceof HTMLInputElement && element.type === "hidden") return false;
      return (
        visible(element) ||
        (element instanceof HTMLInputElement &&
          ["radio", "checkbox"].includes(element.type) &&
          Array.from(element.labels ?? []).some(visible))
      );
    })
    .map((element) => {
      const input =
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
          ? element
          : undefined;
      const group = element.closest("fieldset,[role=group],[role=radiogroup],[data-question]");
      const table = element.closest("table");
      const row = element.closest("tr");
      const question =
        text(group?.querySelector("legend,[data-question-text],h2,h3") ?? null) ||
        (group ? ariaText(group) : "") ||
        element.getAttribute("data-question-text") ||
        "";
      const labels = input ? Array.from(input.labels ?? []).map(text) : [];
      let label =
        element.getAttribute("aria-label") ||
        ariaText(element) ||
        [...new Set(labels)].join(" ") ||
        (input ? (element.getAttribute("placeholder") ?? "") : text(element));
      if (table && row && input && input.type === "radio") {
        const cell = element.closest("td");
        const index = cell ? Array.from(row.children).indexOf(cell) : -1;
        label =
          text(
            table.querySelector("thead tr")?.children.item(index) ??
              table.querySelector("tr")?.children.item(index) ??
              null
          ) || label;
      }
      const attributeNumber = (name: string) => {
        const raw = element.getAttribute(name);
        return raw !== null && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
      };
      const min = attributeNumber("min"),
        max = attributeNumber("max"),
        step = attributeNumber("step"),
        maxLength = attributeNumber("maxlength");
      return {
        kind: kind(element),
        selector: selectorFor(element),
        id: element.id,
        name: element.getAttribute("name") ?? "",
        label,
        ariaLabel: element.getAttribute("aria-label") ?? "",
        placeholder: element.getAttribute("placeholder") ?? "",
        value: input?.value ?? element.getAttribute("value") ?? "",
        href: element instanceof HTMLAnchorElement ? element.href : "",
        checked: element instanceof HTMLInputElement ? element.checked : false,
        disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
        required: input?.required ?? false,
        options:
          element instanceof HTMLSelectElement
            ? Array.from(element.options).map((option) => ({
                label: option.label,
                value: option.value,
                selected: option.selected,
                disabled:
                  option.disabled ||
                  (option.parentElement instanceof HTMLOptGroupElement &&
                    option.parentElement.disabled)
              }))
            : [],
        question: table
          ? text(table.querySelector("caption")) || question
          : question || (input && !["radio", "checkbox"].includes(input.type) ? label : ""),
        group: group ? selectorFor(group) : "",
        inputType: element.getAttribute("type") ?? "",
        ...(element.getAttribute("data-fact-key")
          ? { factKey: element.getAttribute("data-fact-key")! }
          : {}),
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(step !== undefined ? { step } : {}),
        ...(maxLength !== undefined ? { maxLength } : {}),
        ...(table && row && input?.type === "radio"
          ? {
              matrix: selectorFor(table),
              row: selectorFor(row),
              rowLabel: text(row.querySelector("th"))
            }
          : {}),
        scale: group?.getAttribute("data-question-type") === "scale"
      };
    });
  const pageText = document.body?.innerText.trim().slice(0, maxText) ?? "";
  return {
    url: location.href,
    title: document.title,
    text: pageText,
    controls,
    hasCaptcha:
      Boolean(
        document.querySelector(
          "iframe[src*='recaptcha'],iframe[src*='hcaptcha'],[class*='g-recaptcha'],[class*='h-captcha'],[data-sitekey]"
        )
      ) || /\b(captcha|verify you are human)\b/i.test(pageText),
    hasAuthentication:
      controls.some((control) => control.inputType === "password") ||
      /\b(sign in to continue|log in to continue|session expired|authentication failed|verification code)\b/i.test(
        pageText
      ),
    hasUnsupported:
      controls.some((control) => control.kind === "other") ||
      Array.from(document.querySelectorAll("iframe")).some(visible),
    complete:
      Boolean(document.querySelector("[data-survey-complete]")) ||
      /^(survey complete|thank you for completing (the|this) survey)[.!]?$/im.test(pageText),
    validationErrors: Array.from(document.querySelectorAll("[role=alert],[aria-invalid=true]"))
      .filter(visible)
      .map(text)
      .filter(Boolean)
  };
}
