const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.resolve(
  __dirname,
  "../supabase/migrations/20261105010000_handle_existing_registration_in_import_commit.sql"
);

const originalMigrationPath = path.resolve(
  __dirname,
  "../supabase/migrations/20261104230000_phase_5_5_sports_connect_commit.sql"
);

assert.ok(fs.existsSync(migrationPath), "New migration must exist");
assert.ok(
  fs.existsSync(originalMigrationPath),
  "Original Phase 5.5 migration must exist"
);

const migration = fs.readFileSync(migrationPath, "utf8");
const originalMigration = fs.readFileSync(originalMigrationPath, "utf8");

const functionStart = migration.indexOf(
  "CREATE OR REPLACE FUNCTION public.commit_sports_connect_import_row("
);

assert.notEqual(functionStart, -1, "Commit function must be defined");

const fn = migration.slice(functionStart);

const approvedMatchStart = fn.indexOf(
  "IF v_row.review_state = 'approved_match' THEN"
);
const registrationInsert = fn.indexOf(
  "INSERT INTO public.player_seasons ("
);

assert.notEqual(approvedMatchStart, -1, "Approved-match branch must exist");
assert.notEqual(registrationInsert, -1, "Registration insert must exist");

const approvedMatchBlock = fn.slice(approvedMatchStart, registrationInsert);

const checks = [
  [
    "existing-registration conflict is checked before insertion",
    /IF EXISTS\s*\(\s*SELECT 1\s+FROM public\.player_seasons AS ps\s+WHERE ps\.player_id = v_player_id\s+AND ps\.season_id = v_row\.batch_season_id\s*\)/s.test(
      approvedMatchBlock
    ),
  ],
  [
    "conflict produces an actionable error",
    /already has a registration for this season[\s\S]*Review the existing registration/i.test(
      approvedMatchBlock
    ),
  ],
  [
    "approved match still requires an existing player ID",
    /IF v_row\.matched_player_id IS NULL THEN[\s\S]*?An approved match must identify an existing player/.test(
      approvedMatchBlock
    ),
  ],
  [
    "existing player is verified and locked",
    /FROM public\.players AS p[\s\S]*?WHERE p\.id = v_row\.matched_player_id[\s\S]*?FOR SHARE/.test(
      approvedMatchBlock
    ),
  ],
  [
    "matched player's identity is not overwritten",
    !/UPDATE public\.players\b/i.test(fn),
  ],
  [
    "safe retry returns the existing registration",
    /IF v_row\.review_state = 'committed' THEN[\s\S]*?RETURN v_row\.committed_player_season_id/.test(
      fn
    ),
  ],
  [
    "registration insert remains present after conflict check",
    registrationInsert > approvedMatchStart,
  ],
  [
    "batch counter is incremented after commit",
    /UPDATE public\.import_batches\s+SET rows_processed = rows_processed \+ 1/.test(
      fn
    ),
  ],
  [
    "commit audit event remains present",
    /'sports_connect_import_row_committed'/.test(fn),
  ],
  [
    "function execution is restricted to authenticated users",
    /REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC[\s\S]*?REVOKE ALL ON FUNCTION[\s\S]*?FROM anon[\s\S]*?GRANT EXECUTE ON FUNCTION[\s\S]*?TO authenticated/.test(
      migration
    ),
  ],
  [
    "original migration still enforces unique season/player identifiers",
    /CREATE UNIQUE INDEX player_seasons_season_external_player_id_uidx/.test(
      originalMigration
    ) &&
      /CREATE UNIQUE INDEX player_seasons_season_external_registration_id_uidx/.test(
        originalMigration
      ),
  ],
];

let failures = 0;

for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed) failures++;
}

if (failures > 0) {
  console.error(`\n${failures} migration regression check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nPASS: all migration registration-conflict checks.");
}

console.log("LIMITATION: static source checks only; no database was modified.");