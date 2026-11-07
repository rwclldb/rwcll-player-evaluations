const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/20261107030000_scoped_coach_historical_reports.sql");
const rosterPage = read("app/protected/coach-reports/page.tsx");
const playerPage = read("app/protected/coach-reports/player/[playerSeasonId]/page.tsx");
const evaluatorPage = read("app/protected/evaluations/page.tsx");

assert.match(migration, /FUNCTION public\.coach_historical_report_roster\(p_season_id bigint\)/, "migration must define a scoped roster RPC");
assert.match(migration, /FUNCTION public\.coach_historical_report\(p_player_season_id bigint\)/, "migration must define a scoped history RPC");
assert.equal((migration.match(/^\s*SECURITY DEFINER\s*$/gm) ?? []).length, 2, "both RPCs must use controlled SECURITY DEFINER access");
assert.match(migration, /tca\.coach_user_id = auth\.uid\(\)/, "coach access must be checked against the authenticated user");
assert.match(migration, /tca\.team_id = t\.id/, "coach access must be limited to assigned teams");
assert.match(migration, /tca\.season_id = ps\.season_id/, "coach assignment must match the player's season");
assert.match(migration, /REVOKE ALL ON FUNCTION public\.coach_historical_report\(bigint\) FROM PUBLIC, anon/, "history RPC must not be executable by public or anon");
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.coach_historical_report\(bigint\) TO authenticated/, "authenticated users must be able to call the checked history RPC");
assert.match(rosterPage, /coach_historical_report_roster/, "coach roster page must use the scoped roster RPC");
assert.match(playerPage, /coach_historical_report"/, "coach report page must use the scoped history RPC");
assert.doesNotMatch(playerPage, /from\("historical_evaluations"\)|from\("historical_ratings"\)/, "coach UI must not directly query admin-only historical tables");
assert.match(playerPage, /if \(result\.error\) notFound\(\)/, "unauthorized player report requests must not disclose report data");
assert.match(evaluatorPage, /\/protected\/coach-reports/, "coach workspace must link to historical reports");

console.log("PASS: scoped coach historical report authorization source checks");
