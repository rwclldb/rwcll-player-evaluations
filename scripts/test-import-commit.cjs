const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20261104230000_phase_5_5_sports_connect_commit.sql"
);
const sql = fs.readFileSync(migrationPath, "utf8");

const checks = [
  [
    "admin authorization required",
    /v_actor\s+uuid\s*:=\s*auth\.uid\(\)[\s\S]*?IF\s+v_actor\s+IS\s+NULL\s+OR\s+NOT\s+public\.is_admin\(\)\s+THEN/i,
  ],
  [
    "commit reason must be 5–1000 characters",
    /length\(btrim\(coalesce\(p_reason,\s*''\)\)\)\s*<\s*5\s+OR\s+length\(p_reason\)\s*>\s*1000/i,
  ],
  [
    "staged row is locked during commit",
    /FOR UPDATE/i,
  ],
  [
    "already-committed row supports safe retry",
    /review_state\s*=\s*'committed'[\s\S]*?committed_player_season_id[\s\S]*?RETURN/i,
  ],
  [
    "unapproved rows are rejected",
    /review_state\s+NOT IN\s*\(\s*'approved_new'\s*,\s*'approved_match'\s*\)[\s\S]*?RAISE EXCEPTION/i,
  ],
  [
    "only player imports can be committed",
    /batch_import_type\s*<>\s*'players'[\s\S]*?RAISE EXCEPTION/i,
  ],
  [
    "closed seasons are rejected",
    /v_season_is_closed[\s\S]*?RAISE EXCEPTION/i,
  ],
  [
    "first and last names are required",
    /first_name[\s\S]*?last_name[\s\S]*?RAISE EXCEPTION/i,
  ],
  [
    "approved matches must reference an existing player",
    /approved_match[\s\S]*?FROM public\.players[\s\S]*?RAISE EXCEPTION/i,
  ],
  [
    "new-player insert is in the non-match branch",
    /IF\s+v_row\.review_state\s*=\s*'approved_match'\s+THEN[\s\S]*?v_player_id\s*:=\s*v_row\.matched_player_id\s*;[\s\S]*?ELSE\s*;?[\s\S]*?INSERT INTO public\.players/i,
  ],
  [
    "season registration is created",
    /INSERT INTO public\.player_seasons/i,
  ],
  [
    "staged row is marked committed",
    /review_state\s*=\s*'committed'[\s\S]*?committed_player_season_id/i,
  ],
  [
    "commit action is audited",
    /sports_connect_import_row_committed/i,
  ],
  [
    "function uses SECURITY DEFINER",
    /SECURITY DEFINER/i,
  ],
];

let failures = 0;

for (const [label, pattern] of checks) {
  const ok = pattern.test(sql);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures++;
}

if (failures > 0) {
  console.error(`\n${failures} commit migration check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nPASS: all static commit migration checks.");
}

console.log(
  "LIMITATION: static source checks only; they do not execute the PostgreSQL function."
);
