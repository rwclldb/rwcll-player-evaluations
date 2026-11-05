# ChatGPT Project Handoff — RWCLL Player Evaluations

**Last reviewed:** 2026-11-03  
**Purpose:** Restart/continue work in a new ChatGPT conversation without relying on prior chat history.

## Project at a glance

- **Project:** RWCLL Player Evaluations
- **Stack:** Next.js App Router, React 19, TypeScript, Supabase (PostgreSQL + Auth), Tailwind CSS; npm.
- **Developer environment documented in the repo:** Windows, PowerShell, VS Code.
- **Repository/local folder documented in `docs/FAQ.md`:** private GitHub repo `rwcll-player-evaluations`; `D:\sandbox\GitHubRepos\rwcll-player-evaluations`.
- **Purpose:** Internal league player evaluation workflow for approximately 30–50 users; no parent/player accounts.
- **Source of truth:** The checked-in repository files, especially `ROADMAP.md`, `docs/DECISIONS.md`, `docs/DATABASE-DESIGN.md`, and SQL migrations. Update those documents when durable decisions or implementation status changes.

## Current observed state — 2026-11-04

This status reflects the developer's reported local environment and test results. It is not a live inspection of GitHub or hosted Supabase.

### Application and development environment

- Next.js 16.4.4 with React, TypeScript, and Supabase.
- Development is performed on Windows using PowerShell.
- Local project directory: `D:\sandbox\GitHubRepos\rwcll-player-evaluations`.
- `.env.local` is configured for local Supabase.
- Local Supabase Studio: `http://127.0.0.1:54323`.
- Local Supabase API: `http://127.0.0.1:54321`.
- Lint, standalone TypeScript checking, and production build have passed.
- `npm run test:all` runs the import-related test scripts, lint, TypeScript, and production build. The latest reported run passed all 10 checks.
- Detailed test output is written to `test-results/`.

### Database and import workflow

- Local migrations include the initial schema and subsequent security/workflow migrations through the Phase 5.5 Sports Connect commit workflow.
- Phase 5.0 stages Sports Connect import rows without directly modifying player or season-registration records.
- Later phases add row review decisions and an administrator-authorized commit operation.
- The commit workflow supports approved new-player creation and approved matching to an existing player.
- Committed rows are displayed as committed and cannot be changed through the review UI.
- Successful synthetic import tests have been reported for both new-player and existing-player matches.
- The local test data is synthetic. No real player data is intended to be present.
- The latest reported validation covers 10 checks, including static import tests, lint, TypeScript, and production build.

### Important validation limits

- Static checks do not replace runtime database-security tests.
- The full set of rejected-operation, duplicate-identifier, idempotent-retry, rollback, and failure-recovery scenarios still needs verification.
- Do not infer that all RLS policies, coach-safe reporting, or role-based access requirements are complete from the current test results.
- Hosted Supabase migration state has not been freshly verified in this checkpoint. Do not assume local migration status proves hosted status.


### Documentation present

- `ROADMAP.md`
- `docs/DATABASE-DESIGN.md`
- `docs/DECISIONS.md`
- `docs/FAQ.md`
- `docs/SECURE-WORKFLOW-TEST-PLAN.md`

**Documentation drift to resolve:** Several roadmap and decision-log entries still describe the schema/migration work as proposed or not implemented, even though five migration files now exist. Do not automatically mark them complete: first validate the migrations and update status accurately. The secure-workflow test plan refers to replacement migration and regression-check filenames that are not present in the archive, so reconcile that plan with the actual five migration files before running it.

## Confirmed product and data decisions

- One league, roughly 30–50 users; no parent/player accounts.
- Responsive web app/PWA direction for phones, tablets, and desktop.
- Individual accounts; invitations administered by league admins; public sign-up should be disabled/removed for the intended product.
- Coaches may be assigned to multiple teams in a season.
- Superseded 2026-11-03: age-based evaluation groups with separate primary/makeup events; groups may span eventual divisions.
- Each player has at most one roster assignment per season.
- Each player-season has a season-specific `evaluation_number`; it can be generated from an admin-selected starting number, manually overridden, or imported. Evaluation without a number is allowed. It does not carry forward between seasons.
- Five required core skills; pitching/catching are optional for AAA and above.
- Coach and independent-evaluator ratings/averages remain separate. Coaches see group aggregates only; independent evaluator identities are hidden from coaches. Admins can inspect individual submissions.
- Coaches must not see a comparison/juxtaposition of their assigned-team averages against division-wide averages.
- `Not Evaluated` is not zero and is excluded from averages; blank optional ratings are not zero.
- Historical ratings are read-only and excluded from current averages.
- Stable internal player ID is generated independently of name/birthdate. Sports Connect IDs are season-specific external identifiers and matching clues, not universal permanent player IDs. Same ID is useful evidence, not proof; changed ID is not proof of a different child. Name/birthdate may suggest candidate matches, but all links/merges require administrator confirmation; uncertain rows stay pending review.
- Seasons are closed by default after completion. Admin reopening for correction must be explicit and audited; session locking is a separate workflow state.
- Creating a new season carries forward only editable division setup. Do not copy teams/team names, coach assignments, player evaluations, or historical results. Team names are assigned after evaluations.
- Evaluators can save drafts, resume, and edit their own submitted evaluations until session lock. Admin determines completion; missing ratings/submissions are flagged but do not automatically block completion. Admin corrections after lock require a reason and audit trail.
- Evaluators can search/evaluate any player in their assigned division; coaches may evaluate players in any division.
- Absences are recorded and reported to admins. Players missing required evaluations are flagged for admin handling and are not eligible to play unless resolved.

See `docs/DECISIONS.md` and `ROADMAP.md` for the fuller record. If a conflict appears, stop and reconcile it rather than silently choosing one version.


## Immediate next steps

1. Finish updating `ROADMAP.md`, `CHATGPT_HANDOFF.md`, and relevant import documentation to reflect the current implementation.
2. Review the current working-tree changes and generated test reports; preserve all valid work before committing.
3. Run the consolidated `npm run test:all` validation after further changes.
4. Test unauthorized and rejected commits against local Supabase.
5. Test repeat commits and retries to confirm that they do not create duplicate player or registration records.
6. Test duplicate external IDs and registration numbers across staged rows, batches, seasons, and existing records.
7. Test transaction rollback, audit behavior, and recovery from database failures.
8. Verify relevant RLS and authorization behavior using separate administrator and non-administrator accounts.
9. Continue the broader role-based application, evaluation, and secure reporting work according to the roadmap.
10. Make no hosted database changes unless the user explicitly approves them.


## Sports Connect import — verified Phase 5.5 status (2026-11-05 UTC)

- All eight migrations are recorded as applied in both local and remote Supabase migration lists, through `20261104230000_phase_5_5_sports_connect_commit.sql`.
- The remote duplicate-external-player-ID regression test passed.
- The test used existing `TEST-1003` in season 1 as the duplicate identifier and a separately generated registration number.
- The database rejected the commit with SQLSTATE `23505`.
- Verified after rejection: no player or player-season registration was created, the existing registration remained intact, the staged row remained `approved_new` with no committed registration ID, and no commit audit event was written for the failed row.
- The full automated suite passed: 10 passed, 0 failed. The consolidated runner includes automated tests, lint, TypeScript checking, and production build.
- The duplicate-ID regression test is a manual test and is excluded from `test:all`. It requires administrator credentials and an explicit remote-test opt-in.
- Remote test artifact intentionally retained: import batch ID 2, staged row ID 9. It is approved but uncommitted. Do not treat it as a real registration; inspect it before any cleanup.
- The fake import batch 1 also contains intentionally duplicated `TEST-DUP` staged rows 5 and 6. Preserve these unless cleanup is explicitly planned.

### Phase 5.5 — Import Commit Regression Test Status

**Commit workflow:** The Phase 5.5 Sports Connect commit migration is `20261104230000_phase_5_5_sports_connect_commit.sql`. The import workflow uses protected staging, explicit administrative review, and a database commit RPC. Do not bypass staging or review by directly writing imported data to player or player-season tables.

**Automated tests:** `npm run test:all` runs the project's consolidated automated checks, including lint, TypeScript, production build, and registered test scripts. Keep remote database tests requiring credentials or remote writes outside the default suite.

**Duplicate-identifier regression tests:**
- `manual:import-commit-duplicate-id`: tests database rejection of a duplicate external player ID.
- `manual:import-commit-duplicate-registration-id`: tests database rejection of a duplicate external registration number.
- `manual:import-commit-duplicate-identifiers`: runs both tests sequentially.

**Verified duplicate-registration test:** Passed all 11 checks against the configured remote Supabase project. The database rejected the duplicate `REG-7003` registration with SQLSTATE `23505`. No player, player-season registration, or commit-audit event was created. The original registration remained intact, and the staged row remained `approved_new` and uncommitted.

**Retained test artifact:** Batch `3`, staged row `10`, intentionally remains for inspection. It is approved but uncommitted. Do not treat this test artifact as a real player registration.

**Remaining Phase 5.5 verification:** Continue testing authorization boundaries, rejected or invalid commits, idempotent retries, transaction rollback/partial failure, audit consistency, and row-level security. A passing duplicate-identifier test does not establish that all import-commit failure paths are safe.

**Remote test safety:** Remote regression tests require explicit opt-in via `ALLOW_REMOTE_IMPORT_TESTS=YES`, the expected project URL guard, and administrator authentication. Do not remove these safeguards or include remote-write tests in `test:all` by default.

### Idempotent Import Commit Retry — Verified

- Remote retry regression test passed all 15 checks.
- Verified the expected hosted Supabase project and administrator authorization.
- Test batch ID: 5.
- Staged row ID: 11.
- Player-season registration ID: 5.
- First commit created exactly one player, one registration, and one
  `sports_connect_import_row_committed` audit event.
- Retrying the same committed row returned the original registration ID
  without creating additional players, registrations, or commit audit events.
- The staged row remained committed and referenced the original registration.
- Synthetic test records were intentionally retained for inspection.
- Full local test suite: 10 passed, 0 failed.
- Remote write tests remain separate from the default `npm run test:all` suite.

## Safety and handling notes

- Never commit `.env`, `.env.local`, Supabase service-role keys, database passwords, JWT secrets, or other credentials.
- Supabase local runtime state under `supabase/.temp/` should not be shared or committed. The uploaded archive included this local runtime directory (including an environment file). It has been excluded from this handoff archive, and `.gitignore` now ignores `/supabase/.temp/`.
- If any real credential from the local runtime directory was committed to a remote repository or otherwise exposed, remove it from repository history as appropriate and rotate/revoke it in Supabase. Do not paste credentials into ChatGPT.
- The cleaned archive is a working copy for review; it does not push changes to GitHub or alter the user's local files.

## How to resume in a new ChatGPT chat

Upload the latest project ZIP (or connect the repository if an appropriate integration is available) and say: **“Continue the RWCLL Player Evaluations project. Read `CHATGPT_HANDOFF.md` first, then inspect the current roadmap, decision log, database design, and migrations. Confirm the current state before changing anything.”**

At the end of each substantial work session, update this file with the current verified state, changed files, test results, decisions, blockers, and the single best next step. Keep it concise and factual; distinguish confirmed requirements, implemented code, and tested behavior.


### Uncommitted work at the 2026-11-04 checkpoint

The developer reported the following working-tree changes:

- Modified import review page and review-decision form.
- Modified `package.json` and the import-review UI test.
- New `scripts/run-tests.cjs`.
- New `scripts/test-import-commit-action.cjs`.
- New `scripts/test-import-commit.cjs`.
- New `test-results/` output.

Review the complete working-tree diff and generated reports before committing. Do not discard these changes or assume they have been pushed to GitHub.


## Latest confirmed decisions and active redesign (2026-11-03)

The user confirmed Spring 2027 (2027-01-01 to 2027-06-30) already exists and must be preserved. Latest sample is `Enrollment_Details - 2027 Fake Data RWCLL(2).csv`; age chart is `2027 - little_league_age_chart.csv`.

Verified test CSV facts using the exact headers: 323 rows; 323 nonblank unique `Player Id` values; 286 `Completed`, 37 `Pending`; 323 blank `Registration Number` values; 323 birthdates parse as `M/D/YYYY`; division/program counts are AA 74, AAA 74, Majors 68, A 45, Tee Ball 29, Juniors 18, Seniors 14, Wiffle Ball 1. These are fake test data. Do not treat this validation as a real import or database write.

Confirmed workflow decisions:
- Active baseball divisions are AA, AAA, Majors, Juniors, Seniors. Import all rows, but flag A/Tee Ball/Wiffle Ball/other out-of-scope programs for admin review and keep them out of the active evaluation pool by default.
- Include both Completed and Pending registrations. Pending means payment has not been completed; the app does not handle payments. Display status on player lists/details/reports, never on evaluation screens, and do not exclude Pending players from evaluation eligibility.
- Use a supplied registration/evaluation number if present; otherwise leave null until assigned. No auto-numbering as part of import.
- Duplicate nonblank Sports Connect Player IDs within one import/season are blocking conflicts for admin review; never auto-merge. Existing-player matching is always admin-confirmed. Internal player ID remains permanent; external Sports Connect ID is season-scoped evidence only.
- Group evaluations by official Little League age, not final division. One age group may include players drafted to multiple divisions. Use the supplied 2027 chart/official Aug. 31 baseball age rule; verify source before production use.
- Draft order is Seniors → Juniors → Majors → AAA → AA. The app records post-draft division/team assignments; it does not conduct the official draft or replace official rostering. Top-age placement rules and exceptions must be explicitly configured from verified league rules. Optional AA random teams are advisory/admin-reviewed.
- Track each player's attendance at each primary and makeup event separately from performance. Injured attendees may have no/partial scores. Admin exemptions can resolve attendance and/or evaluation requirements only with explicit scope, reason, approver, and timestamp.

The existing baseline schema conflicts with this workflow: `player_seasons.season_division_id` is required; evaluation sessions are unique per season division; evaluation FKs/policies depend on division; evaluation number uniqueness is per division. A revised model/migration proposal is documented in `docs/DATABASE-DESIGN.md` and `docs/PROPOSED-DATA-MODEL-REVIEW.md`. The CSV contract is in `docs/IMPORT-WORKFLOW-DESIGN.md`.

No age-based schema migration or import UI has been implemented by this documentation update. No hosted database was accessed or changed. Existing migrations were inspected statically only; local Supabase reset, RLS tests, `npm run lint`, and `npm run build` have not been run in this update. Before implementing, reconcile the legacy division-based secure-workflow test plan and verify local/hosted migration histories. Do not use destructive commands against hosted Supabase.

