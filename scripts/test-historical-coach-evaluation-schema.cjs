const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20261107020000_historical_coach_evaluation_schema.sql"
);
const designPath = path.join(root, "docs/DATABASE-DESIGN.md");
const migration = fs.readFileSync(migrationPath, "utf8");
const design = fs.readFileSync(designPath, "utf8");

const checks = [
  [
    "migration extends existing historical tables rather than creating duplicate ones",
    /ALTER TABLE public\.historical_evaluations[\s\S]*?ADD COLUMN source_season_id/.test(migration) &&
      /ALTER TABLE public\.historical_ratings[\s\S]*?ADD COLUMN rating_category_id/.test(migration) &&
      !/CREATE TABLE public\.historical_evaluations\b/.test(migration) &&
      !/CREATE TABLE public\.historical_ratings\b/.test(migration),
  ],
  [
    "historical import preserves the original source row as JSON",
    /source_data jsonb NOT NULL/.test(migration),
  ],
  [
    "matching supports player ID, details, and manual review provenance",
    /'player_id', 'name_and_details', 'manual_review'/.test(migration),
  ],
  [
    "unresolved historical rows remain in review and do not require a player link",
    /resolved_player_id bigint REFERENCES public\.players\(id\)[\s\S]*?review_state text NOT NULL DEFAULT 'pending_review'/.test(migration),
  ],
  [
    "approved and imported staging states require a resolved player",
    /review_state NOT IN \('approved_match', 'imported'\)[\s\S]*?resolved_player_id IS NOT NULL/.test(migration),
  ],
  [
    "one staging row per batch/source row is enforced",
    /UNIQUE \(import_batch_id, source_row_number\)/.test(migration),
  ],
  [
    "an imported historical evaluation cannot be linked from multiple staging rows",
    /CREATE UNIQUE INDEX historical_evaluation_import_rows_imported_evaluation_uidx/.test(migration),
  ],
  [
    "historical records and raw import staging use administrator RLS",
    /ALTER TABLE public\.historical_evaluation_import_rows ENABLE ROW LEVEL SECURITY/.test(migration) &&
      /historical_evaluation_import_rows_admin_all[\s\S]*?USING \(public\.is_admin\(\)\)[\s\S]*?WITH CHECK \(public\.is_admin\(\)\)/.test(migration) &&
      /historical_evaluations_admin_select[\s\S]*?USING \(public\.is_admin\(\)\)/.test(migration),
  ],
  [
    "design explicitly prohibits silent name-only matching and automatic player creation",
    /Never silently merge or link by name alone/.test(design) &&
      /must not create a new permanent player/.test(design),
  ],
  [
    "design keeps historical ratings out of current evaluation totals",
    /never contribute to current-season evaluator completion, counts, or averages/.test(design),
  ],
];

let failures = 0;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed) failures++;
}
if (failures) {
  console.error(`\n${failures} historical schema check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nPASS: all historical coach evaluation schema source checks.");
}
console.log("LIMITATION: static source checks only; apply migration to local Supabase and test database behavior separately.");
