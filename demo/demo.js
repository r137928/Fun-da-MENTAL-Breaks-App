import { celebrateBlueprint } from "/brain-buddy.js?v=1";
import { breakTimeLimit, buildWeeklyPlan, recommendBreak, resolveBreakDay } from "/recommendations.mjs";

const screen = document.querySelector("#screen");
const status = document.querySelector("#status");
const progress = document.querySelector("#progress");
const connection = document.querySelector("#connection");
const buddy = document.querySelector("#buddy-note");
const dashboardLink = document.querySelector("#dashboard-link");
const stepBack = document.querySelector("#step-back");
const key = "fundamental-breaks-demo-v1";
const profilesKey = "fundamental-breaks-demo-profiles";
const windows = ["morning", "midday", "afternoon", "evening"];
const goals = {calm: "Find more calm", energy: "Get more energy", stress: "Ease stress", focus: "Improve focus", balance: "Feel more balanced", less_sitting: "Sit less"};
const lanes = {stillness: "Stillness", movement: "Movement", balanced: "A mix of both", depends: "Depends on the day"};
const lengths = {one_two: "1–2 minutes", five: "5 minutes", ten_fifteen: "10–15 minutes", twenty_forty_plus: "20–40+ minutes"};
const activityTags = {now_often: "Do it often", now_rare: "Do it sometimes", goal: "Want to try it", not_for_me: "Not for me"};
const dayContexts = {desk: "Mostly at a desk", commuting: "Often on the go", active: "Mostly on my feet", people: "Often around people", quiet: "Usually somewhere quiet", variable: "It varies"};
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const breakSteps = new Set(["check", "recommendation", "timer", "checkout"]);
const tones = {calm: "Calm and gentle", playful: "Playful", straightforward: "Straightforward", kind: "Warm and friendly", challenge: "Give me a challenge"};
const nudges = {one_and_done: "One nudge", max_three: "Up to three nudges", snooze: "Let me snooze", quiet: "Quiet", depends: "Decide later"};
const presets = {
  alex: {name: "Alex", email: "alex@example.test", phone: "+1 202-555-0101"},
  sam: {name: "Sam", email: "sam@example.test", phone: "+1 202-555-0112"},
  jamie: {name: "Jamie", email: "jamie@example.test", phone: "+1 202-555-0123"}
};
const breakCards = [
  ["entertainment", "Enjoying entertainment and stories", "Scrolling a feed, watching a show, or listening to a podcast.", false],
  ["tasks", "Handling life tasks and responsibilities", "Checking email, studying, or making a plan.", false],
  ["thoughts", "Running inner thoughts", "Replaying a conversation, worrying, or following a train of thought.", false],
  ["body", "Engaging your body", "Taking a walk, stretching, or dancing.", true],
  ["quiet", "Taking a quiet pause", "Counting breaths, sitting quietly, or meditating.", true],
  ["reflection", "Tuning into awareness and reflection", "Journaling, practicing gratitude, or setting an intention.", true]
];
const stepBackTo = {profile: "age", welcome: "profile", definition: "welcome", quiz: "definition", reveal: "quiz", clarity: "reveal", setup: "welcome", preferences: "setup", schedule: "preferences", summary: "schedule", recommendation: "check"};
let catalog;
let timer;
let state = load();
let check;
let savingBreak = false;
let comparison = [];
let dashboardRequest = 0;
const defaultComparisonCheck = {mind_before: 5, time_bucket: "one_two", vibe_words: ["calm"]};
let comparisonCheck = {...defaultComparisonCheck};

function initial() {
  return {
    step: "age", sample: null, token: null, first: null, pending: null, pendingBreak: null, revision: null,
    contact: {method: "email", preset: "alex"},
    blueprint: {
      schema_version: 1, catalog_version: 1, goal: "balance", nickname: null,
      now: {color_hex: "#3774AC", mental_balance: 5, body_presence_pct: 50, breaks_per_day: 0, duration: "one_two"},
      target: {color_hex: "#4C8549", mental_balance: 7, body_presence_pct: 65, breaks_per_day: 2, duration: "one_two"},
      comfort: "balanced", activities: [], plan: {weekdays: [2,2,2,2,2,2,2], windows: ["midday", "afternoon"], overrides: {}},
      buddy: {tone: "calm", nudge: "one_and_done", support: "minimal"}, optional: {}
    }
  };
}

function load() {
  try {
    const {check: _oldCheck, started: _oldStart, ...saved} = JSON.parse(localStorage.getItem(key)) || {};
    if (breakSteps.has(saved.step)) saved.step = saved.revision ? "saved" : "summary";
    return {...initial(), ...saved};
  }
  catch { return initial(); }
}
function persist() { localStorage.setItem(key, JSON.stringify(state)); }
function savedProfiles() {
  try { return JSON.parse(localStorage.getItem(profilesKey)) || []; }
  catch { return []; }
}
function rememberProfile(token, account, example) {
  const profiles = savedProfiles();
  const index = profiles.findIndex(profile => profile.id === account.user_id);
  const item = {token, id: account.user_id, name: account.blueprint.nickname || "Sample profile",
    example: example ?? profiles[index]?.example};
  if (index < 0) profiles.push(item);
  else profiles[index] = item;
  localStorage.setItem(profilesKey, JSON.stringify(profiles));
}
function previousStep() {
  if (state.step === "check") return previousStepForBreak();
  if (state.step === "setup" && state.revision !== null) return "saved";
  return stepBackTo[state.step];
}
function go(step) {
  clearInterval(timer);
  if (!breakSteps.has(step)) check = null;
  state.step = step;
  persist();
  render();
  screen.querySelector("h1")?.focus({preventScroll: true});
  window.scrollTo(0, 0);
}
function title(heading, lead) {
  screen.innerHTML = '<h1 tabindex="-1"></h1><p class="lead"></p>';
  screen.querySelector("h1").textContent = heading;
  screen.querySelector(".lead").textContent = lead;
}
function button(label, action, style = "") {
  const control = document.createElement("button");
  control.type = "button";
  control.className = style;
  control.textContent = label;
  control.addEventListener("click", async () => {
    status.textContent = "";
    control.disabled = true;
    try { await action(); }
    catch (error) { status.textContent = error.message; }
    finally { control.disabled = false; }
  });
  return control;
}
function actions(...controls) {
  const row = document.createElement("div");
  row.className = "actions";
  row.append(...controls);
  screen.append(row);
}
function field(tag, label, value, attributes = {}) {
  const row = document.createElement("label");
  row.append(label);
  const control = document.createElement(tag);
  Object.assign(control, attributes);
  if (tag !== "select") control.value = value;
  row.append(control);
  return [row, control];
}
function picker(label, values, chosen, change) {
  const [row, control] = field("select", label);
  for (const [value, name] of values) control.add(new Option(name, value));
  control.value = chosen;
  control.addEventListener("change", () => { change(control.value); persist(); });
  return row;
}
function slider(label, chosen, min, max, change, suffix = "") {
  const [row, control] = field("input", label, chosen, {type: "range", min, max});
  const output = document.createElement("output");
  output.textContent = " · " + chosen + suffix;
  row.insertBefore(output, control);
  control.addEventListener("input", () => {
    output.textContent = " · " + control.value + suffix;
    change(Number(control.value));
    persist();
  });
  return row;
}
function optionGroup(heading, inputs, extra = "") {
  const group = document.createElement("fieldset");
  const legend = document.createElement("legend");
  group.className = "option-group " + extra;
  legend.textContent = heading;
  group.append(legend, ...inputs);
  return group;
}
function choice(label, type, name, value, checked, change) {
  const row = document.createElement("label");
  row.className = "option";
  const control = document.createElement("input");
  Object.assign(control, {type, name, value, checked});
  control.addEventListener("change", () => change(control.checked));
  row.append(control, label);
  return row;
}
function facts(entries) {
  const list = document.createElement("dl");
  for (const [name, value] of entries) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = name;
    detail.textContent = value;
    row.append(term, detail);
    list.append(row);
  }
  screen.append(list);
}
async function request(path, method = "GET", body, token = state.token) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {method, headers, cache: "no-store", body: body ? JSON.stringify(body) : undefined});
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const messages = {
      age_not_eligible: "This sample is under 13.",
      blueprint_changed: "This Blueprint changed elsewhere. Reload the saved version before editing again."
    };
    throw Object.assign(new Error(messages[error.code] ?? "The backend returned " + response.status + ". Try again."), {code: error.code});
  }
  return response.status === 204 ? null : response.json();
}
function summary() {
  const bp = state.blueprint;
  const contact = state.revision !== null ? state.remote.contact : {
    method: state.contact.method, value: presets[state.contact.preset][state.contact.method]
  };
  facts([
    ["Name", bp.nickname || "Sample profile"],
    ...(contact ? [[contact.method === "phone" ? "Demo phone" : "Demo email", contact.value]] : []),
    ...preferences(bp)
  ]);
}
function activityName(activity) {
  return activity.custom_name || catalog.activities.find(item => item.id === activity.activity_id)?.name || activity.activity_id;
}
function preferences(bp) {
  return [
    ["Goal", goals[bp.goal]], ["Mental balance", bp.now.mental_balance + " → " + bp.target.mental_balance],
    ["Body presence", bp.now.body_presence_pct + "% → " + bp.target.body_presence_pct + "%"],
    ["Break style", lanes[bp.comfort]], ["Break length", lengths[bp.now.duration] + " now · " + lengths[bp.target.duration] + " goal"],
    ["Activities", bp.activities.filter(({tag}) => tag !== "not_for_me").map(entry => activityName(entry.activity)).join(", ") || "Open to either lane"],
    ["Weekly goal", bp.plan.weekdays.reduce((sum, count) => sum + count, 0) + " breaks"],
    ["Reminder windows", bp.plan.windows.map(name => name[0].toUpperCase() + name.slice(1)).join(", ") || "None"],
    ["Brain Buddy tone", tones[bp.buddy.tone]],
    ["Reminder style", nudges[bp.buddy.nudge] || "Decide later"]
  ];
}
function startCheck() {
  const first = state.revision === null;
  check = {
    mind_before: first ? state.blueprint.now.mental_balance : 5,
    time_bucket: "", vibe_words: [], lane: "", setting: ""
  };
  go("check");
}

function checkin() {
  title("How are you right now?", "Tell Brain Buddy how much time you have and what you’re noticing.");
  const vibes = optionGroup("Pick 1–3 words", catalog.vibes.map(vibe =>
    choice(vibe[0].toUpperCase() + vibe.slice(1), "checkbox", "vibe", vibe, check.vibe_words.includes(vibe), selected => {
      check.vibe_words = selected ? [...check.vibe_words, vibe] : check.vibe_words.filter(word => word !== vibe);
      updateVibeLimit();
    })), "vibe-chips");
  function updateVibeLimit() {
    for (const input of vibes.querySelectorAll("input")) {
      input.disabled = !input.checked && check.vibe_words.length === 3;
    }
  }
  updateVibeLimit();
  const choices = document.createElement("div");
  choices.className = "checkin-choices";
  choices.append(
    picker("Where are you? (optional)", [["", "Anywhere"], ["seated", "Need to stay seated"], ["indoors", "Indoors"], ["outdoors", "Outdoors"]], check.setting, value => check.setting = value),
    picker("Break type (optional)", [["", "Help me choose"], ["stillness", lanes.stillness], ["movement", lanes.movement]], check.lane, value => check.lane = value)
  );
  const [exactLabel, exact] = field("input", "Exact time available in minutes (optional)", check.availableMinutes ?? "", {
    type: "number", min: 1, max: 1440, inputMode: "numeric"
  });
  exact.addEventListener("input", () => check.availableMinutes = exact.value);
  const exactTime = document.createElement("details");
  const exactSummary = document.createElement("summary");
  exactSummary.textContent = "Set an exact time";
  exactTime.open = Boolean(check.availableMinutes);
  exactTime.append(exactSummary, exactLabel);
  const available = picker("Time available", [["", "Choose a time"], ...Object.entries(lengths)], check.time_bucket, value => check.time_bucket = value);
  screen.append(available, exactTime,
    slider("How’s your mind? (1 overwhelmed, 10 clear)", check.mind_before, 1, 10, value => check.mind_before = value), vibes, choices);
  actions(button("Find my break", () => {
    if (!check.time_bucket) throw new Error("Choose how much time you have.");
    if (!check.vibe_words.length) throw new Error("Pick at least one word for how you feel.");
    const {mind_before, time_bucket, vibe_words, lane, setting} = check;
    const availableSeconds = exact.value ? exact.valueAsNumber * 60 : undefined;
    if (!exact.validity.valid || (availableSeconds && breakTimeLimit(time_bucket, availableSeconds) !== availableSeconds)) {
      exactTime.open = true;
      exact.focus();
      throw new Error("Enter a whole number of minutes up to the time available.");
    }
    check.availableSeconds = availableSeconds;
    check.suggestions = recommendBreak(catalog, state.blueprint, {
      mind_before, time_bucket, vibe_words, available_seconds: availableSeconds, lane: lane || undefined, setting: setting || undefined
    });
    check.choice = check.suggestions.best_fit;
    check.plannedSeconds = check.choice?.duration_seconds;
    go("recommendation");
  }));
}

function recommendationReason(code) {
  switch (code) {
    case "short_stillness": return "Breathing fits a short Stillness break.";
    case "gentle_reset": return "A gentle reset fits how you’re feeling right now.";
    case "vibe_match": return "This fits the words you picked for how you’re feeling.";
    case "saved_preference": return "You picked this activity in your Break Blueprint.";
    case "goal_match": return "This fits the goal in your Break Blueprint.";
    case "comfort_match": return "This fits the kind of break you said feels comfortable.";
    case "chosen_lane": return "This fits the break type you chose just now.";
    default: return "This fits the time you have right now.";
  }
}

function durationLabel(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return [minutes && minutes + " min", remainder && remainder + " sec"].filter(Boolean).join(" ");
}

function renderRecommendation() {
  const {best_fit, alternatives} = check.suggestions;
  const hasOptions = best_fit || alternatives.stillness.length || alternatives.movement.length;
  title("Build your break", hasOptions ? "Pick an activity and adjust the timer to fit your moment." :
    "No suggested activities fit. Add your own or edit your check-in.");
  const timeLimit = breakTimeLimit(check.time_bucket, check.availableSeconds);
  const [durationRow, duration] = field("input", "Timer length in minutes", "", {
    type: "number", min: 1, step: 1, required: true, inputMode: "numeric"
  });
  const range = document.createElement("small");
  range.id = "timer-range";
  duration.setAttribute("aria-describedby", range.id);
  durationRow.append(range);
  function applyDurationBounds() {
    if (!check.choice) {
      durationRow.hidden = true;
      return;
    }
    const metadata = catalog.activities.find(item => item.id === check.choice.activity_id)?.recommendation;
    duration.min = (metadata?.min_seconds ?? 60) / 60;
    duration.max = Math.min(timeLimit, metadata?.max_seconds ?? timeLimit) / 60;
    duration.value = check.plannedSeconds / 60;
    durationRow.hidden = false;
    const bounds = duration.min === duration.max ? duration.min : duration.min + "–" + duration.max;
    range.textContent = activityName(check.choice) + " · " + bounds + " min";
  }
  const option = suggestion => choice(
    activityName(suggestion) + " · " + durationLabel(suggestion.duration_seconds),
    "radio", "recommended-activity", suggestion.activity_id, check.choice?.activity_id === suggestion.activity_id,
    selected => {
      if (selected) {
        check.choice = suggestion;
        check.plannedSeconds = suggestion.duration_seconds;
        applyDurationBounds();
      }
    }
  );
  if (best_fit) {
    const best = document.createElement("div");
    best.className = "best-fit";
    const why = document.createElement("p");
    why.textContent = recommendationReason(best_fit.reason_code);
    best.append(optionGroup("Brain Buddy’s Best Fit", [option(best_fit)]), why);
    screen.append(best);
  }
  const columns = document.createElement("div");
  columns.className = "columns break-alternatives";
  for (const lane of ["stillness", "movement"]) {
    const options = alternatives[lane].map(option);
    if (!options.length) {
      const empty = document.createElement("p");
      empty.textContent = best_fit?.lane === lane ? "Best Fit is the only match." : "No matches for this check-in.";
      options.push(empty);
    }
    columns.append(optionGroup(lanes[lane], options));
  }
  const custom = document.createElement("details");
  const customSummary = document.createElement("summary");
  customSummary.textContent = "Use my own activity";
  custom.open = !hasOptions || Boolean(check.choice?.custom_name);
  const [nameLabel, name] = field("input", "Activity name", check.choice?.custom_name ?? "", {
    type: "text", maxLength: 60, autocomplete: "off", placeholder: "e.g. Shoulder rolls"
  });
  let customLane = check.choice?.custom_name ? check.choice.lane : check.lane || "stillness";
  const customType = picker("Break type", [["stillness", lanes.stillness], ["movement", lanes.movement]], customLane,
    value => customLane = value);
  function useCustom() {
    check.choice = {custom_name: name.value.trim(), lane: customLane};
    check.plannedSeconds = check.plannedSeconds || Math.min(120, timeLimit);
    for (const input of columns.querySelectorAll("input")) input.checked = false;
    const bestInput = screen.querySelector(".best-fit input");
    if (bestInput) bestInput.checked = false;
    applyDurationBounds();
    duration.focus();
  }
  custom.append(customSummary, nameLabel, customType, button("Use this activity", () => {
    if (!name.value.trim() || /\p{Cc}/u.test(name.value)) throw new Error("Enter a short name for the activity.");
    useCustom();
  }, "secondary"));
  duration.addEventListener("input", () => { check.plannedSeconds = duration.valueAsNumber * 60; });
  applyDurationBounds();
  if (hasOptions) screen.append(columns);
  screen.append(custom, durationRow);
  actions(button("Start my break", () => {
    if (!check.choice) throw new Error("Choose an activity to start.");
    if (!duration.validity.valid) {
      duration.focus();
      throw new Error("Choose a whole number from " + duration.min + " to " + duration.max + " minutes.");
    }
    check.started = Date.now();
    check.after = check.mind_before;
    check.presence = state.blueprint.now.body_presence_pct;
    go("timer");
  }), button("Edit check-in", () => go("check"), "secondary"));
}

function definitionScreen() {
  title("What is a FUN·da·Mental Break?", "It’s a short, intentional pause from whatever is keeping your mind busy.");
  const definition = document.createElement("div");
  definition.className = "lesson";
  definition.innerHTML = `<section class="definition-card"><h2 class="ribbon gold">Definition</h2><p>Step away from the feed, tabs, and to-do list. Pick something that brings you back to your body, your senses, and what’s around you.</p></section>
    <h2>Two ways to take a break</h2><div class="lane-grid"><section><h3 class="ribbon">Stillness</h3><p>Find a quiet moment. Breathe slowly, sit, or notice what you can hear.</p></section><section><h3 class="ribbon">Movement</h3><p>Get moving. Walk, stretch, dance, or shake it out.</p></section></div>`;
  screen.append(definition);
  actions(button("Start Break Check", () => {
    if (!state.breakCheck) {
      const order = breakCards.map(card => card[0]);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      state.breakCheck = {order, position: 0, answers: {}};
      persist();
    }
    go("quiz");
  }), button("Skip Break Check", () => go("setup"), "link"));
}

function quizScreen() {
  if (!state.breakCheck) { go("definition"); return; }
  const {order, position, answers} = state.breakCheck;
  const [id, name, examples] = breakCards.find(card => card[0] === order[position]);
  title("Break or mind-on?", "Which of these would you count as an intentional break?");
  const card = document.createElement("div");
  card.className = "quiz-card";
  const number = document.createElement("p");
  number.className = "ribbon";
  number.textContent = `Card ${position + 1} of ${order.length}`;
  const activity = document.createElement("h2");
  activity.textContent = name;
  const detail = document.createElement("p");
  detail.textContent = examples;
  card.append(number, activity, detail);
  screen.append(card, optionGroup("Your answer", [
    choice("Break", "radio", "quiz-answer", "break", answers[id] === "break", () => { answers[id] = "break"; persist(); }),
    choice("Mind-on", "radio", "quiz-answer", "mind-on", answers[id] === "mind-on", () => { answers[id] = "mind-on"; persist(); })
  ], "answer-options"));
  const last = position === order.length - 1;
  actions(button(last ? "Submit" : "Next card", () => {
    if (!answers[id]) throw new Error("Choose Break or Mind-on to continue.");
    if (last) go("reveal");
    else { state.breakCheck.position++; go("quiz"); }
  }), ...(position ? [button("Previous card", () => { state.breakCheck.position--; go("quiz"); }, "secondary")] : []),
  button("Skip Break Check", () => go("setup"), "link"));
}

function clarityScreen() {
  title("A little clarity", "Mind-on activities have their place. A break gives your attention somewhere else to go for a bit.");
  const groups = document.createElement("div");
  groups.className = "clarity";
  for (const [heading, isBreak] of [["Mind-stimulating", false], ["Body + presence", true]]) {
    const section = document.createElement("section");
    const label = document.createElement("h2");
    label.className = "ribbon";
    label.textContent = heading;
    const list = document.createElement("ul");
    for (const [id, name] of breakCards.filter(card => card[3] === isBreak)) {
      const item = document.createElement("li");
      const tag = document.createElement("span");
      tag.className = isBreak ? "break-tag" : "mind-tag";
      tag.textContent = id === "reflection" ? "Either" : isBreak ? "Break" : "Mind-on";
      const answer = state.breakCheck?.answers[id];
      if (answer) tag.title = "You chose " + (answer === "break" ? "Break" : "Mind-on");
      item.append(name, tag);
      list.append(item);
    }
    section.append(label, list);
    groups.append(section);
  }
  const note = document.createElement("p");
  note.className = "reflection-note";
  note.textContent = "Reflection can go either way. Journaling or setting an intention can feel like a reset, even though it involves thinking.";
  screen.append(groups, note);
  actions(button("I get it", () => {
    state.blueprint.optional.break_check_completed = true;
    go("setup");
  }));
}
async function save() {
  if (!state.token) {
    state.token = (await request("/demo/session", "POST", {sample: state.sample, contact: state.contact})).token;
    persist();
  }
  if (!state.pending) {
    state.pending = {request_id: crypto.randomUUID(), expected_revision: state.revision,
      blueprint: structuredClone(state.blueprint), first_break: state.revision === null ? state.first : null};
    persist();
  }
  try {
    await request("/v1/me/blueprint", "PUT", state.pending);
  } catch (error) {
    if (error.code === "blueprint_changed") {
      state.pending = null;
      persist();
    }
    throw error;
  }
  await restore();
  state.lastSave = state.pending;
  state.pending = null;
  state.first = null;
  persist();
  render();
  celebrateBlueprint();
}
async function saveCurrentBreak() {
  if (savingBreak || !state.pendingBreak) return;
  savingBreak = true;
  const record = state.pendingBreak;
  go("saved");
  try {
    const {break: activity} = await request("/v1/me/breaks", "POST", record);
    state.pendingBreak = null;
    state.remote.recent_breaks = [{...record, break: activity},
      ...state.remote.recent_breaks.filter(other => other.id !== record.id)].slice(0, 30);
    persist();
  } finally {
    savingBreak = false;
    render();
  }
  status.textContent = "Break saved.";
}

async function restore(token = state.token, switching = false) {
  if (switching && state.pendingBreak) throw new Error("Save the pending break before switching profiles.");
  const account = await request("/v1/me", "GET", undefined, token);
  if (!account.setup_complete) throw new Error("This sample account has no saved Blueprint yet.");
  rememberProfile(token, account);
  if (switching) state = initial();
  state.token = token;
  state.remote = account;
  state.blueprint = structuredClone(account.blueprint);
  state.revision = account.revision;
  go("saved");
}

function cancelBlueprintEdit() {
  state.blueprint = structuredClone(state.remote.blueprint);
  state.pending = null;
  go("saved");
}

function profileSwitcher() {
  const profiles = savedProfiles();
  if (!profiles.length) return;
  const box = document.createElement("section");
  box.className = "saved-profiles";
  const heading = document.createElement("h2");
  heading.textContent = "Saved demo profiles (" + profiles.length + ")";
  const help = document.createElement("p");
  help.textContent = "Open a profile to read its own Blueprint and breaks from the backend.";
  const controls = document.createElement("div");
  controls.className = "actions";
  for (const profile of profiles) {
    const control = button(profile.name + " · " + profile.id.slice(0, 8), () => restore(profile.token, state.token !== profile.token), "secondary");
    if (state.token === profile.token && state.step === "saved") control.setAttribute("aria-current", "true");
    controls.append(control);
  }
  box.append(heading, help, controls);
  screen.append(box);
}

async function createExampleProfiles() {
  const loaded = [];
  for (const example of [
    {preset: "alex", method: "email", goal: "calm", lane: "stillness", activity: "breathing", window: "morning", minutes: "five", tone: "calm"},
    {preset: "sam", method: "phone", goal: "energy", lane: "movement", activity: "walk", window: "afternoon", minutes: "ten_fifteen", tone: "playful"}
  ]) {
    const existing = savedProfiles().find(profile => profile.example === example.preset);
    if (existing) {
      loaded.push(existing);
      continue;
    }
    const {token} = await request("/demo/session", "POST", {sample: "adult", contact: {preset: example.preset, method: example.method}}, null);
    const bp = initial().blueprint;
    bp.nickname = presets[example.preset].name;
    bp.goal = example.goal;
    bp.comfort = example.lane;
    bp.activities = [{activity: {activity_id: example.activity, lane: example.lane}, tag: "goal"}];
    bp.plan.windows = [example.window];
    bp.target.duration = example.minutes;
    bp.buddy.tone = example.tone;
    const first = example.preset === "alex" ? {
      id: crypto.randomUUID(), completed_at: new Date().toISOString(), time_zone: "UTC",
      activity: bp.activities[0].activity, duration_seconds: 10, time_bucket: "one_two",
      vibe_words: ["calm"], mind_before: 5, mind_after: 7, presence_pct: 65, source: "onboarding"
    } : null;
    await request("/v1/me/blueprint", "PUT", {request_id: crypto.randomUUID(), expected_revision: null, blueprint: bp, first_break: first}, token);
    const account = await request("/v1/me", "GET", undefined, token);
    rememberProfile(token, account, example.preset);
    loaded.push({id: account.user_id, token});
  }
  if (location.hash === "#dashboard") {
    comparison = loaded.map(profile => profile.id);
    comparisonCheck = {...defaultComparisonCheck};
    renderDashboard(true);
  } else {
    await restore(loaded[0].token, true);
  }
}

function renderDashboard(focus = false) {
  const requestId = ++dashboardRequest;
  let updateBestFit;
  const profiles = savedProfiles();
  comparison = comparison.filter(id => profiles.some(profile => profile.id === id));
  for (const profile of profiles) {
    if (comparison.length === 2) break;
    if (!comparison.includes(profile.id)) comparison.push(profile.id);
  }
  title("Compare saved profiles", "See how the same check-in can lead to different breaks.");
  if (focus) screen.querySelector("h1").focus();
  if (profiles.length < 2) {
    const message = document.createElement("p");
    message.textContent = profiles.length ? "Add one more profile to compare two users." : "Save two profiles, or load Alex and Sam to try the dashboard.";
    screen.append(message);
    actions(button("Load Alex and Sam", createExampleProfiles), button("Back to demo", closeDashboard, "secondary"));
    if (!profiles.length) return;
  }

  const selected = comparison.map(id => profiles.find(profile => profile.id === id));
  if (profiles.length >= 2) {
    const selectors = document.createElement("div");
    selectors.className = "columns comparison-controls";
    selected.forEach((profile, index) => {
      const options = profiles.filter(item => item.id !== comparison[1 - index]);
      selectors.append(picker(index === 0 ? "Left profile" : "Right profile",
        options.map(item => [item.id, item.name + " · " + item.id.slice(0, 8)]),
        profile.id, id => {
          comparison[index] = id;
          renderDashboard();
          screen.querySelectorAll(".comparison-controls select")[index]?.focus();
        }));
    });
    screen.append(selectors);
    actions(button("Load Alex and Sam", createExampleProfiles, "secondary"), button("Refresh from backend", () => {
      renderDashboard();
      screen.querySelector(".actions button:last-child")?.focus();
    }, "secondary"));
  }
  const shared = optionGroup("Same check-in", [], "dashboard-checkin");
  const inputs = document.createElement("div");
  inputs.className = "columns";
  inputs.append(
    picker("Time available", Object.entries(lengths), comparisonCheck.time_bucket, value => {
      comparisonCheck.time_bucket = value;
      updateBestFit?.();
    }),
    picker("Feeling", catalog.vibes.map(vibe => [vibe, vibe[0].toUpperCase() + vibe.slice(1)]),
      comparisonCheck.vibe_words[0], value => {
        comparisonCheck.vibe_words = [value];
        updateBestFit?.();
      })
  );
  const score = document.createElement("p");
  score.textContent = "Mind score 5/10.";
  shared.append(inputs, score);
  screen.append(shared);

  const feedback = document.createElement("p");
  feedback.className = "comparison-feedback";
  feedback.setAttribute("role", "status");
  feedback.textContent = "Reading profiles from the backend…";
  screen.append(feedback);
  Promise.allSettled(selected.map(profile => request("/v1/me", "GET", undefined, profile.token))).then(results => {
    if (requestId !== dashboardRequest || location.hash !== "#dashboard") return;
    const accounts = results.map((result, index) => {
      if (result.status === "fulfilled" && result.value.setup_complete && result.value.user_id === selected[index].id) {
        return result.value;
      }
      return null;
    });
    const loaded = accounts.filter(Boolean).length;
    feedback.textContent = loaded === selected.length
      ? "Fresh from PostgreSQL"
      : "Some profiles couldn’t load. Check the connection and try again.";
    const table = comparisonTable(selected, accounts);
    const cells = table.querySelectorAll(".profile-best-fit td");
    updateBestFit = () => cells.forEach((cell, index) => showComparedBreak(cell, accounts[index]));
    updateBestFit();
    screen.append(table);
  });
}

function closeDashboard() {
  location.hash = "";
}

function showComparedBreak(cell, account) {
  if (!account) {
    cell.textContent = "Unavailable";
    return;
  }
  const {best_fit: result} = recommendBreak(catalog, account.blueprint, comparisonCheck);
  if (!result) {
    cell.textContent = "No match for this check-in";
    return;
  }
  const activity = document.createElement("strong");
  const details = document.createElement("small");
  const reason = document.createElement("small");
  activity.textContent = activityName(result);
  details.textContent = lanes[result.lane] + " · " + durationLabel(result.duration_seconds);
  reason.textContent = recommendationReason(result.reason_code);
  cell.replaceChildren(activity, details, reason);
}

function comparisonTable(profiles, accounts) {
  const table = document.createElement("table");
  table.className = "profile-comparison";
  table.setAttribute("aria-label", "Saved demo profiles compared");
  const header = table.createTHead().insertRow();
  addHeading(header, "Compare", "col");
  accounts.forEach((account, index) => {
    addHeading(header, account?.blueprint.nickname || profiles[index].name, "col");
  });
  const body = table.createTBody();
  function row(label, values) {
    const line = body.insertRow();
    addHeading(line, label, "row");
    values.forEach(value => {
      const cell = line.insertCell();
      cell.append(value ?? "Unavailable");
    });
    return line;
  }
  const bestFit = row("Best Fit", accounts.map(() => ""));
  bestFit.className = "profile-best-fit";
  bestFit.setAttribute("aria-live", "polite");
  row("Profile ID", accounts.map(account => account?.user_id.slice(0, 8)));
  row("Demo contact", accounts.map(account => {
    if (!account) return null;
    if (!account.contact) return "None saved";
    const contact = document.createElement("span");
    const type = document.createElement("small");
    type.textContent = account.contact.method === "phone" ? "Phone" : "Email";
    contact.append(type, account.contact.value);
    return contact;
  }));
  row("Saved revision", accounts.map(account => account ? String(account.revision) : null));
  const preferenceLists = accounts.map(account => account ? preferences(account.blueprint) : null);
  const firstList = preferenceLists.find(Boolean);
  firstList?.forEach(([label], index) => row(label, preferenceLists.map(list => list?.[index][1])));
  row("Break history", accounts.map(account => account ? breakHistory(account.recent_breaks) : null));
  return table;
}

function addHeading(row, text, scope) {
  const cell = document.createElement("th");
  cell.scope = scope;
  cell.textContent = text;
  row.append(cell);
}

function breakHistory(breaks) {
  if (!breaks.length) return "No breaks logged yet";
  const container = document.createElement("div");
  const count = document.createElement("strong");
  count.textContent = breaks.length + (breaks.length === 1 ? " recent break" : " recent breaks");
  const list = document.createElement("ul");
  for (const record of breaks) {
    const item = document.createElement("li");
    const name = document.createElement("b");
    name.textContent = activityName(record.activity);
    const detail = document.createElement("small");
    detail.textContent = lanes[record.activity.lane] + " · " + durationLabel(record.duration_seconds);
    const date = document.createElement("time");
    date.dateTime = record.completed_at;
    date.textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium", timeStyle: "short", timeZone: record.time_zone
    }).format(new Date(record.completed_at));
    const checkOut = document.createElement("small");
    const score = record.mind_before == null ? record.mind_after : record.mind_before + " → " + record.mind_after;
    checkOut.textContent = "Mind score " + score + " · Presence " + record.presence_pct + "%";
    item.append(name, detail, date, checkOut);
    list.append(item);
  }
  container.append(count, list);
  return container;
}

function renderSchedule(bp) {
  title("Find a rhythm that fits", "Choose a weekly pattern or edit the numbers to fit different days.");
  const week = document.createElement("div");
  week.className = "week-grid";
  const weekly = document.createElement("p");
  weekly.className = "weekly-total";
  weekly.setAttribute("role", "status");
  function updateWeeklyTotal() {
    const total = bp.plan.weekdays.reduce((sum, count) => sum + count, 0);
    weekly.textContent = total + (total === 1 ? " planned break per week" : " planned breaks per week");
  }
  const dayInputs = weekdays.map((day, index) => {
    const [label, input] = field("input", day.slice(0, 3), bp.plan.weekdays[index], {
      type: "number", inputMode: "numeric", min: 0, max: 10, required: true
    });
    input.setAttribute("aria-label", day + " breaks");
    input.addEventListener("input", () => {
      if (!input.validity.valid) return;
      bp.plan.weekdays[index] = input.valueAsNumber;
      updateWeeklyTotal();
      persist();
    });
    week.append(label);
    return input;
  });
  updateWeeklyTotal();
  const patterns = [["", "Different days"], ["all", "Every day"], ["weekdays", "Weekdays"], ["weekends", "Weekends"]];
  const pattern = picker("What kind of week suits you?", patterns, "", () => {});
  const patternSelect = pattern.querySelector("select");
  const weekPattern = document.createElement("div");
  weekPattern.className = "week-pattern";
  const applyPattern = button("Fill week", () => {
    const days = {all: [0, 1, 2, 3, 4, 5, 6], weekdays: [0, 1, 2, 3, 4], weekends: [5, 6]}[patternSelect.value];
    bp.plan.weekdays = buildWeeklyPlan(bp.target.breaks_per_day * days.length, days);
    dayInputs.forEach((input, index) => input.value = bp.plan.weekdays[index]);
    updateWeeklyTotal();
    persist();
  }, "secondary");
  applyPattern.hidden = !patternSelect.value;
  patternSelect.addEventListener("change", () => { applyPattern.hidden = !patternSelect.value; });
  weekPattern.append(pattern, applyPattern);
  const reminderWindows = optionGroup("Reminder windows", windows.map(name =>
    choice(name[0].toUpperCase() + name.slice(1), "checkbox", "window", name, bp.plan.windows.includes(name), selected => {
      bp.plan.windows = windows.filter(window => window === name ? selected : bp.plan.windows.includes(window));
      persist();
    })), "vibe-chips");
  screen.append(
    slider("Breaks per day now", bp.now.breaks_per_day, 0, 10, value => bp.now.breaks_per_day = value),
    slider("Breaks per active day goal", bp.target.breaks_per_day, 0, 10, value => bp.target.breaks_per_day = value),
    weekPattern, week, weekly, reminderWindows,
    picker("Brain Buddy’s tone", Object.entries(tones), bp.buddy.tone, value => bp.buddy.tone = value),
    picker("Reminder style", Object.entries(nudges), bp.buddy.nudge, value => bp.buddy.nudge = value)
  );
  actions(button("Preview my Blueprint", () => {
    const invalid = dayInputs.find(input => !input.validity.valid);
    if (invalid) {
      invalid.focus();
      throw new Error("Enter between 0 and 10 breaks for each day.");
    }
    go("summary");
  }));
}

function previousStepForBreak() {
  return state.revision === null ? "summary" : "saved";
}

function timerScreen() {
  title("Take a moment", activityName(check.choice) + " · " + durationLabel(check.plannedSeconds));
  const counter = document.createElement("p");
  counter.className = "timer";
  counter.setAttribute("role", "timer");
  screen.append(counter);
  function finish() {
    const ended = Math.min(Date.now(), check.started + check.plannedSeconds * 1000);
    check.seconds = Math.max(1, Math.floor((ended - check.started) / 1000));
    check.completedAt = new Date(ended).toISOString();
    go("checkout");
  }
  function tick() {
    const remaining = Math.max(0, check.plannedSeconds - Math.floor((Date.now() - check.started) / 1000));
    counter.textContent = [Math.floor(remaining / 60), remaining % 60].map(part => String(part).padStart(2, "0")).join(":");
    if (!remaining) finish();
  }
  actions(button("End and check out", finish, "secondary"), button("Cancel break", () => go(previousStepForBreak()), "link"));
  timer = setInterval(tick, 250);
  tick();
}

function checkoutScreen() {
  const first = state.revision === null;
  title("How do you feel now?", activityName(check.choice) + " · " + durationLabel(check.seconds) +
    (first ? ". Save it with your Blueprint." : ". Save it to your break history."));
  screen.append(slider("Mind score now", check.after, 1, 10, value => check.after = value),
    slider("Body presence", check.presence, 0, 100, value => check.presence = value, "%"));
  actions(button(first ? "Finish break" : "Save break", async () => {
    const record = {
      id: crypto.randomUUID(), completed_at: check.completedAt, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      activity: check.choice.custom_name ? {custom_name: check.choice.custom_name, lane: check.choice.lane} :
        {activity_id: check.choice.activity_id, lane: check.choice.lane},
      duration_seconds: check.seconds,
      time_bucket: check.time_bucket, vibe_words: check.vibe_words, mind_before: check.mind_before,
      mind_after: check.after, presence_pct: check.presence, source: first ? "onboarding" : "manual"
    };
    if (first) {
      state.first = record;
      go("summary");
    } else {
      state.pendingBreak = record;
      await saveCurrentBreak();
    }
  }));
}

function render() {
  status.textContent = "";
  if (!catalog) return;
  clearInterval(timer);
  const dashboard = location.hash === "#dashboard";
  document.body.classList.toggle("dashboard-view", dashboard);
  dashboardLink.href = dashboard ? "#" : "#dashboard";
  dashboardLink.textContent = dashboard ? "Back to demo" : "Dashboard";
  progress.hidden = dashboard || state.revision !== null;
  document.body.dataset.step = dashboard ? "dashboard" : state.step;
  stepBack.hidden = dashboard || !previousStep();
  if (dashboard) {
    buddy.textContent = "See how two people make time for different kinds of breaks.";
    renderDashboard();
    return;
  }
  const bp = state.blueprint;
  const steps = {age: 1, denied: 1, profile: 2, welcome: 3, definition: 4, quiz: 4, reveal: 4, clarity: 4, setup: 5, preferences: 6, schedule: 7, summary: 8, check: 9, recommendation: 9, timer: 9, checkout: 9, saved: 10};
  progress.value = steps[state.step] || 1;
  buddy.textContent = ({
    age: "Hey there! I’m your Brain Buddy. Let’s make a little room for a real break.",
    denied: "Thanks for checking in with me.",
    profile: "What do you go by?",
    welcome: `Welcome, ${bp.nickname || "friend"}! We’ll keep this simple. Let’s find a break that feels right for you.`,
    definition: "A break can be something you already enjoy. The trick is giving it your full attention.",
    quiz: "Which of these count as a FUN·da·Mental Break?",
    reveal: "Ready to see what gives your mind a real pause?",
    clarity: "Now you know what to look for.",
    setup: "Think about where you are and where you’d like to go.",
    preferences: "There’s more than one way to reset. Pick what feels good to you.",
    schedule: "A little rhythm helps make time for yourself.",
    summary: "Here’s the plan you made. Want to give it a try?",
    check: "Take a second to notice how you’re feeling.",
    recommendation: "Here’s a break to try. You can make it your own.",
    timer: "You can put the screen down. I’ll be right here.",
    checkout: "Take a breath and notice what shifted.",
    saved: "Your Blueprint is here whenever you want to come back."
  })[state.step];
  switch (state.step) {
    case "age":
      title("Make room for a real break", "Choose a fictional age profile to try the onboarding flow. Use sample answers throughout.");
      screen.append(picker("Sample age profile", [["", "Choose an age profile"], ["adult", "Sample adult"], ["teen", "Sample teen (13–17)"], ["under13", "Sample child (under 13)"]], state.sample || "", value => state.sample = value || null));
      actions(button("Let’s do this", () => {
        if (!state.sample) throw new Error("Choose a sample profile first.");
        go(state.sample === "under13" ? "denied" : "profile");
      }));
      if (!savedProfiles().length) actions(button("Load two example profiles", createExampleProfiles, "secondary"));
      profileSwitcher();
      break;
    case "denied":
      title("This app is for ages 13+", "This sample can’t proceed to setup.");
      actions(button("Choose another sample", () => { state.sample = null; go("age"); }));
      break;
    case "profile": {
      title("Make it yours", "Use a fictional name and choose a sample contact. The demo won’t send messages.");
      const [nameLabel, name] = field("input", "Name", bp.nickname || "", {
        type: "text", maxLength: 40, placeholder: "e.g. Alex", autocomplete: "off"
      });
      name.addEventListener("input", () => { bp.nickname = name.value.trim() || null; persist(); });
      function updateContact() { persist(); render(); screen.querySelector('[data-contact-method]')?.focus(); }
      const method = picker("Contact method", [["email", "Email"], ["phone", "Phone number"]], state.contact.method, value => {
        state.contact.method = value;
        updateContact();
      });
      method.querySelector("select").setAttribute("data-contact-method", "");
      const options = Object.entries(presets).map(([id, profile]) => [id, profile[state.contact.method]]);
      screen.append(nameLabel, method, picker(state.contact.method === "email" ? "Sample email" : "Sample phone number", options, state.contact.preset, value => state.contact.preset = value));
      actions(button("Continue", () => {
        if (!bp.nickname || /[\u0000-\u001f\u007f]/.test(bp.nickname)) throw new Error("Enter a fictional name to continue.");
        go("welcome");
      }), button("Use sample name", () => { bp.nickname = presets[state.contact.preset].name; go("welcome"); }, "secondary"));
      break;
    }
    case "welcome":
      title("You’re in the right place", "Make a little time to step away from what’s keeping your mind busy and reconnect with what’s around you.");
      actions(button("Learn what counts as a break", () => go("definition")), button("Go straight to my Blueprint", () => go("setup"), "link"));
      break;
    case "definition":
      definitionScreen();
      break;
    case "quiz":
      quizScreen();
      break;
    case "reveal": {
      title("Let’s find out", "Tap the badge to reveal the Break Check answers.");
      const reveal = button("Reveal", () => go("clarity"), "reveal-button");
      actions(reveal, button("Back to cards", () => go("quiz"), "secondary"));
      break;
    }
    case "clarity":
      clarityScreen();
      break;
    case "setup": {
      title("Build your Break Blueprint", "Pick a goal and set your starting point.");
      screen.append(optionGroup("My goal · choose one", Object.entries(goals).map(([value, label]) =>
        choice(label, "radio", "goal", value, bp.goal === value, () => { bp.goal = value; persist(); })), "goals"));
      screen.append(picker("What’s a typical day like? (optional)", [["", "Skip"], ...Object.entries(dayContexts)],
        bp.optional.day_context?.[0] ?? "", value => bp.optional.day_context = value ? [value] : []));
      const columns = document.createElement("div");
      columns.className = "columns";
      for (const [name, baseline] of [["NOW", bp.now], ["GOAL", bp.target]]) {
        const group = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = name;
        group.append(legend, slider("Mental balance", baseline.mental_balance, 1, 10, value => baseline.mental_balance = value),
          slider("Body presence", baseline.body_presence_pct, 0, 100, value => baseline.body_presence_pct = value, "%"));
        columns.append(group);
      }
      screen.append(columns);
      actions(button("Continue", () => go("preferences")));
      break;
    }
    case "preferences": {
      title("What feels like a good break?", "Mark what you do now and what you’d like to try.");
      screen.append(picker("Break style", Object.entries(lanes), bp.comfort, value => bp.comfort = value));
      const columns = document.createElement("div");
      columns.className = "columns";
      for (const [lane, items] of [["stillness", ["breathing", "quiet_sit", "meditation"]], ["movement", ["walk", "stretch", "dance"]]]) {
        const group = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = lanes[lane];
        group.append(legend);
        for (const item of catalog.activities.filter(item => items.includes(item.id))) {
          const tag = bp.activities.find(entry => entry.activity.activity_id === item.id)?.tag ?? "";
          group.append(picker(item.name, [["", "No preference"], ...Object.entries(activityTags)], tag, value => {
            bp.activities = bp.activities.filter(entry => entry.activity.activity_id !== item.id);
            if (value) bp.activities.push({activity: {lane: item.lane, activity_id: item.id}, tag: value});
          }));
        }
        columns.append(group);
      }
      const times = document.createElement("div");
      times.className = "checkin-choices";
      times.append(picker("Usual break length", Object.entries(lengths), bp.now.duration, value => bp.now.duration = value),
        picker("Goal break length", Object.entries(lengths), bp.target.duration, value => bp.target.duration = value));
      screen.append(columns, times);
      actions(button("Continue", () => go("schedule")));
      break;
    }
    case "schedule":
      renderSchedule(bp);
      break;
    case "summary":
      title("Your Break Blueprint", state.revision !== null ? "Review your new preferences and weekly plan." :
        state.first ? "Your first break is ready to save with your Blueprint." : "Try a break as a guest, or save your plan now.");
      summary();
      if (state.revision !== null) {
        actions(button("Save Blueprint changes", save), button("Cancel edits", cancelBlueprintEdit, "secondary"),
          button("Reload saved Blueprint", () => restore(), "link"));
      } else {
        actions(state.first ? button("Save Blueprint + first break", save) : button("Try my first break", startCheck),
          state.first ? button("Edit Blueprint", () => go("profile"), "secondary") : button("Save Blueprint", save, "secondary"),
          button("Back", () => go("schedule"), "link"));
      }
      break;
    case "check":
      checkin();
      break;
    case "recommendation":
      renderRecommendation();
      break;
    case "timer":
      timerScreen();
      break;
    case "checkout":
      checkoutScreen();
      break;
    case "saved": {
      const values = new Date();
      const date = [values.getFullYear(), values.getMonth() + 1, values.getDate()].map(value => String(value).padStart(2, "0")).join("-");
      const today = resolveBreakDay(bp.plan, date);
      title("Your Break Blueprint", today.count ? today.count + (today.count === 1 ? " break planned today." : " breaks planned today.") : "No breaks planned today.");
      const breakAction = state.pendingBreak
        ? button(savingBreak ? "Saving break…" : "Retry saving break", saveCurrentBreak)
        : button("Start a new break", startCheck);
      breakAction.disabled = savingBreak;
      actions(breakAction, ...(state.pendingBreak ? [] : [button("Edit my Blueprint", () => go("setup"), "secondary")]));
      summary();
      const breakCount = state.remote.recent_breaks.length;
      facts([["Today’s reminder windows", today.count && today.windows.length ? today.windows.map(name => name[0].toUpperCase() + name.slice(1)).join(", ") : "None"],
        ["Profile ID", state.remote.user_id.slice(0, 8)], ["Saved revision", state.remote.revision], ["Recent breaks", breakCount]]);
      if (breakCount) {
        const history = document.createElement("section");
        history.className = "recent-breaks";
        history.append(breakHistory(state.remote.recent_breaks));
        screen.append(history);
      }
      if (!savingBreak) {
        actions(button("Reload from backend", async () => { await restore(); status.textContent = "Reloaded from PostgreSQL."; }),
          ...(state.lastSave ? [button("Retry original save", async () => {
            const result = await request("/v1/me/blueprint", "PUT", state.lastSave);
            await restore();
            status.textContent = "Same revision " + result.revision + " returned. Break count is unchanged.";
          }, "secondary")] : []),
          button("Add another profile", resetDemo, "secondary"));
        profileSwitcher();
      }
      break;
    }
  }
}
function resetDemo() {
  if (state.pendingBreak) {
    status.textContent = "Save the pending break before starting another demo profile.";
    return;
  }
  state = initial();
  closeDashboard();
  go("age");
}
document.querySelector("#reset").addEventListener("click", resetDemo);
stepBack.addEventListener("click", () => {
  const previous = previousStep();
  if (state.step === "setup" && previous === "saved") cancelBlueprintEdit();
  else if (previous) go(previous);
});
window.addEventListener("hashchange", () => { render(); screen.querySelector("h1")?.focus(); });
Promise.all([request("/catalog.json"), request("/ready")]).then(([result]) => {
  catalog = result;
  connection.textContent = "API and PostgreSQL connected";
  persist();
  render();
}).catch(() => {
  connection.textContent = "Backend unavailable";
  title("Couldn’t load the demo", "Check Docker and reload this page.");
});
