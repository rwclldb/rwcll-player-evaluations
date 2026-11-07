# RWCLL Player Evaluations — Roadmap

A task is checked only after it is implemented **and tested**. A confirmed requirement or design decision is not the same as an implemented feature.

## 1. Requirements agreed
- [x] One league; approximately 30–50 users.
- [x] Responsive web app/PWA direction for phones, tablets, and desktop.
- [x] No parent or player accounts.
- [x] Coach and independent-evaluator ratings/averages remain separate.
- [x] Coaches see group averages only; independent evaluator identities hidden from coaches.
- [x] Administrators can inspect individual submissions.
- [x] Not Evaluated is not zero and is excluded from averages.
- [x] Five required core skills; optional pitching/catching for AAA and above.
- [x] Historical ratings are read-only and excluded from current averages.
- [x] Admin-managed invitations; no public registration in intended product.
- [x] Preserve prior seasons.
- [x] Seasons are closed by default after completion; an administrator may explicitly reopen a season for corrections, with the action recorded in an audit trail.
- [x] When creating a new season, carry forward only the editable division setup; do not copy teams/team names, coach assignments, player evaluations, or historical results. Team names are assigned after evaluations.
- [x] Generate a permanent internal player ID; use name/birthdate only to suggest import matches, with administrator confirmation and no silent merges.
- [x] Coaches may be assigned to multiple teams in a season.
- [x] Coaches can view authorized group averages, but must not see a comparison of their assigned-team averages against division-wide averages.
- [x] Confirm age-based evaluation groups that can include players later drafted to different divisions; this supersedes the prior division-based session assumption.
- [x] Each player has one roster assignment per season (no multiple team rosters in the same season).
- [x] Store a season-specific `evaluation_number` for identifying the player by the number they wear during evaluations; it does not carry over.

## 2. Development foundation
- [x] Create private GitHub repository and clone locally.
- [x] Scaffold Next.js app with Supabase starter.
- [x] Configure `.env.local`.
- [x] Verify `.env.local` is Git-ignored.
- [x] Load app at `http://localhost:3000`.
- [x] Commit scaffold (`34f85d2`) and push to `main`.
- [x] Create Supabase test user.
- [x] Sign in and display protected-page user claims.
- [x] Add the project documentation to the Git repository and commit/push updates as design decisions are confirmed.
- [x] Establish version-controlled SQL migration workflow.
- [x] Verify lint and production build.

## 3. Database foundation
- [x] Agree on conceptual entities and relationships; see `docs/DATABASE-DESIGN.md` (proposed only).
- [x] Confirm season-scoped many-to-many coach/team assignments.
- [x] Confirm coach-facing visibility rule: do not show a comparison between assigned-team averages and division-wide averages.
- [x] Confirm age-based evaluation groups and primary/makeup events; schema implementation remains pending.
- [x] Confirm one player roster record per season.
- [x] Confirm season-specific evaluation number displayed to evaluators; does not carry over between seasons.
- [x] Review and approve detailed database design before migration work.
- [x] Confirm season lifecycle: closed by default; explicit administrator-only reopen for corrections, with audit logging.
- [x] Confirm new-season setup: copy only editable division configuration; create coaches/assignments and teams/team names fresh later, after evaluations; never copy evaluations or historical results.
- [x] Design seasons, divisions, teams, players, user profiles, and roles.
- [x] Separate stable player identity from season-specific registration/team/division/league age and `evaluation_number`.
- [x] Define season-specific Little League age calculation (official Aug. 31 rule).
- [x] Confirm Sports Connect IDs are useful external registration identifiers but not universal child IDs: the same child can receive a different ID when a different parent registers them in a later season.
- [x] Agree on import identity rules: permanent internal `player_id`; season-scoped Sports Connect ID as a matching clue only; name/birthdate as candidate suggestions; administrator-confirmed linking; and pending review for uncertain rows.
- [x] Design and implement import preview, duplicate detection, audit of match decisions, and admin-confirmed matching; no silent name/DOB matching.
- [ ] Implement and test the complete database migration chain and all RLS policies.
- [ ] Implement and test secure aggregate outputs for assigned-team and division views; no individual rating access for coaches.

## 4. Evaluations and permissions
- [ ] Replace division-based evaluation session model with age-based groups, dated primary/makeup events, and evaluator assignments.
- [ ] Implement coach and independent-evaluator submission flows.
- [ ] Support coaches assigned to multiple teams in a season.
- [ ] Require five core ratings for submitted evaluations.
- [ ] Implement optional pitching/catching ratings for AAA, Majors, Juniors, Seniors.
- [ ] Implement experience/interest Yes/No/Unknown questions.
- [ ] Implement Not Evaluated and average/count calculations.
- [ ] Keep evaluator-group averages separate.
- [ ] Implement and test coach-facing aggregate views that do not compare or juxtapose assigned-team averages against division-wide averages.
- [ ] Hide independent evaluator identities from coaches.
- [ ] Restrict individual submissions to administrators and appropriate authors.
- [ ] Implement private coach notes and separately controlled shared notes.
- [ ] Implement draft/submitted/locked states, author/timestamp, and audit trail.
- [ ] Test permissions with separate role accounts, including coaches assigned to multiple teams.

## 5. Imports and history
- [ ] Build CSV/Excel import preview, mapping, duplicate detection, confirmation.
- [ ] Import current Sports Connect data after matching rules are approved.
- [ ] Obtain unredacted historical names or a reliable mapping file.
- [ ] Match historical AA ratings with administrator confirmation.
- [ ] Label historical coverage as partial (one team), keep read-only.
- [ ] Verify historical data is excluded from current averages.


## 6. Sports Connect import implementation and validation

- [x] Stage Sports Connect CSV rows in a protected import batch without directly modifying player or registration records.
- [x] Preview staged rows and identify validation flags, including out-of-scope registrations.
- [x] Review candidate player matches without silently merging records.
- [x] Save administrator review decisions and reasons.
- [x] Require administrator authorization and approved review state before committing an import row.
- [x] Support approved new-player and existing-player match commits.
- [x] Create season registration records during approved commits without assigning a division, team, or evaluation number automatically.
- [x] Record commit outcomes and audit information.
- [x] Prevent committed rows from being edited through the review UI.
- [x] Add static checks for the import preview, review, and commit workflow.
- [x] Add a consolidated `npm run test:all` runner that records output and PASS/FAIL results.
- [x] Validate the current suite: 10 of 10 checks passed, including import tests, lint, TypeScript, and production build.

### Remaining import-safety validation

- [ ] Test unauthorized commits and rejected review states against the local database.
- [ ] Verify repeat commits are idempotent, including retries after an uncertain client response.
- [ ] Test duplicate registration numbers and external IDs across rows, batches, seasons, and existing records.
- [ ] Test transaction rollback and partial-failure behavior.
- [ ] Verify audit records and database state after both successful and failed operations.
- [ ] Test relevant RLS and database-function protections using authenticated non-admin and admin accounts.
- [ ] Verify the complete workflow using fresh synthetic data and document the results.

**Scope boundary:** This import workflow stages and links registration data; it does not process payments, determine final divisions, perform the official draft, or replace Sports Connect as the official roster system.

## 7. User experience and launch
- [ ] Build role-specific dashboards and evaluation screens.
- [ ] Support age-group evaluation events with multiple evaluators, per-player attendance, and separate performance records.
- [ ] Test phone, tablet, and desktop layouts.
- [ ] Test backup/restore and retention procedures.
- [ ] Confirm league policy for children’s names, birthdates, and retention.
- [ ] Verify hosting, pricing, environment variables, and production security.
- [ ] Run end-to-end pilot with test data and representative users.
- [ ] Obtain board approval before live data or launch.


## Current checkpoint — 2026-11-04

**Verified locally**
- The application passes `npm run lint`, `npx tsc --noEmit`, and `npm run build`.
- Sports Connect import staging, candidate review, administrator decisions, and commit actions have been implemented.
- Synthetic tests have exercised approved new-player and existing-player commits.
- The consolidated `npm run test:all` runner completed successfully: 10 checks passed, 0 failed.
- The runner writes a detailed report to `test-results/`.
- The working tree contains uncommitted import-workflow changes and test-runner files; review them before committing.

**Not yet established by the current test suite**
- Complete database-level authorization and RLS coverage.
- All duplicate-identifier and cross-batch conflict scenarios.
- Transaction rollback and failure recovery under real database errors.
- Full role-based access and reporting security across admin, coach, and evaluator accounts.
- Production readiness or approval to deploy migrations to hosted Supabase.

**Next milestone:** complete end-to-end import-safety testing against local Supabase using synthetic data. Cover rejected operations, repeat commits, duplicate identifiers, rollback, audit outcomes, and authorization boundaries.

**Safety boundary:** continue local-only validation. Do not apply migrations to hosted Supabase or modify hosted data without explicit approval.



## 2. Confirmed workflow requirements (2026-11-02)

These are agreed requirements, not implemented features. Keep implementation checkboxes unchecked until the feature is built and tested.

- [ ] Evaluation numbers can be generated from an administrator-chosen starting number, manually overridden, and imported from CSV; a player may be evaluated without a number.
- [ ] Evaluators can find and evaluate any player in their assigned division; coaches can evaluate players in any division.
- [ ] Record absences and provide an administrator absence report. Players who miss required evaluations are flagged for administrator handling and are not eligible to play unless the issue is resolved.
- [ ] Evaluators can save drafts, resume later, and edit submitted evaluations until session lock.
- [ ] Administrators determine completion; flag missing player ratings and missing evaluator submissions without requiring all submissions to be present.
- [ ] After lock, administrator corrections to submitted evaluations are permitted and audited.
- [ ] Optional team-balancing tool generates proposed rosters only; it is not the official team-management system. Export proposed rosters to CSV and provide a print-friendly view.
- [ ] For generated rosters, administrators set target team sizes; team sizes may differ by one player when the count does not divide evenly. Coaches are assigned first.
- [ ] An administrator can flag a coach's child for automatic placement on that coach's team. All coaches may see which players are designated as a coach's child; the designation is not hidden from coaches.
- [ ] Team suggestions may use available ratings, age, experience, and pitching/catching information. Missing ratings remain missing; use available information without inventing scores.
- [ ] Players added after team formation may have no evaluations. Preserve existing and historical ratings; do not silently alter or overwrite them.

## 4. Newly confirmed workflow requirements (2026-11-03)
- [x] Spring 2027 season is 2027-01-01 through 2027-06-30; preserve the existing record.
- [x] Active baseball divisions: AA, AAA, Majors, Juniors, Seniors.
- [x] Import all registrations including Pending; pending means payment is outstanding, not evaluation-ineligible. The app does not process payments.
- [x] Show registration status on player lists, player details, and reports; never show it on evaluation screens.
- [x] Import out-of-scope programs but flag for admin review and exclude from active evaluation pool by default.
- [x] Use supplied registration/evaluation number if present; otherwise leave blank until assigned.
- [x] Group evaluations by official Little League age, not final division; one age group may span multiple eventual divisions.
- [x] Track per-player attendance at each primary/makeup event separately from ratings; injured present players may have no or partial ratings.
- [x] Admin exemptions can resolve attendance and/or evaluation requirements only with explicit scope, reason, approver, and timestamp.
- [x] App records post-draft team/division assignments; it does not perform the official draft or replace official rostering.
- [x] Draft order is Seniors → Juniors → Majors → AAA → AA; mandatory top-age placement rules and admin-approved exceptions must be explicit and based on verified league rules.
- [x] Optional AA random team suggestions are advisory and require admin review.

## 5. Next implementation sequence (not yet implemented)
1. [ ] Reconcile the existing schema with the proposed age-based workflow; do not apply a migration yet.
2. [ ] Finalize and review `docs/IMPORT-WORKFLOW-DESIGN.md` and `docs/PROPOSED-DATA-MODEL-REVIEW.md`.
3. [ ] Implement CSV preview/validation, duplicate conflict handling, explicit identity matching, and admin-confirmed import transaction.
4. [ ] Add season registration status and out-of-scope review flags.
5. [ ] Add age-based evaluation groups, primary/makeup events, per-player attendance, performance records, and audited exemptions.
6. [ ] Add post-draft division/team assignment and configurable age-placement rules.
7. [ ] Validate the migration chain on a disposable local Supabase instance; reconcile RLS and regression tests.
8. [ ] Run `npm run lint` and `npm run build`; record results.
9. [ ] Test with separate admin, coach, and evaluator accounts and synthetic import edge cases.
10. [ ] Only after local review and explicit approval, plan hosted migration deployment.


### Phase 5.5 — Sports Connect commit safeguards

**Verified:** the commit RPC and duplicate external-player-ID constraint were tested against the configured remote Supabase project.

- [x] Reject a duplicate external player ID within the same season using the database unique constraint.
- [x] Verify a rejected commit creates no player or player-season registration.
- [x] Verify the original registration remains intact.
- [x] Verify the failed row remains uncommitted and no commit audit event is written.
- [x] Run the consolidated automated suite: 10 passed, 0 failed.
- [X] Test duplicate external registration numbers.
- [ ] Test duplicate identifiers across batches and seasons.
- [ ] Test approved-match behavior for preservation of existing player master data.
- [ ] Continue broader authorization, RLS, audit, and failure-recovery testing.
- [ ] Verify non-administrator authorization and rejected commit paths.
- [ ] Verify invalid or incomplete rows cannot be committed.
- [ ] Verify idempotent retries do not create duplicate registrations or audit events.
- [ ] Verify transaction rollback and partial-failure behavior.
- [ ] Verify audit consistency and relevant RLS protections.
- [ ] Re-run the full default test suite after code changes.

**Retained remote test artifact:** batch 2, row 9. This is a disposable approved-but-uncommitted staging record, not a committed registration. Review it before deciding whether to clean it up.

**Migration status:** all eight migrations are recorded as applied in both local and remote migration lists. No hosted migration or schema change is authorized by this status update.

**Safety boundary:** Keep remote-write regression tests separate from npm run test:all. Preserve the remote URL guard, explicit ALLOW_REMOTE_IMPORT_TESTS=YES opt-in, and administrator authentication. Do not apply additional migrations or make unrelated schema changes as part of this testing work.


**Status note:** the project ZIP contains five migrations, but their presence is not proof that this newly proposed workflow exists or is fully tested. Do not mark the new workflow complete until implementation and tests pass.



## Sports Connect payment-status preservation

- [x] Identify that the commit RPC omitted `registration_payment_status` from its registration insert.
- [x] Add migration `20261107010000_preserve_payment_status_on_import_commit.sql` to preserve staged statuses on future commits and backfill linked committed registrations currently marked `UNKNOWN`.
- [x] Add static regression checks for the insert mapping and narrowly scoped backfill.
- [ ] Apply the migration to local Supabase only, after checking pending migrations; run `npm run test:all` and verify the registration query.
- [ ] Confirm ages 9 and 10 appear in the dashboard based on corrected statuses and eligible rules.

No hosted database changes have been made. Do not deploy this migration remotely without explicit approval.

## Phase 6 — Administrator evaluation review (in progress)

- [x] Add a read-only administrator review page grouped by season and Little League age.
- [x] Show eligible registrations, players with at least one evaluation record, players with no evaluation record, and evaluation status counts.
- [x] Show progress by evaluator and evaluator type.
- [x] Show per-player evaluation records and core-category totals/averages without treating missing ratings as zero.
- [x] Keep pending registrations in the eligible evaluation pool; continue excluding unpaid/unknown statuses from the evaluator workspace.
- [x] Add a static UI regression check for the administrator review page and pending-registration eligibility.
- [x] Normalize payment-status casing and whitespace consistently in evaluator eligibility and administrator review counts.
- [ ] Run `npm run test:all`, lint, TypeScript, and production build against the feature branch.
- [ ] Verify the dashboard with local Supabase as admin and confirm non-admins are redirected.
- [ ] Review completion counts against synthetic registrations and saved evaluations.

**Current branch:** `feature/admin-evaluation-review`. The dashboard is implemented in `app/protected/evaluation-review/page.tsx` and linked from the administrator workspace. This is a development checkpoint; implementation checkboxes above are not a substitute for local validation.


## Historical coach evaluation import — design and schema groundwork

- [x] Confirm historical coach evaluations are prior-season context, distinct from current spring evaluator submissions.
- [x] Verify that `historical_evaluations` and `historical_ratings` already exist in the baseline schema; extend rather than duplicate them.
- [x] Decide matching precedence: permanent RWCLL Player ID first; name and available birthdate/season/team/division as candidate clues; manual admin confirmation required.
- [x] Decide unresolved historical rows must not create player records and must remain out of final reports until matched.
- [x] Draft `20261107020000_historical_coach_evaluation_schema.sql` with source metadata, match provenance, import staging, RLS, and idempotency constraints.
- [ ] Apply migration to local Supabase only and verify migration history/schema.
- [ ] Add static regression tests for migration safeguards.
- [ ] Test local RLS, unique/idempotency constraints, and existing historical data preservation.
- [ ] Implement admin import preview, candidate review, and commit workflow.
- [ ] Implement narrowly scoped report access for authorized coaches and administrators.
- [ ] Include clearly labeled historical ratings in final reports/export, separate from current group ratings.

**Safety:** Migration is only drafted on `feature/admin-evaluation-review`. No hosted database change has been made or authorized.
