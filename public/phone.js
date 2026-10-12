const $ = (id) => document.getElementById(id);
// Fragments never reach the server/proxy; retain only within this phone tab for refresh.
const token = location.hash.slice(1) || sessionStorage.getItem("answer-token") || "";
if (location.hash) {
  sessionStorage.setItem("answer-token", token);
  history.replaceState(null, "", location.pathname);
}
let question;
async function api(path, answer) {
  const response = await fetch(path, {
    method: answer ? "POST" : "GET",
    headers: { "x-answer-token": token, ...(answer ? { "content-type": "application/json" } : {}) },
    ...(answer ? { body: JSON.stringify(answer) } : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to reach the laptop.");
  return data;
}
function choice(parent, name, value, multiple = false) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = multiple ? "checkbox" : "radio";
  input.name = name;
  input.value = value;
  label.append(input, document.createTextNode(value));
  parent.append(label);
}
async function load() {
  try {
    const data = await api("/question");
    if (data.busy) {
      $("status").textContent = "The laptop is finishing its check…";
      setTimeout(load, 1500);
      return;
    }
    question = data.question;
    $("status").textContent = data.test
      ? "Test connection — no survey answer will be submitted."
      : "The survey is waiting for you.";
    $("question").textContent = question.question;
    $("controls").replaceChildren();
    $("other-controls").replaceChildren();
    const options = question.options || [];
    if (options.length) {
      // First four in original survey order, never demographic guesses or popularity claims.
      options.forEach((value, index) =>
        choice(
          $(index < 4 ? "controls" : "other-controls"),
          "answer",
          value,
          question.type === "multiple_choice"
        )
      );
      $("more").hidden = options.length <= 4;
      $("filter").hidden = options.length <= 8;
    } else if (question.type === "matrix") {
      question.rows.forEach((row, index) => {
        const field = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = row.label;
        field.append(legend);
        row.options.forEach((value) => choice(field, `row-${index}`, value));
        $("controls").append(field);
      });
    } else {
      const input = document.createElement(question.type === "numeric" ? "input" : "textarea");
      if (question.type === "numeric") {
        input.type = "number";
        input.step = question.step ?? "any";
        for (const key of ["min", "max"])
          if (question[key] !== undefined) input[key] = question[key];
      }
      input.name = "answer";
      input.required = Boolean(question.required);
      if (question.maxLength !== undefined) input.maxLength = question.maxLength;
      input.setAttribute("aria-label", question.question);
      $("controls").append(input);
    }
    $("answer-form").hidden = false;
  } catch (error) {
    $("status").textContent =
      error.message + " Keep Tailscale connected and reopen the alert to retry.";
  }
}
$("filter").addEventListener("input", () => {
  const query = $("filter").value.toLocaleLowerCase();
  $("more").open = true;
  document.querySelectorAll("label").forEach((label) => {
    label.hidden = !label.textContent.toLocaleLowerCase().includes(query);
  });
});
$("answer-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const answer = { confidence: 1, reason: "Answered by the user from their phone." };
  if (question.type === "matrix") {
    answer.matrix = question.rows.map((row, index) => ({
      row: row.id,
      option: form.get(`row-${index}`)
    }));
    if (answer.matrix.some((row) => row.option === null)) {
      $("status").textContent = "Choose one answer for each row.";
      return;
    }
  } else if (question.type === "multiple_choice") {
    answer.selectedOptions = form.getAll("answer");
    if (question.required && !answer.selectedOptions.length) {
      $("status").textContent = "Choose at least one option.";
      return;
    }
  } else if (["text", "numeric"].includes(question.type)) answer.value = form.get("answer");
  else {
    answer.selectedOption = form.get("answer");
    if (answer.selectedOption === null) {
      $("status").textContent = "Choose an answer first. Check Show all choices if needed.";
      return;
    }
  }
  $("send").disabled = true;
  try {
    const data = await api("/answer", answer);
    $("status").textContent = data.message;
    $("answer-form").hidden = true;
    sessionStorage.removeItem("answer-token");
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("send").disabled = false;
  }
});
void load();
