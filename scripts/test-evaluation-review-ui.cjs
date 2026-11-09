const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const reviewPage = read("app/protected/evaluation-review/page.tsx");
const evaluatorPage = read("app/protected/evaluations/page.tsx");
const workspacePage = read("app/protected/page.tsx");
const eligibilityMigration = read("supabase/migrations/20261108150000_allow_pending_registrations_in_evaluations.sql");
const signUpPage = read("app/auth/sign-up/page.tsx");
const actions = read("app/actions.ts");

assert.match(reviewPage, /supabase\.rpc\("is_admin"\)/, "review page must verify administrator access");
assert.match(reviewPage, /redirect\("\/protected"\)/, "non-admin users must be redirected");
assert.match(reviewPage, /ratingSummary\(/, "review page must calculate player rating summaries");
assert.match(reviewPage, /CORE_CODES/, "rating summaries must use the five core categories");
assert.match(reviewPage, /evaluation\.status === "submitted"/, "aggregate averages must use submitted evaluations only");
assert.match(reviewPage, /values\.length \? \(values\.reduce/, "missing ratings must be excluded from averages");
assert.match(evaluatorPage, /function isEligibleRegistrationStatus/, "evaluator page must centralize registration eligibility");
assert.match(evaluatorPage, /\["completed", "paid", "pending"\]/, "Pending, Paid, and Completed registrations must be eligible");
assert.match(reviewPage, /\["completed", "paid", "pending"\]/, "review page must use the same registration eligibility rule");
assert.match(eligibilityMigration, /IN \('completed', 'paid', 'pending'\)/, "database eligibility and RLS must include Pending registrations");
assert.match(eligibilityMigration, /Only Paid, Completed, or Pending registrations are eligible/, "database validation must document the eligibility rule");
assert.match(workspacePage, /\/protected\/evaluation-review/, "administrator workspace must link to review page");
assert.match(signUpPage, /ALLOW_PUBLIC_SIGNUP !== "true"/, "public self-registration must be disabled unless explicitly enabled");
assert.match(actions, /if \(process\.env\.ALLOW_PUBLIC_SIGNUP !== "true"\)/, "server action must reject public self-registration when disabled");
assert.match(signUpPage, /Account creation is managed by an administrator/, "disabled sign-up page must explain the account provisioning policy");
assert.match(evaluatorPage, /dark:text-emerald-400/, "fixed accent colors must provide a dark-theme variant");

console.log("PASS: administrator review, rating summary, and registration eligibility checks");
