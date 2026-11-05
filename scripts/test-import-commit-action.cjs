const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const file = path.resolve(
  __dirname,
  "../app/protected/import-batches/review-actions.ts"
);
const source = fs.readFileSync(file, "utf8");
const start = source.indexOf("export async function commitImportRow(");

assert.notEqual(start, -1, "commitImportRow action must exist");

const action = source.slice(start);

const checks = [
  [
    "authentication required",
    /supabase\.auth\.getClaims\(\)/,
  ],
  [
    "administrator authorization required",
    /supabase\.rpc\("is_admin"\)/,
  ],
  [
    "row must belong to requested batch",
    /Number\(row\.import_batch_id\)\s*!==\s*batchId/,
  ],
  [
    "only player import batches accepted",
    /batch\.import_type\s*!==\s*"players"/,
  ],
  [
    "unapproved rows rejected server-side",
    /row\.review_state\s*!==\s*"approved_new"[\s\S]*?row\.review_state\s*!==\s*"approved_match"[\s\S]*?Approve this row as new or as a verified match/,
  ],
  [
    "database commit RPC is called",
    /supabase\.rpc\("commit_sports_connect_import_row"/,
  ],
  [
    "database errors are returned safely",
    /if\s*\(error\)\s*\{[\s\S]*?ok:\s*false[\s\S]*?Could not commit the staged row/,
  ],
  [
    "successful commit refreshes review pages",
    /revalidatePath\(`\/protected\/import-batches\/\$\{batchId\}\/review`\)/,
  ],
];

let failures = 0;

for (const [label, pattern] of checks) {
  const ok = pattern.test(action);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures++;
}

if (failures) {
  console.error(`\n${failures} server-action check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nPASS: all commit server-action checks.");
}

console.log("LIMITATION: static source checks only.");
