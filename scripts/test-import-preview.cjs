const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const uiFiles = [
  path.join(root, "app", "protected", "page.tsx"),
  path.join(root, "app", "protected", "import-preview", "page.tsx"),
  path.join(root, "app", "protected", "import-preview", "registration-import-preview.tsx"),
  path.join(root, "app", "protected", "import-preview", "actions.ts"),
];
for (const file of uiFiles) {
  const uiSource = fs.readFileSync(file, "utf8");
  const uiResult = ts.transpileModule(uiSource, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  });
  const syntaxErrors = (uiResult.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(syntaxErrors.length, 0, `${path.relative(root, file)} has TypeScript/JSX syntax errors`);
}
console.log("PASS: protected-page and import-preview TSX syntax transpilation.");

const sourcePath = path.join(root, "lib", "sports-connect-preview.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  fileName: sourcePath,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    resolveJsonModule: true,
    esModuleInterop: true,
  },
});
const parserModule = { exports: {} };
new Function("require", "module", "exports", transpiled.outputText)(
  createRequire(sourcePath), parserModule, parserModule.exports,
);
const { makePreview, ACTIVE_DIVISIONS, safeCsvCell } = parserModule.exports;

const fixturePath = path.join(root, "docs", "test-fixtures", "sports-connect-sample-spring-2027-fake.csv");
const fixture = fs.readFileSync(fixturePath, "utf8");
const result = makePreview(fixture);
assert.deepEqual(result.missingHeaders, []);
assert.equal(result.rows.length, 323);
assert.equal(result.rows.filter((row) => row.paymentStatus === "Completed").length, 286);
assert.equal(result.rows.filter((row) => row.paymentStatus === "Pending").length, 37);
assert.equal(result.rows.filter((row) => row.registrationNumber).length, 0);
assert.equal(result.rows.filter((row) => row.leagueAge === null).length, 0);
assert.equal(result.rows.filter((row) => !ACTIVE_DIVISIONS.has(row.division.toUpperCase())).length, 75);
assert.equal(result.rows.filter((row) => row.issues.includes("Duplicate Player ID in file")).length, 0);

const quoted = 'Program Name,Division Name,Player Id,Registration Number,Player First Name,Player Last Name,Player Birth Date,Order Payment Status\n"Spring, 2027",AA,1,,"Sam ""Slugger""",Test,01/02/2019,Completed\n';
const quotedResult = makePreview(quoted);
assert.equal(quotedResult.rows[0].program, "Spring, 2027");
assert.equal(quotedResult.rows[0].firstName, 'Sam "Slugger"');
assert.equal(quotedResult.rows[0].leagueAge, 8);

const duplicate = makePreview('Program Name,Division Name,Player Id,Registration Number,Player First Name,Player Last Name,Player Birth Date,Order Payment Status\nS,AA,1,,A,B,01/02/2019,Completed\nS,AA,1,,C,D,01/02/2019,Pending\n');
assert.equal(duplicate.rows.filter((row) => row.issues.includes("Duplicate Player ID in file")).length, 2);
const missing = makePreview("Name,Player Id\nA,1\n");
assert.ok(missing.missingHeaders.length > 0);

console.log("PASS: 323-row sample; 286 Completed, 37 Pending; blank registration numbers; all ages resolved; 75 division-review rows; no duplicate IDs.");
console.log("PASS: quoted commas and escaped quotes, duplicate ID flags, and missing header detection.");
assert.equal(safeCsvCell("=1+1"), `"'=1+1"`);
assert.equal(safeCsvCell("  @SUM(A1:A2)"), `"'  @SUM(A1:A2)"`);
assert.equal(safeCsvCell('Sam "Slugger"'), `"Sam ""Slugger"""`);
console.log("PASS: issue-report CSV cells are quoted and spreadsheet-formula prefixes are neutralized.");

const importPage = fs.readFileSync(path.join(root, "app", "protected", "import-preview", "page.tsx"), "utf8");
assert.match(importPage, /supabase\.rpc\([\"']is_admin[\"']\)/, "import preview must perform a server-side administrator role check");
assert.match(importPage, /Administrator access required/, "non-admin users must be denied the import preview");
console.log("PASS: import preview requires the database-backed administrator role on the server.");
console.log("LIMITATION: tests the browser-side preview parser and static authorization contract only, not Supabase role behavior or database writes.");


const stagingMigration = fs.readFileSync(path.join(root, "supabase", "migrations", "20261104210000_add_sports_connect_staging.sql"), "utf8");
assert.match(stagingMigration, /CREATE TABLE IF NOT EXISTS public\.sports_connect_import_rows/);
assert.match(stagingMigration, /IF v_actor IS NULL OR NOT public\.is_admin\(\)/);
assert.match(stagingMigration, /Cannot stage an import for a closed season/);
assert.match(stagingMigration, /public\.try_parse_iso_date\(v_row->>'birthDate'\)/, "invalid ISO dates must be staged for review instead of aborting the whole batch");
assert.match(stagingMigration, /between 1 and 5000 rows/);
assert.match(stagingMigration, /sports_connect_import_staged/);
assert.match(stagingMigration, /REVOKE ALL ON FUNCTION public\.stage_sports_connect_import/);
assert.match(stagingMigration, /GRANT EXECUTE ON FUNCTION public\.stage_sports_connect_import.*TO authenticated/);
assert.doesNotMatch(stagingMigration, /INSERT INTO public\.players\b/i, "staging migration must not create player records");
assert.doesNotMatch(stagingMigration, /INSERT INTO public\.player_seasons\b/i, "staging migration must not create registrations");
const actionSource = fs.readFileSync(path.join(root, "app", "protected", "import-preview", "actions.ts"), "utf8");
assert.match(actionSource, /supabase\.rpc\("is_admin"\)/);
assert.match(actionSource, /stage_sports_connect_import/);
const clientSource = fs.readFileSync(path.join(root, "app", "protected", "import-preview", "registration-import-preview.tsx"), "utf8");
assert.match(clientSource, /Save batch for review/);
assert.match(clientSource, /No player or registration records were changed/);
console.log("PASS: staging migration/action guard checks; admin-only staging, open-season check, row cap, audit log, and no player/registration writes.");
