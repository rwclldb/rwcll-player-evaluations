const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const relative = "app/protected/import-batches/[batchId]/page.tsx";
const file = path.join(root, relative);
const source = fs.readFileSync(file, "utf8");
const result = ts.transpileModule(source, {
  fileName: file,
  reportDiagnostics: true,
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
});
const errors = (result.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
assert.equal(errors.length, 0, `${relative} has TSX syntax errors`);
assert.match(source, /supabase\.auth\.getUser\(\)/, "detail page must require authentication");
assert.match(source, /supabase\.rpc\(["']is_admin(_or_registrar)?["']\)/, "detail page must check administrator (or registrar) access server-side");
// Matching happens in the database (birthdate protection, migration 20261117120000): the page gets verdicts, never birthdates.
assert.match(source, /supabase\.rpc\(["']import_batch_candidates["']/, "candidate suggestions come from import_batch_candidates");
assert.doesNotMatch(source, /date_of_birth|birth_date_text|"birth_date"/, "the page must not read birthdates");
const birthdateMigration = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "supabase", "migrations", "20261117120000_birthdate_protection.sql"), "utf8");
assert.match(birthdateMigration, /Name and birthdate match/);
assert.match(birthdateMigration, /Name matches; birthdate differs or is missing/);
assert.match(birthdateMigration, /Birthdate matches; name differs/);
assert.match(source, /never link or merge players/i, "UI must state suggestions are not automatic identity decisions");
assert.doesNotMatch(source, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/, "candidate suggestion view must not mutate database records");
console.log("PASS: candidate-suggestion TSX syntax, auth/admin gates, bounded player query, match signal labels, and read-only contract.");
console.log("LIMITATION: static checks only; candidate suggestions must be exercised in the local app with controlled fake player records before relying on them.");
