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
  const roots: (Document | ShadowRoot)[] = [document];
  for (let i = 0; i < roots.length; i++)
    for (const element of Array.from(roots[i]!.querySelectorAll("*")))
      if (element.shadowRoot) roots.push(element.shadowRoot);
  const queryAll = (selector: string): HTMLElement[] =>
    roots.flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>(selector)));
  const selectorFor = (element: Element): string => {
    const root = element.getRootNode() as Document | ShadowRoot;
    const scope = root instanceof ShadowRoot ? selectorFor(root.host) + " >> " : "";
    if (element.id && root.querySelectorAll("#" + CSS.escape(element.id)).length === 1)
      return scope + "#" + CSS.escape(element.id);
    const parent = element.parentElement;
    if (!parent) return scope + element.tagName.toLowerCase();
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
      .filter(Boolean)
      .map((id) =>
        text((element.getRootNode() as Document | ShadowRoot).querySelector("#" + CSS.escape(id)))
      )
      .filter(Boolean)
      .join(" ");
  const kind = (element: Element): InteractiveControlKind => {
    if (element.matches("[role=radio]")) return "radio";
    if (element.matches("[role=checkbox]")) return "checkbox";
    if (element.matches('[contenteditable="true"][role="textbox"]')) return "textarea";
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
  const elements = queryAll(
    'input,select,textarea,button,a[href],[role=button],[role=radio],[role=checkbox],[role=slider],[role=combobox],[contenteditable="true"][role="textbox"]'
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
      const group = element.closest(
        "fieldset,[role=group],[role=radiogroup],[data-question],.QuestionOuter,.question-container,.sv-question"
      );
      const table = element.closest("table");
      const row = element.closest("tr");
      const question =
        text(
          group?.querySelector(
            "legend,[data-question-text],.QuestionText,.sv-question__title,h2,h3"
          ) ?? null
        ) ||
        (group ? group.getAttribute("aria-label") || ariaText(group) : "") ||
        element.getAttribute("data-question-text") ||
        "";
      const labels = input ? Array.from(input.labels ?? []).map(text) : [];
      let label =
        element.getAttribute("aria-label") ||
        ariaText(element) ||
        [...new Set(labels)].join(" ") ||
        (input ? (element.getAttribute("placeholder") ?? "") : text(element)) ||
        (input && ["submit", "button", "reset"].includes(input.type) ? input.value : "");
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
        questionPrompt: question,
        offerText:
          element
            .closest<HTMLElement>(
              "article,li,[data-testid='study-card'],[data-testid='survey-card'],.study-card,.survey-card"
            )
            ?.innerText.trim()
            .slice(0, 4000) ?? "",
        selector: selectorFor(element),
        id: element.id,
        name: element.getAttribute("name") ?? "",
        label,
        ariaLabel: element.getAttribute("aria-label") ?? "",
        placeholder: element.getAttribute("placeholder") ?? "",
        value: input?.value ?? element.getAttribute("value") ?? "",
        href: element instanceof HTMLAnchorElement ? element.href : "",
        checked:
          element instanceof HTMLInputElement
            ? element.checked
            : element.getAttribute("aria-checked") === "true",
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
  const pageText = [
    document.body?.innerText ?? "",
    ...roots.slice(1).map((root) =>
      Array.from(root.children)
        .filter(visible)
        .map((element) => (element as HTMLElement).innerText || "")
        .join("\n")
    )
  ]
    .join("\n")
    .trim()
    .slice(0, maxText);
  return {
    url: location.href,
    title: document.title,
    text: pageText,
    controls,
    captchaResponsePresent: queryAll(
      '[name="g-recaptcha-response"],[name="h-captcha-response"],[name="cf-turnstile-response"]'
    ).some(
      (input) =>
        (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) &&
        input.value.trim().length > 0
    ),
    captchaDetected: queryAll("iframe").some((element) => {
      const frame = element as HTMLIFrameElement;
      return (
        visible(frame) &&
        /captcha|challenge|verify you are human/i.test(`${frame.title} ${frame.src}`)
      );
    }),
    hasCaptcha:
      Boolean(
        queryAll(
          "iframe[src*='recaptcha'],iframe[src*='hcaptcha'],iframe[src*='challenges.cloudflare.com'],[class*='g-recaptcha'],[class*='h-captcha'],[data-sitekey]"
        ).length
      ) || /\b(captcha|verify you are human)\b/i.test(pageText),
    hasAuthentication:
      controls.some((control) => control.inputType === "password") ||
      /\b(sign in to continue|log in to continue|session expired|authentication failed|verification code)\b/i.test(
        pageText
      ),
    frames: queryAll("iframe")
      .filter(visible)
      .map((frame) => ({ selector: selectorFor(frame) })),
    hasUnsupported: controls.some((control) => control.kind === "other"),
    complete:
      Boolean(document.querySelector("[data-survey-complete]")) ||
      /^(survey complete|thank you for completing (the|this) survey)[.!]?$/im.test(pageText),
    validationErrors: Array.from(document.querySelectorAll("[role=alert],[aria-invalid=true]"))
      .filter(visible)
      .map(text)
      .filter(Boolean)
  };
}
