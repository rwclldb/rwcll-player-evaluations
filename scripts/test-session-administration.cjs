const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const sessionsActions = read("app/protected/sessions/actions.ts");
const sessionsPage = read("app/protected/sessions/page.tsx");
const sessionActionsComponent = read("app/protected/sessions/SessionActions.tsx");
const eventManager = read("app/protected/sessions/SessionEventManager.tsx");
const globalSchedule = read("app/protected/sessions/GlobalPrimarySchedule.tsx");
const globalMakeupSchedule = read("app/protected/sessions/GlobalMakeupSchedule.tsx");
const sessionActions = read("app/protected/sessions/SessionActions.tsx");
const eventMigration = read("supabase/migrations/20261109100000_add_evaluation_session_events.sql");
const eligibilityMigration = read("supabase/migrations/20261109090000_allow_all_payment_statuses_in_evaluations.sql");
const evaluatorPage = read("app/protected/evaluations/page.tsx");
const reviewPage = read("app/protected/evaluation-review/page.tsx");
const assignmentPage = read("app/protected/assignments/page.tsx");

for (const [name, source] of [
  ["session creation action", sessionsActions],
  ["session management page", sessionsPage],
  ["evaluator workspace", evaluatorPage],
  ["administrator review page", reviewPage],
  ["evaluator assignment page", assignmentPage],
]) {
  assert.match(source, /\b7\b/, `${name} must support Little League age 7`);
  assert.match(source, /\b16\b/, `${name} must retain age 16`);
}
assert.doesNotMatch(sessionsActions, /\[6,\s*7|\b6\s*,\s*7\b/, "age 6 must not be included in session creation");
assert.match(sessionsActions, /saveEvaluationSessionEvent/, "server actions must save scheduled events");
assert.match(sessionsActions, /deleteEvaluationSessionEvent/, "server actions must remove scheduled events");
assert.match(sessionsActions, /applyGlobalPrimaryEventSchedule/, "server action must apply a global primary schedule");
assert.match(sessionsActions, /applyGlobalMakeupEventSchedule/, "server action must apply a global makeup schedule");
assert.match(sessionsActions, /\["open", "setup"\]/, "status action must accept Setup as a requested destination so open sessions can return to Setup");
assert.match(sessionsActions, /rpc\("change_evaluation_session_stage"/, "lock, unlock, release, and unrelease must go through the audited stage function");
assert.match(globalMakeupSchedule, /Global makeup event schedule/, "sessions page must offer a global makeup schedule");
assert.match(sessionsActions, /event_type: "makeup"/, "global makeup schedule must create makeup events");
assert.match(globalMakeupSchedule, /primarySessionIds/, "global makeup schedule must require an existing primary event");
assert.match(sessionsPage, /GlobalMakeupSchedule/, "sessions page must render the global makeup scheduler");
assert.match(globalSchedule, /Preview eligible sessions/, "global schedule must require a preview step");
assert.match(globalSchedule, /existing primary schedule/i, "global schedule must explain that existing primary events are preserved");
assert.match(globalSchedule, /2027-02-20/, "global schedule date field should have the agreed example default");
assert.match(globalSchedule, /09:00/, "global schedule start time should have the agreed example default");
assert.match(globalSchedule, /13:00/, "global schedule end time should have the agreed example default");
assert.match(sessionsActions, /session.status === "open" && requestedStatus === "setup"/, "an open session may return to Setup");
assert.match(sessionsActions, /evaluationCountError/, "returning to Setup must check for existing evaluation work");
assert.match(sessionsActions, /evaluation%20records.%20It%20cannot%20return%20to%20Setup/, "returning to Setup must refuse sessions with evaluation records");
assert.match(sessionActions, /Return to Setup/, "admin UI must offer a return-to-setup action for open sessions");
assert.match(sessionsActions, /requestedStatus === "open"[\s\S]*?evaluation_session_events/, "opening must check for a primary event");
assert.match(sessionsActions, /Assign%20at%20least%20one%20evaluator/, "opening must require an evaluator assignment");
assert.match(sessionActionsComponent, /actionButton\("open", "Open Session", [^\n]*, !hasPrimaryEvent \|\| !hasEvaluator\)/, "UI must disable opening until prerequisites are met");
assert.match(sessionActionsComponent, /Step 1 of 2[\s\S]*Undo:[\s\S]*Step 2 of 2[\s\S]*Undo:/, "lock and release confirmations must explain both steps and how to undo them");
assert.match(eventManager, /type="date"/, "event form must collect a date");
assert.match(eventManager, /type="time"/g, "event form must collect start and end times");
assert.match(eventManager, /name="location"/, "event form must collect a location");
assert.match(eventManager, /eventType="makeup"/, "event manager must support makeup events");
assert.match(eventMigration, /league_age BETWEEN 7 AND 16/, "database must reject age 6 and ages above 16 for age-based sessions");
assert.match(eventMigration, /evaluation_session_events_one_primary_per_session/, "database must enforce at most one primary event per session");
assert.match(eventMigration, /require_scheduled_evaluator_before_session_open/, "database must enforce opening prerequisites");
assert.match(eventMigration, /A session in a closed season cannot be opened/, "database must block opening sessions in a closed season");
assert.match(eventMigration, /At least one evaluator must be assigned/, "database trigger must require an evaluator");
assert.match(eventMigration, /A primary evaluation event must be scheduled/, "database trigger must require the primary event");
assert.match(eventMigration, /v_status <> 'setup' OR v_season_closed/, "event changes must be blocked after setup or for closed seasons");
assert.match(eligibilityMigration, /Payment status is intentionally not checked/, "database save/validation functions must not gate on payment status");
assert.doesNotMatch(eligibilityMigration, /registration_payment_status[^\n]*(?:NOT IN| IN \()/, "database evaluation eligibility must not filter payment statuses");
assert.doesNotMatch(evaluatorPage, /isEligibleRegistrationStatus|\.not\("registration_payment_status"/, "evaluator list must include unpaid and unknown registrations");
assert.match(evaluatorPage, /Scheduled events/, "assigned evaluators must see the scheduled event details");
assert.doesNotMatch(evaluatorPage, /unpaid and UNKNOWN registrations are excluded/i, "evaluation UI must not describe unpaid or unknown registrations as excluded");
assert.doesNotMatch(reviewPage, /isEligibleRegistrationStatus|registration_payment_status/, "evaluation review must not gate on or display payment status");

console.log("PASS: ages 7–16, per-session and global event scheduling, preview/no-overwrite safeguards, return-to-setup protections, opening prerequisites, and payment-independent eligibility");
