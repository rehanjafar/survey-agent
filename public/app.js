"use strict";
const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="survey-token"]').content;
let state;
let loadedSettings = false;
let questionKey = "";
let posting = false;
let editingFact = null;
const pretty = (value) => String(value).replaceAll("_", " ");
function notify(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
  $("notice").hidden = false;
}
async function api(path, body) {
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-survey-token": token, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
async function post(path, body = {}) {
  if (posting) return;
  posting = true;
  try {
    await api(path, body);
    $("notice").hidden = true;
    await refresh();
  } catch (error) {
    notify(error.message, true);
  } finally {
    posting = false;
  }
}
function showPanel(id) {
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.hidden = panel.id !== id;
  });
  document.querySelectorAll(".nav").forEach((button) => {
    const active = button.dataset.panel === id;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}
document
  .querySelectorAll(".nav")
  .forEach((button) => button.addEventListener("click", () => showPanel(button.dataset.panel)));
function item(title, detail, meta = "") {
  const element = document.createElement("div");
  element.className = "item";
  const heading = document.createElement("b");
  heading.textContent = title;
  element.append(heading);
  const body = document.createElement("div");
  body.textContent = detail;
  element.append(body);
  const note = document.createElement("small");
  note.textContent = meta;
  element.append(note);
  return element;
}
function list(id, items) {
  $(id).replaceChildren(...items);
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nothing here yet.";
    $(id).append(empty);
  }
}
function fillSettings(config) {
  $("start-url").value = config.startUrl;
  $("platform").value = config.platform;
  $("ranking").value = config.rankBy;
  $("domains").value = config.allowedDomains.join("\n");
  $("max-steps").value = config.maxSteps;
  $("step-delay").value = config.stepDelayMs;
  $("auto-submit").checked = config.autoSubmit;
  $("headless").checked = config.headless;
  $("restart-run").checked = config.restartLastRun;
}
async function refresh() {
  state = await api("state");
  $("connection").textContent = "Connected to local app";
  $("fact-count").textContent = state.stats.facts;
  $("answer-count").textContent = state.stats.answers;
  $("mapping-count").textContent = state.stats.mappings;
  const run = state.run;
  const status = run?.status || "ready";
  $("status").textContent = pretty(status);
  $("status").dataset.status = status;
  $("run-message").textContent =
    run?.message || "Set up your profile and connection, then start a survey.";
  $("run-url").textContent = run?.url || state.settings.startUrl;
  $("steps").textContent = run?.steps || 0;
  const active = ["running", "review", "paused"].includes(status);
  $("start").disabled = active || state.busy;
  $("demo").disabled = active || state.busy;
  $("pause").disabled = status !== "running";
  $("stop").disabled = !active;
  $("resume").disabled = !["paused", "review"].includes(status) || state.busy;
  $("data-dir").textContent = state.dataDirectory;
  if (!loadedSettings) {
    fillSettings(state.settings);
    loadedSettings = true;
  }
  list(
    "facts-list",
    state.facts.map((fact) => {
      const row = item(
        pretty(fact.key),
        fact.value,
        pretty(fact.kind) + " · " + (fact.established ? "confirmed" : "unconfirmed")
      );
      const edit = document.createElement("button");
      edit.className = "secondary";
      edit.textContent = "Correct";
      edit.addEventListener("click", () => {
        editingFact = fact;
        $("fact-key").value = "custom";
        $("custom-key").value = fact.key;
        $("custom-key").hidden = false;
        $("custom-key").required = true;
        $("custom-label").hidden = false;
        $("fact-value").value = fact.value;
        $("fact-kind").value = fact.kind;
        $("fact-confirmed").checked = fact.established;
        $("fact-value").focus();
        notify("Editing " + pretty(fact.key) + ". Saving asks you to confirm this correction.");
      });
      row.append(edit);
      return row;
    })
  );
  list(
    "runs-list",
    state.runs.map((entry) =>
      item(
        pretty(entry.status) + " · " + entry.steps + " actions",
        entry.message,
        new Date(entry.updatedAt).toLocaleString()
      )
    )
  );
  list(
    "events-list",
    state.events.map((entry) => item(pretty(entry.event), entry.detail, entry.created_at))
  );
  renderReview();
}
function choice(parent, name, labelText, value, type = "radio") {
  const label = document.createElement("label");
  label.className = "choice";
  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  input.value = value;
  label.append(input, document.createTextNode(labelText));
  parent.append(label);
}
function renderReview() {
  const review = state.run?.status === "review";
  $("review-panel").hidden = !review;
  if (!review) return;
  $("review-message").textContent = state.run.message;
  $("review-title").textContent = pretty(state.reason || "Review required");
  $("confirm-submit").hidden = state.reason !== "submission_confirmation";
  const question = state.question;
  $("answer-form").hidden = !question;
  $("chat-handoff").hidden = !question;
  $("confirm-submit").disabled = state.busy;
  if (!question) {
    questionKey = "";
    return;
  }
  $("chat-prompt").value = state.prompt || "";
  if (questionKey === question.fingerprint) return;
  questionKey = question.fingerprint;
  $("chat-answer").value = "";
  $("remember-answer").checked = false;
  const parent = $("answer-controls");
  parent.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = question.prompt;
  parent.append(heading);
  if (["single_choice", "scale", "multiple_choice"].includes(question.type)) {
    question.options.forEach((option) =>
      choice(
        parent,
        "answer",
        option.label,
        option.label,
        question.type === "multiple_choice" ? "checkbox" : "radio"
      )
    );
  } else if (question.type === "dropdown") {
    const select = document.createElement("select");
    select.name = "answer";
    select.required = question.required;
    select.setAttribute("aria-label", question.prompt);
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Choose an answer";
    select.append(empty);
    question.options.forEach((option) => {
      const element = document.createElement("option");
      element.value = option.label;
      element.textContent = option.label;
      select.append(element);
    });
    parent.append(select);
  } else if (question.type === "matrix") {
    question.rows.forEach((row) => {
      const field = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = row.label;
      field.append(legend);
      row.options.forEach((option) => choice(field, "row-" + row.id, option.label, option.label));
      parent.append(field);
    });
  } else {
    const input = document.createElement(question.type === "text" ? "textarea" : "input");
    if (question.type === "numeric") {
      input.type = "number";
      for (const key of ["min", "max", "step"])
        if (question[key] !== undefined) input[key] = String(question[key]);
    }
    input.name = "answer";
    input.required = question.required;
    if (question.maxLength !== undefined) input.maxLength = question.maxLength;
    input.setAttribute("aria-label", question.prompt);
    parent.append(input);
  }
}
$("start").addEventListener("click", () => post("start"));
$("demo").addEventListener("click", () => {
  showPanel("overview");
  void post("demo");
});
$("pause").addEventListener("click", () => post("pause"));
$("stop").addEventListener("click", () => post("stop"));
$("resume").addEventListener("click", () => post("resume"));
$("confirm-submit").addEventListener("click", () => post("resume", { confirmSubmit: true }));
$("answer-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const question = state.question;
  if (!question) return;
  const form = new window.FormData(event.target);
  const answer = { confidence: 1, reason: "Confirmed by the user." };
  if (question.type === "multiple_choice") answer.selectedOptions = form.getAll("answer");
  else if (question.type === "matrix")
    answer.matrix = question.rows.map((row) => ({
      row: row.id,
      option: form.get("row-" + row.id)
    }));
  else if (["text", "numeric"].includes(question.type)) answer.value = form.get("answer");
  else answer.selectedOption = form.get("answer");
  void post("resume", { answer, remember: $("remember-answer").checked });
});
$("copy-prompt").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("chat-prompt").value);
    notify("Prompt copied. Paste it into your ChatGPT conversation.");
  } catch {
    $("chat-prompt").select();
    notify("Select and copy the prompt using your keyboard.");
  }
});
$("import-answer").addEventListener("click", () => {
  try {
    const answer = JSON.parse($("chat-answer").value);
    void post("resume", { answer, remember: $("remember-answer").checked });
  } catch {
    notify("Paste valid JSON without Markdown code fences.", true);
  }
});
$("fact-key").addEventListener("change", () => {
  const custom = $("fact-key").value === "custom";
  $("custom-key").hidden = !custom;
  $("custom-label").hidden = !custom;
  $("custom-key").required = custom;
});
$("fact-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const fact = {
    key: $("fact-key").value === "custom" ? $("custom-key").value : $("fact-key").value,
    value: $("fact-value").value,
    kind: $("fact-kind").value,
    established: $("fact-confirmed").checked
  };
  if (editingFact && editingFact.key === fact.key) {
    if (
      !window.confirm(
        "Confirm this profile correction? The old value will remain in history and cached mappings will be cleared."
      )
    )
      return;
    await post("facts/correct", { ...fact, expectedValue: editingFact.value, confirmed: true });
    editingFact = null;
  } else {
    await post("facts", fact);
  }
});
$("clear-memory").addEventListener("click", () => {
  if (
    window.confirm("Clear reusable answer mappings? Profile facts and answer history will be kept.")
  )
    void post("memory/clear", { confirmed: true });
});
$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await post("settings", {
    ...state.settings,
    startUrl: $("start-url").value,
    platform: $("platform").value,
    rankBy: $("ranking").value,
    allowedDomains: $("domains")
      .value.split(/[\s,]+/)
      .filter(Boolean)
      .map((value) => value.toLowerCase()),
    maxSteps: Number($("max-steps").value),
    stepDelayMs: Number($("step-delay").value),
    autoSubmit: $("auto-submit").checked,
    headless: $("headless").checked,
    restartLastRun: $("restart-run").checked
  });
});
async function poll() {
  try {
    await refresh();
  } catch {
    $("connection").textContent = "Disconnected — retrying";
  }
  setTimeout(poll, 1500);
}
void poll();
