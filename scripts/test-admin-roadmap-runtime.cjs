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
  ["a fully set-up season has every Before step done", rm.stepProgress(rm.buildSteps(data(), "before")).done === 7],
  ["a player without a bib flags the bib step", step(data({ registrations: { total: 10, no_bib: 1, no_age: 0, on_site: 0 } }), "before", "bibs").status === "attention"],
  ["an age group without an evaluator flags assignments", step(data({ sessions: [sess({ evaluators: 0 })] }), "before", "assignments").detail.includes("Age 9")],
  ["readiness links to players without bibs", step(data({ registrations: { total: 10, no_bib: 2, no_age: 0, on_site: 0 }, sessions: [sess({ no_bib: 2 })] }), "week", "readiness").links[0].href.includes("show=nobib")],
  ["an age group in Setup leaves Open scoring to do", step(data({ sessions: [sess({ status: "setup" })] }), "week", "open").status === "todo"],
  ["release is done only when every age group is released", step(data({ sessions: [sess({ status: "locked", released: true }), sess({ id: 2, league_age: 10, status: "locked" })] }), "after", "release").status === "todo"],
  ["end-of-season re-rating is marked coming later", step(data(), "end", "rerate").status === "later"],
  ["dates format without a time-zone shift", rm.formatDate("2027-01-23") === "Sat, Jan 23" && rm.formatTime("15:30:00") === "3:30 PM"],
];
for (const [label, ok] of checks) {
  if (!ok) { console.error(`FAIL: ${label}`); process.exit(1); }
  console.log(`PASS: ${label}`);
}
console.log("PASS: admin roadmap and schedule hold at runtime (local database)");
