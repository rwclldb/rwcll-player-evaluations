// Runtime check against the LOCAL Supabase database (Docker container only).
// Verifies registration admin, on-site players, bib upload, and prior-year upload.
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
const sql = fs.readFileSync(path.join(__dirname, "sql", "season-setup-runtime-check.sql"), "utf8");

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
  console.error(`FAIL: season setup runtime check exited with status ${result.status}`);
  if (!notices.length) console.error(output);
  process.exit(1);
}

const passes = notices.filter((line) => line.includes("PASS:")).length;
if (passes < 24) {
  console.error(`FAIL: expected 24 PASS lines, saw ${passes}`);
  process.exit(1);
}
console.log("PASS: season setup tools (registration admin, on-site players, bibs, prior-year) hold at runtime (local database)");
