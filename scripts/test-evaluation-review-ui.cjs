const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const reviewPage = read("app/protected/evaluation-review/page.tsx");
const evaluatorPage = read("app/protected/evaluations/page.tsx");
const workspacePage = read("app/protected/page.tsx");

assert.match(reviewPage, /supabase\.rpc\("is_admin"\)/, "review page must verify administrator access");
assert.match(reviewPage, /redirect\("\/protected"\)/, "non-admin users must be redirected");
assert.match(reviewPage, /Players with a record/, "review page must report player evaluation completion");
assert.match(reviewPage, /Players with no evaluation record/, "review page must identify missing player evaluations");
assert.match(reviewPage, /Evaluator progress/, "review page must report evaluator progress");
assert.match(reviewPage, /Core total:/, "review page must show core score summaries");
assert.match(reviewPage, /CORE_CODES/, "core score summaries must use the five core categories");
assert.match(evaluatorPage, /"Pending"/, "Pending registrations must be eligible for evaluation");
assert.match(evaluatorPage, /Pending registrations remain eligible/, "eligibility explanation must match the rule");
assert.match(workspacePage, /\/protected\/evaluation-review/, "administrator workspace must link to review page");

console.log("PASS: administrator evaluation review UI checks");
