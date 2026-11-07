const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const reportsPage = read("app/protected/reports/page.tsx");
const playerPage = read("app/protected/reports/player/[playerSeasonId]/page.tsx");
const exportRoute = read("app/protected/reports/export/route.ts");
const workspace = read("app/protected/page.tsx");

assert.match(reportsPage, /supabase\.rpc\("is_admin"\)/, "report index must require administrator access");
assert.match(playerPage, /supabase\.rpc\("is_admin"\)/, "individual report must require administrator access");
assert.match(exportRoute, /supabase\.rpc\("is_admin"\)/, "CSV export must enforce administrator access server-side");
assert.match(reportsPage, /Export season CSV/, "report index must provide CSV export");
assert.match(playerPage, /Current-season evaluations/, "player report must have a current-season section");
assert.match(playerPage, /Current age-group ratings/, "player report must show current age-group averages");
assert.match(playerPage, /Historical coach evaluations/, "player report must have a separate historical section");
assert.match(playerPage, /never combined into one average/, "report must make clear current and historical ratings are not combined");
assert.match(playerPage, /historical_evaluations/, "player report must load matched historical evaluations");
assert.match(playerPage, /historical_ratings/, "player report must load historical rating details");
assert.match(exportRoute, /"CURRENT"/, "CSV must label current evaluation rows");
assert.match(exportRoute, /"HISTORICAL_COACH"/, "CSV must label historical coach rows separately");
assert.match(exportRoute, /CURRENT_GROUP_SUMMARY/, "CSV must include age-group summary rows separately");
assert.match(exportRoute, /rating_count/, "CSV must include the number of ratings behind each score or average");
assert.match(exportRoute, /source_season_label/, "CSV must preserve historical source season");
assert.match(exportRoute, /coverage_note/, "CSV must preserve historical coverage notes");
assert.match(exportRoute, /text\.replace\(\/"/, "CSV must escape embedded quotation marks");
assert.match(exportRoute, /Prevent spreadsheet formula execution/, "CSV must guard against spreadsheet formula injection");
assert.match(exportRoute, /Cache-Control.*private, no-store/, "CSV must not be cached publicly");
assert.match(workspace, /\/protected\/reports/, "administrator workspace must link to player reports");

console.log("PASS: administrator player reports and CSV source checks");
