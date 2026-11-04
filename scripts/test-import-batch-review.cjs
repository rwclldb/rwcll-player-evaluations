const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const files = [
  "app/protected/page.tsx",
  "app/protected/import-preview/page.tsx",
  "app/protected/import-batches/page.tsx",
  "app/protected/import-batches/[batchId]/page.tsx",
];
for (const relative of files) {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, "utf8");
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  });
  const errors = (result.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${relative} has TSX syntax errors`);
}

const listPage = fs.readFileSync(path.join(root, files[2]), "utf8");
const detailPage = fs.readFileSync(path.join(root, files[3]), "utf8");
for (const [name, source] of [["batch list", listPage], ["batch detail", detailPage]]) {
  assert.match(source, /supabase\.auth\.getClaims\(\)/, `${name} must require an authenticated user`);
  assert.match(source, /supabase\.rpc\(["']is_admin["']\)/, `${name} must check admin role server-side`);
  assert.match(source, /<Suspense/, `${name} must use a Suspense boundary for request-specific rendering`);
  assert.match(source, /await connection\(\)/, `${name} must defer request-specific data access`);
}
assert.match(listPage, /\.limit\(100\)/, "batch list should be bounded");
assert.match(detailPage, /\.limit\(5000\)/, "row detail query should be bounded to max batch size");
assert.match(detailPage, /Read-only review|Read-only review\./, "detail page must clearly state that it is read-only");
assert.doesNotMatch(listPage + detailPage, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/, "review pages must not mutate database records");
assert.match(fs.readFileSync(path.join(root, "app/protected/page.tsx"), "utf8"), /\/protected\/import-batches/);
console.log("PASS: staged batch list/detail TSX syntax, auth/admin gates, request-time rendering boundaries, bounded queries, navigation, and read-only contract.");
console.log("LIMITATION: static contract checks only; database behavior still requires testing against the local Supabase instance after applying the Phase 5.0 migration locally.");
