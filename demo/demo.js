import { celebrateBlueprint } from "/brain-buddy.js?v=1";

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
const tones = {calm: "Calm and gentle", playful: "Playful", straightforward: "Straightforward", kind: "Warm and friendly", challenge: "Give me a challenge"};
const nudges = {one_and_done: "One nudge", max_three: "Up to three nudges", snooze: "Let me snooze", quiet: "Quiet"};
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
const stepBackTo = {profile: "age", welcome: "profile", definition: "welcome", quiz: "definition", reveal: "quiz", clarity: "reveal", setup: "welcome", preferences: "setup", schedule: "preferences", summary: "schedule", check: "summary"};
let catalog;
let timer;
let state = load();
let comparison = [];
let dashboardRequest = 0;

function initial() {
  return {
    step: "age", sample: null, token: null, first: null, pending: null, revision: null,
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
  try { return {...initial(), ...JSON.parse(localStorage.getItem(key))}; }
  catch { return initial(); }
}
function persist() { localStorage.setItem(key, JSON.stringify(state)); }
function savedProfiles() {
  try { return JSON.parse(localStorage.getItem(profilesKey)) || []; }
  catch { return []; }
}
function rememberProfile(token, account) {
  const item = {token, id: account.user_id, name: account.blueprint.nickname || "Sample profile"};
  const profiles = savedProfiles();
  const index = profiles.findIndex(profile => profile.id === item.id);
  if (index < 0) profiles.push(item);
  else profiles[index] = item;
  localStorage.setItem(profilesKey, JSON.stringify(profiles));
}
function go(step) {
  clearInterval(timer);
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
    throw new Error(error.code === "age_not_eligible" ? "This sample is under 13." : "The backend returned " + response.status + ". Try again.");
  }
  return response.status === 204 ? null : response.json();
}
function summary() {
  const bp = state.blueprint;
  const contact = state.step === "saved" ? state.remote.contact : {
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
    ["Break style", lanes[bp.comfort]], ["Preferred length", lengths[bp.target.duration]],
    ["Activities", bp.activities.map(entry => activityName(entry.activity)).join(", ") || "Open to either lane"],
    ["Weekly goal", bp.plan.weekdays.reduce((sum, count) => sum + count, 0) + " breaks"],
    ["Reminder windows", bp.plan.windows.map(name => name[0].toUpperCase() + name.slice(1)).join(", ") || "None"],
    ["Brain Buddy tone", tones[bp.buddy.tone]],
    ["Reminder style", nudges[bp.buddy.nudge] || "Decide later"]
  ];
}
function checkin() {
  const bp = state.blueprint;
  const preferred = bp.activities.find(entry => !["stillness", "movement"].includes(bp.comfort) || entry.activity.lane === bp.comfort);
  const fallback = bp.comfort === "movement" ? "walk" : "breathing";
  state.check ??= {activity: preferred?.activity.activity_id ?? fallback, vibe: "scattered", before: bp.now.mental_balance, after: 6, presence: 65, seconds: 0};
  const c = state.check;
  title("Take your first break", "Choose a Stillness or Movement break. The demo timer takes 10 seconds.");
  screen.append(
    picker("Activity", catalog.activities.map(item => [item.id, item.name + " · " + item.lane]), c.activity, value => c.activity = value),
    picker("How are you feeling?", catalog.vibes.map(vibe => [vibe, vibe]), c.vibe, value => c.vibe = value),
    slider("Mind score", c.before, 1, 10, value => c.before = value)
  );
  actions(button("Start 10-second break", () => { state.started = Date.now(); go("timer"); }), button("Back", () => go("summary"), "secondary"));
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
      blueprint: state.blueprint, first_break: state.revision === null ? state.first : null};
    persist();
  }
  const saved = await request("/v1/me/blueprint", "PUT", state.pending);
  state.lastSave = state.pending;
  state.pending = null;
  state.revision = saved.revision;
  persist();
  // The PUT commits the Blueprint. The follow-up GET only refreshes the view.
  try { await restore(); }
  finally { celebrateBlueprint(); }
}
async function restore(token = state.token, switching = false) {
  const account = await request("/v1/me", "GET", undefined, token);
  if (!account.setup_complete) throw new Error("This sample account has no saved Blueprint yet.");
  rememberProfile(token, account);
  if (switching) state = initial();
  state.token = token;
  state.remote = account;
  state.blueprint = account.blueprint;
  state.revision = account.revision;
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
  for (const example of [
    {preset: "alex", method: "email", goal: "calm", lane: "stillness", activity: "breathing", window: "morning", minutes: "five", tone: "calm"},
    {preset: "sam", method: "phone", goal: "energy", lane: "movement", activity: "walk", window: "afternoon", minutes: "ten_fifteen", tone: "playful"}
  ]) {
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
    rememberProfile(token, account);
  }
  if (location.hash === "#dashboard") {
    comparison = savedProfiles().slice(-2).map(profile => profile.id);
    renderDashboard(true);
  } else {
    await restore(savedProfiles().at(-2).token, true);
  }
}

function renderDashboard(focus = false) {
  const requestId = ++dashboardRequest;
  const profiles = savedProfiles();
  comparison = comparison.filter(id => profiles.some(profile => profile.id === id));
  for (const profile of profiles) {
    if (comparison.length === 2) break;
    if (!comparison.includes(profile.id)) comparison.push(profile.id);
  }
  title("Compare saved profiles", "See each sample user’s Break Blueprint and recent breaks.");
  if (focus) screen.querySelector("h1").focus();
  if (profiles.length < 2) {
    const message = document.createElement("p");
    message.textContent = profiles.length ? "Add one more profile to compare two users." : "Save two profiles, or load Alex and Sam to try the dashboard.";
    screen.append(message);
    actions(button("Load two example profiles", createExampleProfiles), button("Back to demo", closeDashboard, "secondary"));
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
    actions(button("Refresh from backend", () => {
      renderDashboard();
      screen.querySelector(".actions button")?.focus();
    }, "secondary"));
  }

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
    screen.append(comparisonTable(selected, accounts));
  });
}

function closeDashboard() {
  location.hash = "";
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
  }
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
    const duration = record.duration_seconds < 60 ? record.duration_seconds + " sec" : Math.floor(record.duration_seconds / 60) + " min" +
      (record.duration_seconds % 60 ? " " + (record.duration_seconds % 60) + " sec" : "");
    detail.textContent = lanes[record.activity.lane] + " · " + duration;
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

function render() {
  status.textContent = "";
  if (!catalog) return;
  clearInterval(timer);
  const dashboard = location.hash === "#dashboard";
  document.body.classList.toggle("dashboard-view", dashboard);
  dashboardLink.href = dashboard ? "#" : "#dashboard";
  dashboardLink.textContent = dashboard ? "Back to demo" : "Dashboard";
  progress.hidden = dashboard;
  document.body.dataset.step = dashboard ? "dashboard" : state.step;
  stepBack.hidden = dashboard || !stepBackTo[state.step];
  if (dashboard) {
    buddy.textContent = "See how two people make time for different kinds of breaks.";
    renderDashboard();
    return;
  }
  const bp = state.blueprint;
  const steps = {age: 1, denied: 1, profile: 2, welcome: 3, definition: 4, quiz: 4, reveal: 4, clarity: 4, setup: 5, preferences: 6, schedule: 7, summary: 8, check: 9, timer: 9, checkout: 9, saved: 10};
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
      title("What feels like a good break?", "Choose a style, a few activities, and how long you’d like to break for.");
      screen.append(picker("Break style", Object.entries(lanes), bp.comfort, value => bp.comfort = value));
      const columns = document.createElement("div");
      columns.className = "columns";
      for (const [lane, items] of [["stillness", ["breathing", "quiet_sit", "meditation"]], ["movement", ["walk", "stretch", "dance"]]]) {
        const group = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = lanes[lane];
        group.append(legend);
        for (const item of catalog.activities.filter(item => items.includes(item.id))) {
          group.append(choice(item.name, "checkbox", "activity", item.id, bp.activities.some(entry => entry.activity.activity_id === item.id), checked => {
            bp.activities = bp.activities.filter(entry => entry.activity.activity_id !== item.id);
            if (checked) bp.activities.push({activity: {lane: item.lane, activity_id: item.id}, tag: "goal"});
            persist();
          }));
        }
        columns.append(group);
      }
      screen.append(columns, picker("Preferred break length", Object.entries(lengths), bp.target.duration, value => bp.target.duration = value));
      actions(button("Continue", () => go("schedule")));
      break;
    }
    case "schedule": {
      title("Find a rhythm that fits", "Choose when you’d like to break and how you’d like me to check in.");
      screen.append(slider("Breaks per day", bp.target.breaks_per_day, 0, 5, value => {
        bp.target.breaks_per_day = value;
        bp.plan.weekdays = Array(7).fill(value);
      }));
      const schedule = document.createElement("fieldset");
      schedule.innerHTML = "<legend>Reminder windows</legend>";
      for (const name of windows) {
        schedule.append(choice(name[0].toUpperCase() + name.slice(1), "checkbox", "window", name, bp.plan.windows.includes(name), checked => {
          bp.plan.windows = bp.plan.windows.filter(window => window !== name);
          if (checked) bp.plan.windows.push(name);
          persist();
        }));
      }
      screen.append(schedule, picker("Brain Buddy’s tone", Object.entries(tones), bp.buddy.tone, value => bp.buddy.tone = value),
        picker("Reminder style", Object.entries(nudges), bp.buddy.nudge, value => bp.buddy.nudge = value));
      actions(button("Preview my Blueprint", () => go("summary")));
      break;
    }
    case "summary":
      title("Your Break Blueprint", state.first ? "Your first break is ready to save with your Blueprint." : "Try a break as a guest, or save your plan now.");
      summary();
      actions(
        state.first ? button("Save Blueprint + first break", save) : button("Try my first break", () => go("check")),
        state.first ? button("Edit Blueprint", () => go("profile"), "secondary") : button("Save Blueprint", save, "secondary"),
        button("Back", () => go("schedule"), "link")
      );
      break;
    case "check":
      checkin();
      break;
    case "timer": {
      title("Take a moment", "Give yourself a few seconds away from the screen.");
      const counter = document.createElement("p");
      counter.className = "timer";
      screen.append(counter);
      function finish() {
        state.check.seconds = Math.max(1, Math.min(10, Math.floor((Date.now() - state.started) / 1000)));
        go("checkout");
      }
      function tick() {
        const remaining = Math.max(0, 10 - Math.floor((Date.now() - state.started) / 1000));
        counter.textContent = "00:" + String(remaining).padStart(2, "0");
        if (!remaining) finish();
      }
      actions(button("End and check out", finish, "secondary"));
      timer = setInterval(tick, 250);
      tick();
      break;
    }
    case "checkout": {
      const c = state.check;
      const activity = catalog.activities.find(item => item.id === c.activity);
      title("How do you feel now?", "This break stays in your browser until you save it.");
      screen.append(slider("Mind score now", c.after, 1, 10, value => c.after = value),
        slider("Body presence", c.presence, 0, 100, value => c.presence = value, "%"));
      actions(button("Finish break", () => {
        state.first = {
          id: crypto.randomUUID(), completed_at: new Date().toISOString(), time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          activity: {activity_id: activity.id, lane: activity.lane}, duration_seconds: c.seconds,
          time_bucket: "one_two", vibe_words: [c.vibe], mind_before: c.before, mind_after: c.after,
          presence_pct: c.presence, source: "onboarding"
        };
        go("summary");
      }));
      break;
    }
    case "saved":
      title("Blueprint saved", "Here’s what’s saved for this profile.");
      summary();
      const breakCount = state.remote.recent_breaks.length;
      facts([["Profile ID", state.remote.user_id.slice(0, 8)], ["Saved revision", state.remote.revision], ["Breaks in account", breakCount]]);
      actions(button("Reload from backend", async () => { await restore(); status.textContent = "Reloaded from PostgreSQL."; }),
        ...(state.lastSave ? [button("Retry original save", async () => {
          const result = await request("/v1/me/blueprint", "PUT", state.lastSave);
          await restore();
          status.textContent = "Same revision " + result.revision + " returned. Break count is unchanged.";
        }, "secondary")] : []),
        button("Add another profile", () => { state = initial(); go("age"); }, "secondary"));
      profileSwitcher();
      break;
  }
}
document.querySelector("#reset").addEventListener("click", () => { state = initial(); closeDashboard(); go("age"); });
stepBack.addEventListener("click", () => {
  const previous = stepBackTo[state.step];
  if (previous) go(previous);
});
window.addEventListener("hashchange", () => { render(); screen.querySelector("h1")?.focus(); });
Promise.all([request("/catalog.json"), request("/ready")]).then(([result]) => {
  catalog = result;
  connection.textContent = "Rust API and PostgreSQL connected";
  render();
}).catch(() => {
  connection.textContent = "Backend unavailable";
  title("Couldn’t load the demo", "Check Docker and reload this page.");
});
