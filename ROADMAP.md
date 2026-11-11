# RWCLL Player Evaluations — Roadmap

A task is checked only after it is implemented **and tested**. A confirmed requirement or design decision is not the same as an implemented feature. Test checkboxes refer to the scope stated; focused/static tests do not imply complete runtime authorization or production readiness.

## 1. Requirements agreed

- [x] One league; approximately 30–50 users.
- [x] Responsive web app/PWA direction for phones, tablets, and desktop.
- [x] No parent or player accounts.
- [x] Admin-managed invitations; no public registration in the intended product.
- [x] Coach and independent-evaluator ratings/averages remain separate.
- [x] Coaches see only authorized group aggregates; independent-evaluator identities are hidden from coaches.
- [x] Administrators can inspect individual submissions.
- [x] `Not Evaluated` is not zero and is excluded from averages.
- [x] Historical ratings are read-only and excluded from current averages.
- [x] Preserve prior seasons.
- [x] Seasons are closed by default after completion; administrator reopening for corrections is explicit and audited.
- [x] New seasons carry forward only editable division setup; do not copy teams, team names, coach assignments, evaluations, or historical results.
- [x] Stable internal player ID is independent of name/birthdate; import matches require administrator confirmation.
- [x] Coaches may be assigned to multiple teams in a season.
- [x] Coaches must not see a comparison/juxtaposition of assigned-team averages against division-wide averages.
- [x] Evaluation groups are based on official Little League age, not eventual division.
- [x] Each player has at most one roster assignment per season.
- [x] `evaluation_number` is season-specific, nullable, and does not carry forward.
- [x] Sports Connect IDs are season-specific external identifiers/matching clues, not permanent child IDs.
- [x] Import all registrations, including Pending and unpaid statuses; app does not process payments.
- [x] Final division/team assignment is post-draft; requested Sports Connect division is not treated as final assignment.
- [x] Historical player ratings are separate from current spring evaluations and require explicit matching.
- [x] Coach access to historical reports is restricted to players on teams assigned to that coach in the current season.

## 2. Development foundation

- [x] Create private GitHub repository and clone locally.
- [x] Scaffold Next.js app with Supabase.
- [x] Configure `.env.local` and verify it is Git-ignored.
- [x] Load app at `http://localhost:3000`.
- [x] Create Supabase test user and verify sign-in/protected page.
- [x] Add project documentation to Git.
- [x] Establish version-controlled SQL migration workflow.
- [x] Verify lint and production build at initial foundation checkpoint.

## 3. Database foundation and security

- [x] Agree on conceptual entities and relationships; see `docs/DATABASE-DESIGN.md`.
- [x] Confirm season-scoped coach/team assignments.
- [x] Confirm one player-season registration per player/season.
- [x] Separate stable player identity from season-specific registration/team/division/age/number.
- [x] Define season-specific Little League age calculation using the Aug. 31 rule; verify official source before production.
- [x] Confirm Sports Connect identity/matching rules.
- [x] Implement protected import staging, admin review, explicit match decisions, and commit workflow (see Section 6).
- [x] Add age-based evaluation session/event and evaluator-roster schema migrations (local migration history reported; verify actual state).
- [x] Add historical coach evaluation schema and source/match metadata (local).
- [x] Add scoped coach historical-report RPCs (local).
- [x] Seed active divisions and attach them to open/new seasons (local).
- [ ] Verify the complete migration chain on a clean/disposable local database and reconcile migration history with checked-in files.
- [ ] Complete database-level RLS and authorization tests for all roles and data paths.
- [ ] Implement and test secure aggregate outputs for assigned-team and division views; no individual rating access for coaches.
- [ ] Verify season close/reopen permissions and audit behavior.
- [ ] Verify database backup/restore and retention procedures.

## 4. Evaluations, attendance, and permissions

- [x] Implement age-based evaluation session/event schema groundwork.
- [x] Implement evaluator roster/assignment schema groundwork.
- [ ] Verify the complete age-based session workflow in the UI with multiple ages, primary/makeup events, and evaluator assignments.
- [ ] Implement and test coach and independent-evaluator submission flows.
- [ ] Support coaches assigned to multiple teams in a season.
- [ ] Require five core ratings for submitted evaluations.
- [ ] Implement pitching/catching availability consistently with the current direction: available across age groups, possibly unscored, not gated by eventual division. Reconcile any older division-based code/configuration.
- [ ] Implement experience/interest Yes/No/Unknown questions.
- [ ] Implement `Not Evaluated` and average/count calculations throughout all relevant views.
- [ ] Keep coach and independent-evaluator averages separate.
- [ ] Implement and test coach-facing aggregate views without team-versus-division comparison or juxtaposition.
- [ ] Hide independent evaluator identities from coaches.
- [ ] Restrict individual submissions to administrators and appropriate authors.
- [ ] Implement private coach notes and separately controlled shared notes.
- [ ] Implement draft/submitted/locked states, author/timestamp, and audit trail.
- [ ] Implement per-player attendance for each primary/makeup event, independently of ratings.
- [ ] Implement admin-approved exemptions with explicit scope, reason, approver, and timestamp.
- [ ] Test permissions with separate admin, coach, and evaluator accounts, including coaches assigned to multiple teams.

## 5. Historical player evaluations and reporting

- [x] Confirm historical player ratings are prior-season context, separate from current spring evaluator submissions.
- [x] Extend existing `historical_evaluations` and `historical_ratings` rather than duplicating them.
- [x] Add source season/coach/import metadata, match provenance, category mapping, protected staging, RLS, and idempotency constraints.
- [x] Apply historical schema migration to local Supabase and verify structure, RLS enabled, constraints, indexes, and administrator policies.
- [x] Add static schema regression checks; user reported all 10 focused checks passed.
- [x] Add administrator player reports with a separate historical coach evaluation section.
- [x] Add administrator CSV export with distinct current, current-group-summary, and historical-coach record types.
- [x] Add scoped coach historical-report roster/report RPCs; historical tables remain direct-RLS admin-only.
- [x] Add coach-facing roster and historical-only player report pages.
- [x] Insert exactly three explicit local test-only historical crosswalks (3 evaluations, 15 ratings); source metadata and source names retained.
- [x] Verify all three test historical records appear in administrator reports and remain excluded from current averages/completion.
- [x] Runtime-check assigned Coach A can see Drew's historical report.
- [x] Runtime-check unassigned Coach B receives 404 for the same report URL.
- [ ] Test a coach assigned to a different team cannot access Drew's report by direct URL.
- [ ] Verify the coach roster does not reveal players outside assigned teams.
- [ ] Verify non-admin direct reads from `historical_evaluations` and `historical_ratings` are denied.
- [ ] Re-test administrator report and CSV export after coach-RPC changes.
- [ ] Implement admin historical import preview, candidate review, and commit workflow for the remaining historical source rows.
- [ ] Obtain/confirm reliable source identity mapping before linking any additional historical rows.
- [ ] Label source coverage accurately (the historical source reviewed so far covers AA team spreadsheets, not a complete league history).

**Test data boundary:** Only the three explicitly approved local test links are imported. Do not import or match other historical rows without explicit review and approval.

## 6. Sports Connect import implementation and safety validation

### Implemented workflow

- [x] Stage Sports Connect CSV rows in a protected import batch without directly modifying player or registration records.
- [x] Preview staged rows and identify validation flags, including out-of-scope registrations.
- [x] Review candidate player matches without silently merging.
- [x] Save administrator review decisions and reasons.
- [x] Require administrator authorization and approved review state before committing an import row.
- [x] Support approved new-player and existing-player match commits.
- [x] Create season registration records during approved commits without assigning a final division, team, or evaluation number automatically.
- [x] Record commit outcomes and audit information.
- [x] Prevent committed rows from being edited through the review UI.
- [x] Add duplicate Player ID warning resolution with an audit reason and a commit-time safeguard; resolution does not bypass uniqueness constraints.
- [x] Protect against duplicate player-season registrations and preserve payment status on commit.
- [x] Add static checks for import preview, review, and commit workflow.
- [x] Add consolidated `npm run test:all` runner.

### Remaining import-safety validation

- [ ] Test unauthorized commits and rejected review states against local database using separate authenticated accounts.
- [ ] Verify repeat commits are idempotent, including retries after an uncertain client response.
- [ ] Test duplicate registration numbers and external IDs across rows, batches, seasons, and existing records.
- [ ] Test approved-match behavior preserves existing player master data.
- [ ] Test transaction rollback and partial-failure behavior.
- [ ] Verify audit records and database state after successful and failed operations.
- [ ] Verify relevant RLS and database-function protections using authenticated non-admin and admin accounts.
- [ ] Verify invalid/incomplete rows cannot be committed.
- [ ] Test ignored-row terminal/reopen behavior against the agreed product rule.
- [ ] Verify the complete workflow using fresh synthetic data and document results.

**Scope boundary:** Import stages and links registration data. It does not process payments, determine final divisions, conduct the official draft, or replace Sports Connect as the official roster system.

### Retained synthetic import data

- Local batch #8 contains 45 synthetic Spring 2027 rows. Exactly three were explicitly approved and committed: Morgan Pebble06, Avery Sandbox08, Drew Willow10.
- The other 42 rows remain `needs_review` and uncommitted. Preserve them; do not commit without explicit approval.
- Other historical synthetic batches/rows may also exist. Inspect before cleanup.
- Earlier remote test artifacts are not authorization for new remote writes.

## 7. Administrator evaluation review, player reports, and exports

### Administrator evaluation review

- [x] Add a read-only administrator review page grouped by season and Little League age.
- [x] Show eligible registrations, players with evaluation records, players without evaluation records, and evaluation status counts.
- [x] Show progress by evaluator and evaluator type.
- [x] Show per-player evaluation records and core-category totals/averages without treating missing ratings as zero.
- [x] Include Pending registrations in the eligible evaluation pool.
- [x] Normalize payment-status casing and whitespace in evaluator eligibility and administrator review.
- [x] Add age-group core-skill averages split by coach versus independent evaluator, with contributing counts.
- [x] Add static UI regression checks for the dashboard and summary.
- [ ] Run focused tests and the full current suite after the latest changes.
- [ ] Verify dashboard results against local synthetic data, including empty categories and mixed evaluator types.
- [ ] Verify non-admin users are redirected/denied.

### Player reports and CSV export

- [x] Add administrator-only season report index and per-registration report links.
- [x] Add individual player reports with current evaluations and separate historical player ratings.
- [x] Display registration payment status on reports.
- [x] Add administrator-checked CSV export with distinct `CURRENT`, `CURRENT_GROUP_SUMMARY`, and `HISTORICAL_PLAYER` row types.
- [x] Preserve historical source season, coach, division, team, and coverage metadata where available.
- [x] Add focused static regression test.
- [ ] Re-run focused tests and full `npm run test:all`.
- [ ] Test no-history, no-ratings, and multiple-evaluation cases against local data.
- [ ] Verify non-admin users cannot view reports or download CSV.

**Validation note:** User previously reported the age-group summary and report/export UI looked correct and focused tests passed. Do not infer that the current full suite or all role-based access tests pass until freshly run.

## 8. User experience and launch

- [ ] Build/finish role-specific dashboards and mobile-friendly evaluation screens.
- [ ] Ensure ratings UI is touch-friendly; avoid dropdowns for rating selection.
- [ ] Support age-group evaluation events with multiple evaluators, per-player attendance, and separate performance records.
- [ ] Test phone, tablet, and desktop layouts.
- [ ] Remove/disable public sign-up and implement admin-managed invitation lifecycle.
- [ ] Implement user disable/removal process and audit as required.
- [ ] Test backup/restore and retention procedures.
- [ ] Confirm league policy for children's names, birthdates, and retention; minimize DOB retention where feasible.
- [ ] Verify hosting, pricing, environment variables, and production security.
- [ ] Run end-to-end pilot with synthetic data and representative users.
- [ ] Obtain board approval before loading live data or launching.

## 9. Latest verified checkpoints — 2026-11-07

### Historical coach report runtime test

- Assigned `coach-a-test@example.com` to test team `TEST - AAA Coach Report` in Spring 2027 AAA with Drew Willow10 (player-season 8).
- User confirmed Coach A can see Drew's historical report.
- User confirmed unassigned Coach B (`coach-b-test@example.com`) receives 404 for the same report link.
- This is an initial positive authorization test; different-team access and direct table RLS checks remain open.
- The AAA team assignment is a test-only simulated post-draft assignment. The original import did not assign a final division.

### Division initialization

- Local migration `20261107040000_seed_active_divisions_and_link_seasons.sql` reported applied.
- Five active divisions are seeded and linked to existing open seasons.
- An AFTER INSERT trigger attaches the five divisions to newly created open seasons.
- Spring 2027 has five links; trigger test succeeded in a transaction that was rolled back.
- No ratings/categories or player/import rows were changed by this migration.

### Historical report test data

- Three historical evaluations and 15 ratings inserted locally for the explicitly approved test crosswalks.
- Administrator reports display the three historical records separately from current ratings.
- No other historical source rows imported.

### Current local-only boundary

- No hosted migrations or hosted data changes were made/authorized in these checkpoints.
- Confirm local and remote migration lists separately before any future migration work.

## 10. Immediate next milestone

Complete the coach authorization matrix locally, then run fresh focused and consolidated validation:

1. Assign Coach B to a separate test team/player and verify Coach B still cannot access Drew's report by direct URL.
2. Verify Coach B's roster contains only players assigned to Coach B's team(s).
3. Verify non-admin direct reads of historical tables are denied.
4. Verify admin reports and CSV export still work.
5. Run focused report/coach tests, then `npm run test:all`, lint, TypeScript, and production build.
6. Update this roadmap, `docs/DECISIONS.md`, `docs/FAQ.md`, and `CHATGPT_HANDOFF.md` with actual results.

**Safety boundary:** Continue local-only validation. Do not apply migrations to hosted Supabase or modify hosted data without explicit approval.


## Global primary schedule and safe session reopening — implementation added, validation pending
- [x] Add per-season global primary schedule form with preview and example defaults.
- [x] Add per-season global makeup schedule form with preview; add to Setup sessions that already have a primary event without overwriting existing events.
- [x] Apply only to Setup sessions without an existing primary event; preserve existing schedules and exclude Open/Locked sessions.
- [x] Add guarded admin Return to Setup action for Open sessions with no evaluation records; preserve existing events and assignments.
- [x] Update FAQ, decisions, handoff, and focused regression test.
- [x] Run focused session-administration test and full source-level test suite (13 groups passed).
- [ ] Run lint, TypeScript, and production build after dependencies install successfully; npm ci timed out in this environment.
- [ ] Manually verify global preview/apply and return-to-setup behavior against local Supabase only.
