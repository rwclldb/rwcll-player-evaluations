// Season backup: admin_season_backup against the LOCAL Supabase database (Docker container only; rolled back),
// then the zip's files built by lib/season-backup.ts from a small sample (no database).
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
const sql = fs.readFileSync(path.join(__dirname, "sql", "season-backup-runtime-check.sql"), "utf8");
const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-At"], { input: sql, encoding: "utf8" });
if (result.error) {
  console.error(`FAIL: could not run docker (${result.error.message}). Is local Supabase running?`);
  process.exit(1);
}
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const notices = output.split(/\r?\n/).filter((line) => /PASS:|FAIL:|ERROR:/.test(line));
notices.forEach((line) => console.log(line.replace(/^.*?(PASS:|FAIL:|ERROR:)/, "$1")));
if (result.status !== 0) {
  console.error(`FAIL: season backup runtime check exited with status ${result.status}`);
  if (!notices.length) console.error(output);
  process.exit(1);
}
const passes = notices.filter((line) => line.includes("PASS:")).length;
if (passes < 14) {
  console.error(`FAIL: expected 14 PASS lines, saw ${passes}`);
  process.exit(1);
}

// ---------- the files in the zip ----------
const jiti = require("jiti")(__filename, { alias: { "@": root } });
const { buildBackupFiles, csvCell, tableCsv, backupFileName } = jiti(path.join(root, "lib/season-backup.ts"));
let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${ok || detail === undefined ? "" : ` (${JSON.stringify(detail)})`}`);
  if (!ok) failed++;
};

const COACH = "11111111-1111-4111-8111-111111111111";
const backup = {
  made_at: "2027-01-23T22:15:00Z",
  season_id: 2,
  tables: {
    seasons: [{ id: 2, name: "Spring 2027", is_closed: false }],
    divisions: [{ id: 1, name: "AA" }],
    season_divisions: [],
    rating_categories: [
      { id: 1, code: "hitting", name: "Hitting", sort_order: 1 }, { id: 2, code: "throwing", name: "Throwing", sort_order: 2 },
      { id: 6, code: "pitching_mechanics", name: "Pitching Mechanics", sort_order: 6 },
    ],
    // A future column holding a birthdate must never reach the CSV.
    players: [{ id: 10, first_name: "=Ann", last_name: "O'Neil, Jr.", has_birth_date: true, date_of_birth: "2018-01-02" }],
    player_seasons: [{ id: 100, player_id: 10, season_id: 2, league_age: 8, evaluation_number: 201, is_coach_kid: true, registration_source: "import" }],
    evaluation_sessions: [{ id: 5, season_id: 2, league_age: 8, status: "open" }],
    evaluation_session_events: [{ id: 50, evaluation_session_id: 5, event_type: "primary", event_date: "2027-01-23", start_time: "09:00:00", end_time: "10:30:00", location: "Red Morton" }],
    evaluator_assignments: [{ id: 1, evaluation_session_id: 5, evaluator_user_id: COACH, evaluator_type: "coach" }],
    evaluations: [{ id: 900, evaluation_session_id: 5, player_season_id: 100, evaluator_user_id: COACH, evaluator_type: "coach", status: "submitted", submitted_at: "2027-01-23T18:00:00Z" }],
    ratings: [{ id: 1, evaluation_id: 900, rating_category_id: 1, score: 4 }, { id: 2, evaluation_id: 900, rating_category_id: 6, score: 3 }],
    experience_answers: [{ id: 1, evaluation_id: 900, question_code: "pitched_before", answer: "yes" }],
    evaluator_notes: [],
    historical_evaluations: [{ id: 70, player_id: 10, source_season_label: "Spring 2026", source_division_name: "AA", source_team_label: "AA 01", source_coach_name: "Pat" }],
    historical_ratings: [{ id: 1, historical_evaluation_id: 70, category_name: "Hitting", rating_category_id: 1, score: 2 }],
    player_checkins: [{ id: 1, player_season_id: 100, event_id: 50 }],
    player_calls: [],
    player_exemptions: [{ id: 1, player_season_id: 100, scope: "attendance", reason: "Injured", revoked_at: null }],
    teams: [], team_coach_assignments: [],
    user_roles: [{ id: 1, user_id: COACH, role_name: "coach", season_id: 2 }],
    coach_divisions: [{ id: 1, season_id: 2, user_id: COACH, division_id: 1 }],
    accounts: [{ user_id: COACH, email: "coach@example.com", display_name: "Avery Coach", disabled: false, last_sign_in_at: null }],
  },
};
const draft = [{
  player_season_id: 100, evaluation_number: 201, first_name: "=Ann", last_name: "O'Neil, Jr.", league_age: 8,
  coach_overall: 4, coach_evaluations: 1, evaluator_overall: null, evaluator_evaluations: 0, prior_overall: 2, prior_ratings: 1,
  skill_averages: { coach: { hitting: 4 }, evaluator: {}, prior: { hitting: 2 } }, blank_core_skills: 4, not_evaluated_marks: 0, drafts_excluded: 0,
}];
const files = buildBackupFiles(backup, draft, "Jordan Admin");
const lines = (name) => files[name].replace(/^﻿/, "").trim().split("\r\n");

const expected = ["README.txt", "draft-report.csv", "scores.csv", "players.csv", "prior-year.csv", "people.csv", "schedule.csv",
  ...Object.keys(backup.tables).map((t) => `tables/${t}.csv`)];
check("every readable file and raw table is in the zip", expected.every((f) => typeof files[f] === "string"), expected.filter((f) => !files[f]));
check("no birthdate in any file", Object.values(files).every((text) => !text.includes("2018-01-02") && !/date_of_birth/.test(text)));
check("CSV files start with a BOM for Excel", files["players.csv"].startsWith("﻿") && files["tables/players.csv"].startsWith("﻿"));
check("a name starting with = is not run as a formula", csvCell("=Ann") === `"'=Ann"`, csvCell("=Ann"));
check("commas and quotes are escaped", csvCell('a,"b"') === '"a,""b"""', csvCell('a,"b"'));
check("players.csv row: age, bib, names, coach's kid, exemption, DOB on file, check-ins",
  lines("players.csv")[1].startsWith(`8,201,"O'Neil, Jr.","'=Ann",Yes,Attendance,Yes,`) && lines("players.csv")[1].includes(",1,0,1,100,10"), lines("players.csv")[1]);
check("scores.csv has a column per category with the scorer's name and answers",
  lines("scores.csv")[0].includes("Hitting,Throwing,Pitching Mechanics") && lines("scores.csv")[1].includes("Avery Coach,Coach,Saved")
  && lines("scores.csv")[1].includes(",4,,3,yes,"), lines("scores.csv"));
check("draft-report.csv keeps coach and prior averages separate", lines("draft-report.csv")[1].includes(",,0,4.00,,1,2.00,1,"), lines("draft-report.csv")[1]);
check("prior-year.csv lists the coach's rating", lines("prior-year.csv")[1].endsWith("Spring 2026,AA,AA 01,Pat,2"), lines("prior-year.csv")[1]);
check("people.csv shows roles, divisions and age groups", lines("people.csv")[1].startsWith("Avery Coach,coach@example.com,Coach,AA,8,"), lines("people.csv")[1]);
check("schedule.csv shows the main event", lines("schedule.csv")[1] === "8,open,Main,2027-01-23,09:00,10:30,Red Morton,", lines("schedule.csv")[1]);
check("README names the season and what is left out", files["README.txt"].includes("Spring 2027") && files["README.txt"].includes("Birthdates")
  && files["README.txt"].includes("private notes"));
check("raw tables keep every column but birthdates", tableCsv([{ id: 1, birth_date_text: "x", name: "A" }, { id: 2, extra: true }]).includes("id,name,extra"));
check("file name has the season and Pacific date", backupFileName("Spring 2027", "2027-01-24T05:30:00Z") === "rwcll-backup-Spring-2027-2027-01-23-2130.zip",
  backupFileName("Spring 2027", "2027-01-24T05:30:00Z"));

if (failed) {
  console.error(`FAIL: ${failed} season backup file check(s) failed`);
  process.exit(1);
}
console.log("PASS: season backup holds at runtime (local database) and builds its files");
