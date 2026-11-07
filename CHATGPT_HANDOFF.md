# ChatGPT Project Handoff — RWCLL Player Evaluations

**Last reviewed:** 2026-11-06  
**Purpose:** Restart/continue work in a new ChatGPT conversation without relying on prior chat history.

## Project at a glance

- **Project:** RWCLL Player Evaluations
- **Stack:** Next.js App Router, React 19, TypeScript, Supabase (PostgreSQL + Auth), Tailwind CSS; npm.
- **Developer environment:** Windows, PowerShell, VS Code.
- **Repository/local folder:** Private GitHub repo `rwcll-player-evaluations`; `D:\sandbox\GitHubRepos\rwcll-player-evaluations`.
- **Purpose:** Internal league player evaluation workflow for approximately 30–50 users; no parent/player accounts.
- **Source of truth:** Checked-in repository files, especially `ROADMAP.md`, `docs/DECISIONS.md`, `docs/DATABASE-DESIGN.md`, SQL migrations, and tests. Update documentation when durable decisions or implementation status changes.

## Current observed state — 2026-11-06

This status reflects the developer's reported local environment and test results. It is not a live inspection of GitHub or hosted Supabase.

### Application and development environment

- Next.js 16.4.4 with React, TypeScript, and Supabase.
- Development is performed on Windows using PowerShell.
- Local project directory: `D:\sandbox\GitHubRepos\rwcll-player-evaluations`.
- `.env.local` is configured for local Supabase development:
  - Studio: `http://127.0.0.1:54323`
  - API: `http://127.0.0.1:54321`
- `npm run test:all` runs the automated `test:*` scripts (excluding itself), lint, TypeScript checking, and production build.
- **Latest reported consolidated validation: 12 passed, 0 failed**, finished `2026-11-05T23:11:01.482Z`.
- Test reports are written to `test-results/`.
- Build/lint/TypeScript checks were included in the successful consolidated run.

### Database and import workflow

- The app uses protected Supabase RPCs for staging, reviewing, resolving a duplicate-ID warning, and committing Sports Connect import rows.
- Phase 5.0 staging stores imported rows in staging tables; it does not directly insert/update player or player-season registration records.
- Import rows support admin review decisions, including approved new-player creation and approved matching to an existing player.
- The commit workflow includes duplicate identifier checks, protection against duplicate player-season registrations, and idempotent handling of already-committed rows.
- Committed rows are displayed as committed and cannot be changed through the review UI.
- The latest full local automated suite passed, including the new duplicate Player ID resolution regression test.
- Synthetic test data is intentionally retained in local Supabase. Do not delete it unless cleanup is explicitly planned and approved.
- **Do not infer that hosted Supabase matches local state.** The latest work described below was applied/tested locally only; do not apply migrations or make hosted changes without explicit user approval.

### Important validation limits

- Static checks do not replace runtime database-security tests.
- Continue reviewing rejected operations, duplicate identifiers across batches/seasons/existing records, retry/idempotency, transaction rollback, audit behavior, and failure recovery.
- Verify RLS and authorization with separate administrator and non-administrator accounts.
- Do not infer that all RLS policies, coach-safe reporting, or role-based access requirements are complete from the current test results.
- Hosted migration state has not been freshly verified in this checkpoint.

## Current checkpoint — administrator evaluation review (2026-11-06)

**Repository access:** Connected GitHub repository `rwclldb/rwcll-player-evaluations`, default branch `main`. Development is on `feature/admin-evaluation-review`; changes have not been merged to `main`.

**Changes pushed to the feature branch**
- Updated `app/protected/evaluations/page.tsx` so Pending registrations are included in the evaluator eligibility filter and clarified the empty-state explanation. The UI still excludes unpaid and `UNKNOWN` statuses.
- Follow-up fix after local dashboard validation: normalize `registration_payment_status` by trimming whitespace and lowercasing in both the evaluator workspace and administrator review dashboard. The initial zero counts may have been caused by case/whitespace mismatch; this hypothesis still needs confirmation against the user's local data.
- Added `app/protected/evaluation-review/page.tsx`, a read-only administrator review page grouped by season and Little League age. It reports eligible registrations, players with evaluation records, players with no evaluation record, draft/submitted/not-evaluated counts, evaluator progress, and per-player core-rating totals/averages.
- Added a link to the review page on `app/protected/page.tsx`.
- Added `scripts/test-evaluation-review-ui.cjs` and registered `npm run test:evaluation-review-ui` in `package.json`.
- Added a Phase 6 checkpoint to `ROADMAP.md` and usage notes to `docs/FAQ.md`.

**Validation status:** The original feature branch passed the user's local checks and access tests. The follow-up status-normalization change has not yet been run through `npm run test:evaluation-review-ui`, `npm run test:all`, lint, TypeScript, or production build. Do not describe the feature as tested. No database migrations or hosted database changes were made.

**Next step:** Have the user fetch `feature/admin-evaluation-review`, run the full local validation suite, then test the dashboard against local Supabase as admin and verify non-admin access is redirected. Fix any build/runtime issues before merging. Preserve synthetic records.

## Payment status omitted by Sports Connect commit RPC (2026-11-06)

**Diagnosis confirmed from source:** the commit function in `20261105010000_handle_existing_registration_in_import_commit.sql` inserted player-season registrations without `registration_payment_status`. As a result, linked committed imports with source statuses such as `COMPLETED` and `Paid` ended up with the column default `UNKNOWN`, so the Phase 6 dashboard counted only the age-8 synthetic registration.

**Fix pushed to `feature/admin-evaluation-review`:** migration `20261107010000_preserve_payment_status_on_import_commit.sql` updates the commit RPC to copy the trimmed staged `payment_status` into `registration_payment_status`, falling back to `UNKNOWN` only if the source is blank. It also backfills existing rows only when the current registration status is exactly `UNKNOWN` and a linked committed staging row contains a nonblank status. Unrelated registrations and non-UNKNOWN statuses are left unchanged.

A static regression check was added to `scripts/test-import-commit-registration-conflict.cjs`. The user has not yet applied this migration locally or rerun tests after these changes. **Next step:** pull the feature branch, review `npx supabase migration list --local`, apply pending migrations to local Supabase only, run `npm run test:all`, then rerun the registration status query and inspect the evaluation-review dashboard. No hosted database changes have been made or authorized.

## Sports Connect import — duplicate Player ID resolution safeguard (2026-11-05)

### Local migration

**Migration:** `20261105160000_add_duplicate_player_id_resolution.sql`  
**Status:** Reported applied to local Supabase only. Do not apply to hosted Supabase without explicit approval.

The migration adds these columns to `public.sports_connect_import_rows`:

- `duplicate_player_id_resolved_at timestamptz`
- `duplicate_player_id_resolved_by uuid` referencing `auth.users(id)`
- `duplicate_player_id_resolution_reason text`

It adds the admin-only RPC `public.resolve_duplicate_player_id_warning(p_row_id bigint, p_reason text) RETURNS void`. The RPC validates administrator access, requires a reason of 5–1000 characters, verifies that the row exists and is not committed, checks that `review_flags` contains the exact warning `Duplicate Player ID in file`, and rejects already-resolved rows. It records the resolution fields and an audit event named `sports_connect_duplicate_player_id_resolved`. The original warning remains in `review_flags`.

A trigger named `enforce_duplicate_player_id_resolution_before_commit` blocks transition to `committed` when the row retains the duplicate Player ID warning and has no resolution timestamp. This is an explicit review safeguard, **not** a bypass of database uniqueness constraints. A resolution records that an admin investigated the warning; it does not make a genuinely conflicting external identifier safe to commit.

### UI and server-action changes

- `app/protected/import-batches/review-actions.ts` includes `resolveDuplicatePlayerIdWarning`, with admin/row-state/flag/reason checks and path revalidation.
- `app/protected/import-batches/[batchId]/review/page.tsx` selects and passes the duplicate-resolution timestamp and reason to the review form.
- `review-decision-form.tsx` displays the duplicate-warning resolution section, records the reason, and displays the saved reason once resolved.
- Saving a review decision and committing remain separate actions.
- Production staging logic was not changed to detect duplicates. The preview/import-preview logic detects duplicate IDs and supplies the warning; the staging RPC stores each row's supplied `issues` array as `review_flags`.

### Focused regression test

**Test:** `scripts/test-import-duplicate-player-id-resolution.cjs`  
**Package script:** `npm run test:import-duplicate-player-id-resolution`  
**Local opt-in:**
```powershell
$env:ALLOW_LOCAL_IMPORT_TESTS = "YES"
npm run test:import-duplicate-player-id-resolution
```

The test passed against local Supabase and verified:

1. Both staged synthetic rows had the `Duplicate Player ID in file` warning.
2. Commit of an unresolved duplicate-warning row was blocked with: `Resolve the Duplicate Player ID in file warning before committing this row`.
3. Explicit resolution recorded the administrator's reason and timestamp.
4. The resolved row committed successfully.

Reported test output:
- Local season: `1`
- Test batch: `6`
- Unresolved row (not committed): `15`
- Resolved row (committed): `16`
- Synthetic test records retained.

The test calls the staging RPC directly, so it explicitly supplies `issues: ["Duplicate Player ID in file"]` on both test rows. This is intentional: the test isolates the database commit safeguard rather than testing the preview parser's duplicate detection.

### Latest full validation

`npm run test:all` reported:
- **Total: 12**
- **Passed: 12**
- **Failed: 0**
- **Finished:** `2026-11-05T23:11:01.482Z`
- **Overall result:** `PASS`

The consolidated runner includes import tests, lint, TypeScript checking, and production build. This confirms the current local code and test suite passed; it does not prove hosted schema parity or complete application security.

### Existing synthetic test data to preserve

- Local import batch `1` has eight synthetic rows. It includes intentionally duplicated external Player ID `TEST-DUP` on staged rows `5` and `6`; row `6` was previously committed and row `5` has a recorded duplicate-warning resolution reason. Preserve unless cleanup is explicitly planned.
- The focused resolution test created local batch `6`, with staged rows `15` and `16`. Row `15` remains unresolved/uncommitted; row `16` was resolved and committed. Preserve for inspection unless cleanup is explicitly approved.
- A previous remote duplicate-external-player-ID regression test left remote batch `2`, staged row `9`, approved but uncommitted. Treat it as synthetic test data, not a real registration. Inspect before any cleanup.
- The remote test artifact and any prior remote test results do not authorize applying the new local migration remotely.

## Earlier verified import workflow and migrations

### Phase 5.5 — remote duplicate external player ID

Earlier reported remote regression test used existing `TEST-1003` in season 1 with a separately generated registration number. The database rejected the conflicting commit with SQLSTATE `23505`. After rejection, no player or player-season registration was created, the existing registration remained intact, the staged row remained `approved_new` with no committed registration ID, and no commit audit event was written for the rejected row. This was a previous test, not a fresh verification in this checkpoint.

### Phase 5.5 — duplicate registration protection

**Migration:** `20261105010000_handle_existing_registration_in_import_commit.sql`

Previously reported applied to local and hosted development Supabase. It prevents an approved-match import from creating a second registration for the same player and season, rejects conflicting commits without changing the existing player's identity or creating a second registration, and preserves retry idempotency. Current hosted migration status has not been freshly verified.

### Migration history caveat

Previous checkpoints reported eight migrations through `20261104230000_phase_5_5_sports_connect_commit.sql`, with `20261105010000_handle_existing_registration_in_import_commit.sql` applied to local and remote. The new `20261105160000_add_duplicate_player_id_resolution.sql` was subsequently applied locally only. Confirm actual local and remote migration lists before any future migration operation; do not assume the older status block is a current full inventory.

## Documentation present

- `ROADMAP.md`
- `docs/DATABASE-DESIGN.md`
- `docs/DECISIONS.md`
- `docs/FAQ.md`
- `docs/SECURE-WORKFLOW-TEST-PLAN.md`
- `docs/IMPORT-WORKFLOW-DESIGN.md`
- `docs/PROPOSED-DATA-MODEL-REVIEW.md`

**Documentation drift to resolve:** Some roadmap and decision-log entries may still describe schema/migration work as proposed or not implemented, despite applied migrations. Validate the repository and migration history before changing status. The secure-workflow test plan previously referenced replacement migration/regression-check filenames that were not present in an earlier archive; reconcile it against the actual files before running it.

## Confirmed product and data decisions

- One league, roughly 30–50 users; no parent/player accounts.
- Responsive web app/PWA direction for phones, tablets, and desktop.
- Individual accounts; invitations administered by league admins; public sign-up should be disabled/removed for the intended product.
- Coaches may be assigned to multiple teams in a season.
- Evaluation groups are based on official Little League age, not eventual division; one age group may span divisions.
- Each player has at most one roster assignment per season.
- Each player-season has a season-specific `evaluation_number`; it can be generated from an admin-selected starting number, manually overridden, or imported. Evaluation without a number is allowed. It does not carry forward between seasons.
- Five required core skills; pitching/catching are optional for AAA and above per the older decision log. A later product decision says pitching and catching categories should be available for all evaluation age groups, possibly unscored, and availability must not depend on eventual division assignment. Reconcile this discrepancy before implementation.
- Coach and independent-evaluator ratings/averages remain separate. Coaches see group aggregates only; independent evaluator identities are hidden from coaches. Admins can inspect individual submissions.
- Coaches must not see a comparison/juxtaposition of their assigned-team averages against division-wide averages.
- `Not Evaluated` is not zero and is excluded from averages; blank optional ratings are not zero.
- Historical ratings are read-only and excluded from current averages.
- Stable internal player ID is independent of name/birthdate. Sports Connect IDs are season-specific external identifiers and matching clues, not universal permanent player IDs. Same ID is evidence, not proof; changed ID is not proof of a different child. Candidate matches require administrator confirmation; uncertain rows remain pending review.
- Seasons are closed by default after completion. Admin reopening for correction must be explicit and audited; session locking is a separate workflow state.
- Creating a new season carries forward only editable division setup. Do not copy teams/team names, coach assignments, player evaluations, or historical results. Team names are assigned after evaluations.
- Evaluators can save drafts, resume, and edit their own submitted evaluations until session lock. Admin determines completion; missing ratings/submissions are flagged but do not automatically block completion. Admin corrections after lock require a reason and audit trail.
- Evaluators can search/evaluate any player in their assigned division; coaches may evaluate players in any division.
- Absences are recorded and reported to admins. Players missing required evaluations are flagged for admin handling and are not eligible to play unless resolved.

See `docs/DECISIONS.md` and `ROADMAP.md` for fuller records. If a conflict appears, stop and reconcile it rather than silently choosing one version.

## Sports Connect import requirements and sample data

- Active baseball divisions are AA, AAA, Majors, Juniors, Seniors. Import all rows, but flag A/Tee Ball/Wiffle Ball/other out-of-scope programs for admin review and keep them out of the active evaluation pool by default.
- Include both Completed and Pending registrations. Pending means payment has not been completed; the app does not handle payments. Display status on player lists/details/reports, never on evaluation screens, and do not exclude Pending players from evaluation eligibility.
- Use a supplied registration/evaluation number if present; otherwise leave null until assigned. Do not auto-number as part of import.
- Duplicate nonblank Sports Connect Player IDs within one import/season are blocking conflicts for admin review; never auto-merge. Existing-player matching is always admin-confirmed.
- Use the supplied season age chart and official Aug. 31 baseball age rule; verify the source before production use.
- Draft order is Seniors → Juniors → Majors → AAA → AA. The app records post-draft division/team assignments; it does not conduct the official draft or replace official rostering. Top-age placement rules and exceptions must be explicitly configured from verified league rules. Optional AA random teams are advisory/admin-reviewed.
- Track attendance at each primary and makeup event separately from performance. Injured attendees may have no/partial scores. Admin exemptions can resolve attendance and/or evaluation requirements only with explicit scope, reason, approver, and timestamp.
- An earlier fake-data CSV review reported 323 rows, 323 unique nonblank Player IDs, statuses of 286 `Completed` and 37 `Pending`, 323 blank Registration Numbers, and division/program counts AA 74, AAA 74, Majors 68, A 45, Tee Ball 29, Juniors 18, Seniors 14, Wiffle Ball 1. These are historical fake test-data observations, not a fresh file validation or database import.
- The revised age-based data model was documented in `docs/DATABASE-DESIGN.md`, `docs/PROPOSED-DATA-MODEL-REVIEW.md`, and `docs/IMPORT-WORKFLOW-DESIGN.md`. Do not assume the age-based schema redesign has been implemented just because the proposal exists.

## Immediate next steps

1. Review current working-tree changes and generated test reports; preserve valid work before committing.
2. Update `ROADMAP.md`, `docs/DECISIONS.md`, `docs/FAQ.md`, and import workflow documentation so implementation status and the new duplicate-warning resolution flow are accurately reflected.
3. Review whether an ignored row can later be changed and committed. This behavior is not yet settled; do not implement a terminal-ignore or explicit-reopen workflow until the product rule is agreed.
4. Continue local regression tests for unauthorized/rejected commits, duplicate external IDs and registration numbers across batches/seasons/existing records, retry/idempotency, rollback, audit behavior, and database-failure recovery.
5. Verify RLS and authorization using separate admin and non-admin accounts.
6. Reconcile documentation drift and the legacy division-based secure-workflow test plan with the actual migrations and intended age-based evaluation model.
7. Confirm local and remote migration histories before any migration operation.
8. **Do not make hosted database changes unless the user explicitly approves them.**

## Safety and handling notes

- Never commit `.env`, `.env.local`, Supabase service-role keys, database passwords, JWT secrets, or other credentials.
- Supabase local runtime state under `supabase/.temp/` should not be shared or committed. An earlier archive included local runtime files from that directory; `/supabase/.temp/` is reported ignored by `.gitignore`.
- If any real credential from the local runtime directory was committed to a remote repository or otherwise exposed, remove it from repository history as appropriate and rotate/revoke it in Supabase. Do not paste credentials into ChatGPT.
- Synthetic test records are intentionally retained; do not assume they should be deleted.
- Any generated archive or copy is separate from the user's working repository unless explicitly installed there. This handoff update does not push changes to GitHub or alter the user's local repo.

## How to resume in a new ChatGPT chat

Upload the latest project ZIP (or connect the repository if an appropriate integration is available) and say:

> Continue the RWCLL Player Evaluations project. Read `CHATGPT_HANDOFF.md` first, then inspect the current roadmap, decision log, database design, FAQ, import workflow documentation, migrations, and tests. Confirm the current state before changing anything. Keep database work local unless I explicitly approve hosted changes.

At the end of each substantial work session, update this file with verified state, changed files, test results, decisions, blockers, and the single best next step. Keep it concise and factual; distinguish confirmed requirements, implemented code, and tested behavior.

## Previously reported uncommitted work — verify current status

An earlier checkpoint reported these working-tree changes; they may have changed since then. Inspect `git status` and the complete diff before assuming any remain uncommitted:

- Modified import review page and review-decision form.
- Modified `package.json` and import-review UI test.
- New `scripts/run-tests.cjs`.
- New import commit/review test scripts.
- New `test-results/` output.

Do not discard these changes or assume they have been pushed to GitHub.


## Historical coach evaluation design checkpoint — 2026-11-07

- User confirmed that coaches will rate their own players at the end of each year using the same rating scales as spring evaluations. These ratings should be imported before the next spring evaluation so coaches can see prior-year coach ratings. Initially, historical ratings need only appear in final reports alongside current group ratings.
- Matching must support both a permanent RWCLL Player ID when available and a fallback candidate workflow using names and other available details. Do not silently match on name alone or create a player automatically from a historical row.
- Inspection of `supabase/migrations/20261103170921_initial_schema_baseline.sql` confirmed existing `historical_evaluations` and `historical_ratings` tables. They are minimal and should be extended, not duplicated.
- Added migration draft `supabase/migrations/20261107020000_historical_coach_evaluation_schema.sql` on `feature/admin-evaluation-review`. It adds source season/coach/import metadata, match provenance, category mapping fields, and protected `historical_evaluation_import_rows` staging with review states and idempotency constraints.
- Added `scripts/test-historical-coach-evaluation-schema.cjs`, registered as `test:historical-coach-evaluation-schema` so `npm run test:all` can discover it. Updated `docs/DATABASE-DESIGN.md`, `docs/DECISIONS.md`, `docs/FAQ.md`, and `ROADMAP.md` with the agreed matching workflow and implementation status.
- **Applied to local Supabase only; no hosted database changes made.** Static schema tests passed. The user verified all three tables exist with RLS enabled, the expected constraints/indexes exist, and policies require `is_admin()`. Actual non-admin runtime access, database constraint rejection behavior, and import transaction behavior remain to be tested. Raw history remains admin-only until scoped coach-facing report access is implemented.
- Next after local schema validation: complete evaluation reports/export with historical ratings clearly separated from current spring group results.


### Local historical schema validation update — 2026-11-07

- User ran `npm run test:historical-coach-evaluation-schema`; all 10 static checks passed.
- The user subsequently confirmed migration `20261107020000` applied locally and supplied read-only query results verifying all three tables, RLS enabled, constraints, indexes, and administrator policy expressions.
- Next step: apply the single pending migration to local Supabase, then verify table structure, RLS policies, constraints, and existing data. No hosted changes.


## Age-group rating summary checkpoint — 2026-11-07

**Branch:** `feature/admin-evaluation-review`

- Updated `app/protected/evaluation-review/page.tsx` to display an age-group core-skill summary per season/age section.
- Averages include submitted evaluations only and are split into coach versus independent-evaluator ratings. Each average shows its contributing rating count; missing scores are excluded, not treated as zero.
- Updated `scripts/test-evaluation-review-ui.cjs` with static assertions for the summary and its rules.
- Commits: `884439d25f029dcc892c84716025ea21b929c647` (UI), `e8958488931bfe183df7d1f93d8670b00fe90314` (test).
- **User validation reported 2026-11-07:** the age-group summary tests passed and the UI looked correct. This does not replace the separate coach authorization tests now being added.
- No migration was added and no hosted Supabase change was made.


## Player reports and CSV export checkpoint — 2026-11-07

**Branch:** `feature/admin-evaluation-review`

Added:
- `app/protected/reports/page.tsx`: administrator-only season selection and player report list.
- `app/protected/reports/player/[playerSeasonId]/page.tsx`: individual report with current-season evaluations separated from historical coach ratings.
- `app/protected/reports/export/route.ts`: administrator-checked CSV export. `CURRENT`, `CURRENT_GROUP_SUMMARY`, and `HISTORICAL_COACH` rows are distinct; rating counts and historical source metadata/coverage notes are preserved where available.
- Workspace link added in `app/protected/page.tsx`.
- `scripts/test-player-reports.cjs`, registered as `npm run test:player-reports`.
- `ROADMAP.md` and `docs/FAQ.md` updated.

**User validation reported 2026-11-07:** focused tests passed and the report/export UI worked. This feature remains administrator-only. No migration was added for the report/export feature and no hosted database change was made. Scoped coach-facing historical report access is now being implemented in the next checkpoint below.


## Scoped coach historical reports checkpoint — 2026-11-07

Branch: feature/admin-evaluation-review

Implemented on the branch:
- Migration 20261107030000_scoped_coach_historical_reports.sql adds coach_historical_report_roster(bigint) and coach_historical_report(bigint) RPCs. They check current-season team assignment and return only the assigned roster or historical data for an authorized player's registration. Historical tables remain administrator-only under RLS.
- Added app/protected/coach-reports/page.tsx and app/protected/coach-reports/player/[playerSeasonId]/page.tsx. Coach pages use the scoped RPCs, and the individual report displays historical coach ratings only. The evaluator workspace links to the coach report list.
- Added scripts/test-coach-historical-reports.cjs and npm run test:coach-historical-reports; the consolidated test runner auto-discovers it.
- Updated the FAQ, roadmap, database design, and decision log.

Not yet locally tested: The migration has not been applied to local Supabase, and the static test/full suite have not been run for this change. Pull the branch, review npx supabase migration list --local, apply pending migrations with npx supabase migration up --local, then run npm run test:coach-historical-reports and npm run test:all. Because migration up --local applies all pending local migrations, inspect the pending list first.

Manual authorization tests still required: assigned coach sees only assigned-team players; coach assigned to another team cannot access those reports even by direct URL; unassigned coach gets no roster; direct historical-table reads remain denied for non-admins; administrator reports and CSV export remain functional.

Hosted Supabase: No migration applied and no hosted database changes made.
