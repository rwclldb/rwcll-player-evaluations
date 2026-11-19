// Runtime check against the LOCAL Supabase database (Docker container only).
// Verifies the admin roadmap (counts, stage) and the coach/evaluator schedule.
// All fixture data is created inside a transaction that is rolled back.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const config = fs.readFileSync(path.join(root, "supabase", "config.toml"), "utf8");
const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
if (!projectId) {
  console.error("FAIL: could not read project_id from supabase/config.toml");
  process.exit(1);
}
const container = `supabase_db_${projectId}`;
const sql = fs.readFileSync(path.join(__dirname, "sql", "admin-roadmap-runtime-check.sql"), "utf8");

const result = spawnSync(
  "docker",
  ["exec", "-i", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-At"],
  { input: sql, encoding: "utf8" }
);

if (result.error) {
  console.error(`FAIL: could not run docker (${result.error.message}). Is local Supabase running?`);
  process.exit(1);
}

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const notices = output.split(/\r?\n/).filter((line) => /PASS:|FAIL:|ERROR:/.test(line));
notices.forEach((line) => console.log(line.replace(/^.*?(PASS:|FAIL:|ERROR:)/, "$1")));

if (result.status !== 0) {
  console.error(`FAIL: admin roadmap runtime check exited with status ${result.status}`);
  if (!notices.length) console.error(output);
  process.exit(1);
}

const passes = notices.filter((line) => line.includes("PASS:")).length;
if (passes < 16) {
  console.error(`FAIL: expected 16 PASS lines, saw ${passes}`);
  process.exit(1);
}
// Step rules in lib/roadmap.ts (pure functions).
const jiti = require("jiti")(__filename);
const rm = jiti(path.join(root, "lib/roadmap.ts"));
const dr = jiti(path.join(root, "lib/drafts.ts"));
const room = jiti(path.join(root, "lib/draft-room.ts"));
const B = (o = {}) => ({ draft: { age_order: "open", status: "live", pick_timer_seconds: 120, clock_started_at: "2027-02-02T18:00:00Z" }, teams: [{ team_id: 1, name: "Aces" }, { team_id: 2, name: "Bats" }],
  next: { overall: 3, round: 2, pick_in_round: 1, team_id: 2, must_only: false }, tier_age: null, reserved: {}, ...o });
const RP = (o = {}) => ({ player_season_id: 1, league_age: 11, must_draft: false, bib: 1, evaluator_overall: null, coach_overall: null, coach_trimmed_overall: null, prior_overall: null, my_overall: null, ...o });
const T0 = { divisions: [], coachKids: 0, coachKidsUnlinked: 0, siblingGroups: 0, suggestions: 0 };
const setup = (o = {}) => ({ division: { season_division_id: 3, name: "Majors", min_age: 10, max_age: 12, season_id: 2, season: "S", season_closed: false },
  draft: { id: 1, status: "setup", must_draft_ages: [12], roster_size: 12, coach_kid_rule: "fixed_rounds", coach_kid_rounds: [1, 2], coach_kid_by_round: 2, order_set_at: "x" },
  previous: null, teams: [{ team_id: 1, name: "A", position: 1, roster_size: null, manager: "M", coach: "C" }, { team_id: 2, name: "B", position: 2, roster_size: null, manager: "M2", coach: "C2" }],
  pool: [], kids: [], overrides: [], ages: [{ league_age: 10, status: "locked", released: true }], other_divisions: [], players: [], ...o });
const P = (n, must = false, evaluations = 2) => Array.from({ length: n }, (_, i) => ({ player_season_id: i, must_draft: must, evaluations }));
const sess = (o) => ({ id: 1, league_age: 9, status: "open", released: false, players: 10, no_bib: 0, coaches: 1, evaluators: 1,
  submitted: 0, drafts: 0, players_scored_by_evaluator: 0, players_scored_by_coach: 0, players_touched: 0,
  primary_date: "2027-01-23", primary_start: "09:00:00", makeups: 0, last_event_date: "2027-01-23", ...o });
const data = (o = {}) => ({ season: { id: 2, name: "S", is_closed: false }, stage: "week", today: "2027-01-01",
  first_primary_date: "2027-01-23", last_event_date: "2027-01-23",
  registrations: { total: 10, no_bib: 0, no_age: 0, on_site: 0 },
  imports: { registration_batches: 1, registration_rows_to_review: 0, bib_rows_held: 0 },
  prior_year: { players_with_prior: 3, rows_pending: 0, shown_while_scoring: false },
  people: { coaches: 1, evaluators: 1, not_signed_in: 0, unassigned: 0 }, sessions: [sess({})], ...o });
const step = (d, stage, key) => rm.buildSteps(d, stage).find((s) => s.key === key);
const checks = [
  ["a fully set-up season has every Before step done", rm.stepProgress(rm.buildSteps(data(), "before")).done === 8],
  ["possible duplicate players need attention", step(data({ duplicates: 2 }), "before", "duplicates").status === "attention"],
  ["a player without a bib flags the bib step", step(data({ registrations: { total: 10, no_bib: 1, no_age: 0, on_site: 0 } }), "before", "bibs").status === "attention"],
  ["an age group without an evaluator flags assignments", step(data({ sessions: [sess({ evaluators: 0 })] }), "before", "assignments").detail.includes("Age 9")],
  ["readiness links to players without bibs", step(data({ registrations: { total: 10, no_bib: 2, no_age: 0, on_site: 0 }, sessions: [sess({ no_bib: 2 })] }), "week", "readiness").links[0].href.includes("show=nobib")],
  ["an age group in Setup leaves Open scoring to do", step(data({ sessions: [sess({ status: "setup" })] }), "week", "open").status === "todo"],
  ["release is done only when every age group is released", step(data({ sessions: [sess({ status: "locked", released: true }), sess({ id: 2, league_age: 10, status: "locked" })] }), "after", "release").status === "todo"],
  ["end-of-season re-rating is marked coming later", step(data(), "end", "rerate").status === "later"],
  ["every age group released and the season open: the Teams and draft stage", rm.suggestedStage({ stage: "end", season: { is_closed: false } }) === "draft"
    && rm.suggestedStage({ stage: "end", season: { is_closed: true } }) === "end" && rm.suggestedStage({ stage: "after", season: { is_closed: false } }) === "after"],
  ["a team without a manager or coach needs attention", step(data({ teams: { divisions: [{ name: "Majors", teams: 2, incomplete: 1 }], coachKids: 0, coachKidsUnlinked: 0, siblingGroups: 0, suggestions: 0 } }), "draft", "teams").status === "attention"],
  ["teams are done when every drafted division has complete teams", step(data({ teams: { divisions: ["AA", "AAA", "Majors", "Juniors"].map((name) => ({ name, teams: 4, incomplete: 0 })), coachKids: 0, coachKidsUnlinked: 0, siblingGroups: 0, suggestions: 0 } }), "draft", "teams").status === "done"],
  ["a coach's kid with no parent linked needs attention", step(data({ teams: { divisions: [], coachKids: 3, coachKidsUnlinked: 1, siblingGroups: 0, suggestions: 0 } }), "draft", "kids").status === "attention"],
  ["waiting sibling suggestions need attention", step(data({ teams: { divisions: [], coachKids: 0, coachKidsUnlinked: 0, siblingGroups: 1, suggestions: 2 } }), "draft", "siblings").status === "attention"],
  ["drafts not set up yet leave the setup step to do", step(data({ teams: { ...T0, drafts: [{ name: "Juniors", draft: true, orderSet: true, status: "setup" }, { name: "Majors", draft: false, orderSet: false, status: null }] } }), "draft", "setup-drafts").detail.includes("Majors")],
  ["the setup step is done when Juniors, Majors and AAA have drafts with an order", step(data({ teams: { ...T0, drafts: ["Juniors", "Majors", "AAA", "AA"].map((name) => ({ name, draft: name !== "AA", orderSet: name !== "AA", status: "setup" })) } }), "draft", "setup-drafts").status === "done"],
  ["setup check: an unreleased age group blocks the start", dr.setupChecks(setup({ ages: [{ league_age: 10, status: "locked", released: false }] })).some((c) => c.level === "block" && c.text.includes("Age 10"))],
  ["setup check: no order blocks the start", dr.setupChecks(setup({ teams: [{ team_id: 1, name: "A", position: null, roster_size: null, manager: "M", coach: "C" }] })).some((c) => c.level === "block" && c.text.includes("order"))],
  ["setup check: more must-draft players than roster spots blocks", dr.setupChecks(setup({ pool: P(25, true) })).some((c) => c.level === "block" && c.text.includes("25 players must be drafted"))],
  ["setup check: more players than spots warns how many won't be drafted", dr.setupChecks(setup({ pool: P(26) })).some((c) => c.level === "warn" && c.text.includes("2 won't be drafted"))],
  ["setup check: a bigger roster for one team counts", !dr.setupChecks(setup({ pool: P(26), teams: [{ team_id: 1, name: "A", position: 1, roster_size: 14, manager: "M", coach: "C" }, { team_id: 2, name: "B", position: 2, roster_size: null, manager: "M", coach: "C" }] })).some((c) => c.text.includes("won't be drafted"))],
  ["setup check: a ready draft has nothing blocking", dr.setupChecks(setup({ pool: P(20) })).every((c) => c.level !== "block")],
  ["kid round default: fixed rounds in order, manager's kid first; otherwise the suggested round", dr.defaultKidRound(setup().draft, { kid_order: 2, suggested_round: 5 }) === 2
    && dr.defaultKidRound({ ...setup().draft, coach_kid_rule: "round_per_kid" }, { kid_order: 1, suggested_round: 5 }) === 5 && dr.defaultKidRound({ ...setup().draft, coach_kid_rule: "by_round" }, { kid_order: 1, suggested_round: 5 }) === null],
  ["room: another team's coach's kid can't be picked", room.pickRule(B({ reserved: { "1": 1 } }), RP()).allowed === false],
  ["room: a must-draft-only pick needs a note for anyone else", room.pickRule(B({ next: { overall: 3, round: 2, pick_in_round: 1, team_id: 2, must_only: true } }), RP()).needsNote
    && !room.pickRule(B({ next: { overall: 3, round: 2, pick_in_round: 1, team_id: 2, must_only: true } }), RP({ must_draft: true })).needsNote],
  ["room: oldest first needs a note for a younger player", room.pickRule(B({ draft: { age_order: "oldest_first", status: "live" }, tier_age: 12 }), RP()).needsNote],
  ["room: sorting puts players without a number last", room.sortPlayers([RP({ player_season_id: 1, evaluator_overall: null }), RP({ player_season_id: 2, evaluator_overall: 3 }), RP({ player_season_id: 3, evaluator_overall: 4 })], "evaluator").map((p) => p.player_season_id).join() === "3,2,1"],
  ["room: the trimmed sort falls back to the plain coach average", room.sortValue(RP({ coach_overall: 3, coach_trimmed_overall: null }), "trimmed") === 3],
  ["room: the pick clock counts down from when the pick came up", room.clockLeft(B(), 0, Date.parse("2027-02-02T18:00:30Z")) === 90 && room.clockLeft(B(), 0, Date.parse("2027-02-02T18:03:00Z")) === -60],
  ["dates format without a time-zone shift", rm.formatDate("2027-01-23") === "Sat, Jan 23" && rm.formatTime("15:30:00") === "3:30 PM"],
];
for (const [label, ok] of checks) {
  if (!ok) { console.error(`FAIL: ${label}`); process.exit(1); }
  console.log(`PASS: ${label}`);
}
console.log("PASS: admin roadmap and schedule hold at runtime (local database)");
