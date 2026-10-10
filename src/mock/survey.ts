export function mockSurvey(pathname: string): string {
  const shell = (body: string) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Local survey practice</title></head><body><main>${body}</main></body></html>`;
  const next = (path: string, label = "Next") =>
    `<button type="submit">${label}</button></form><p>Local practice only. No rewards or outside services.</p>`;
  if (pathname === "/mock/eureka")
    return shell(
      '<h1>Available surveys</h1><a role="button" href="/mock/choice">Technology preferences — $1.20 — 3 minutes</a><a role="button" href="/mock/choice">Long survey — $2.00 — 20 minutes</a>'
    );
  if (pathname === "/mock/complete") return shell("<h1 data-survey-complete>Survey complete</h1>");
  if (pathname === "/mock/captcha") return shell("<h1>Verify you are human</h1>");
  if (pathname === "/mock/login")
    return shell('<h1>Sign in to continue</h1><label>Password <input type="password"></label>');
  if (pathname === "/mock/unsupported")
    return shell('<h1>Custom widget</h1><div role="slider" tabindex="0">Custom slider</div>');
  if (pathname === "/mock/numeric")
    return shell(
      '<form action="/mock/multi"><label for="age">How old are you?</label><input id="age" name="age" type="number" required min="18" max="120" step="1">' +
        next("/mock/multi")
    );
  if (pathname === "/mock/multi")
    return shell(
      '<form action="/mock/dropdown"><fieldset><legend>Which activities do you enjoy?</legend><label><input type="checkbox" name="interests" value="books">Reading</label><label><input type="checkbox" name="interests" value="walks">Walking</label></fieldset>' +
        next("/mock/dropdown")
    );
  if (pathname === "/mock/dropdown")
    return shell(
      '<form action="/mock/text"><label for="country">What country do you live in?</label><select id="country" name="country" required><option value="">Choose…</option><option value="ca">Canada</option><option value="us">United States</option></select>' +
        next("/mock/text")
    );
  if (pathname === "/mock/text")
    return shell(
      '<form action="/mock/matrix"><label for="feedback">What would improve this experience?</label><textarea id="feedback" name="feedback" required maxlength="500"></textarea>' +
        next("/mock/matrix")
    );
  if (pathname === "/mock/matrix")
    return shell(
      '<form action="/mock/complete"><table><caption>How satisfied are you with these features?</caption><thead><tr><th>Feature</th><th>Satisfied</th><th>Unsatisfied</th></tr></thead><tbody>' +
        ["Speed", "Clarity"]
          .map(
            (label, index) =>
              `<tr><th>${label}</th><td><input aria-label="Satisfied" type="radio" name="row${index}" value="yes" required></td><td><input aria-label="Unsatisfied" type="radio" name="row${index}" value="no"></td></tr>`
          )
          .join("") +
        "</tbody></table>" +
        next("/mock/complete", "Submit")
    );
  return shell(
    '<form action="/mock/numeric"><h1>Welcome to practice</h1><fieldset><legend>Which color do you prefer?</legend><label><input type="radio" name="color" value="blue" required>Blue</label><label><input type="radio" name="color" value="green">Green</label></fieldset>' +
      next("/mock/numeric")
  );
}
