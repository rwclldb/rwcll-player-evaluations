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
assert.match(source, /supabase\.auth\.getClaims\(\)/, "detail page must require authentication");
assert.match(source, /supabase\.rpc\(["']is_admin["']\)/, "detail page must check administrator access server-side");
assert.match(source, /\.from\(["']players["']\)/, "candidate suggestions should read existing player records");
assert.match(source, /offset < 10000/, "candidate search must have a hard overall bound");
assert.match(source, /\.range\(offset, offset \+ 999\)/, "candidate search must page around API row caps");
assert.match(source, /Name and birth date match/);
assert.match(source, /Name matches; birth date differs or is missing/);
assert.match(source, /Birth date matches; name differs/);
assert.match(source, /never link or merge players/i, "UI must state suggestions are not automatic identity decisions");
assert.doesNotMatch(source, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/, "candidate suggestion view must not mutate database records");
console.log("PASS: candidate-suggestion TSX syntax, auth/admin gates, bounded player query, match signal labels, and read-only contract.");
console.log("LIMITATION: static checks only; candidate suggestions must be exercised in the local app with controlled fake player records before relying on them.");
