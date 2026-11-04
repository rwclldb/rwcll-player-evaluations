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

## Current observed state from the uploaded project archive

This is based on inspection of the uploaded ZIP, not a live connection to GitHub, Supabase, or the developer's machine. The user has reported that migrations were applied locally and to hosted Supabase; actual live migration histories/schema have not been re-queried during this review.

### Application

- The project contains the standard Next.js/Supabase starter authentication pages and Supabase SSR client/proxy setup.
- `app/page.tsx` is already more than the original starter landing page: it queries `public.seasons`, displays seasons, and includes a create-season form.
- `app/actions.ts` contains the `createSeason` server action with basic name/date validation and inserts into `seasons`.
- `app/protected/page.tsx` still contains starter-template user-claims/tutorial content.
- The starter sign-up route/UI is still present. The product requirement is admin-managed invitations and no public registration; that requirement is not yet fully implemented.
- `package.json` defines `dev`, `build`, `start`, and `lint` scripts. No lint/build result was verified during this review.

### Database/migrations

The archive contains five timestamped SQL migrations:

1. `20261103170921_initial_schema_baseline.sql`
2. `20261103180000_add_rls_auto_enable_event_trigger.sql`
3. `20261103193000_restore_private_correction_authorizations.sql`
4. `20261103194500_add_evaluation_workflow_triggers.sql`
5. `20261103200000_restrict_audit_log_writes.sql`

The baseline migration defines the main relational schema, functions, policies, and triggers. A later migration adds a private correction-authorization table and audited correction function; subsequent migrations add workflow guards and restrict direct audit-log writes.

**Critical status distinction:** SQL files exist in the repository, but this archive does not prove that they have been applied to either a local or hosted Supabase database. The secure workflow test plan explicitly says these migrations have not been executed in this artifact-generation context and must be validated locally first. Do not apply unreviewed migrations to hosted/production Supabase.

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

1. **Confirm repository state:** compare this archive to the latest GitHub `main` branch and local working tree. This archive may not include uncommitted work or Git history.
2. **Review migration sequence and test-plan mismatch:** identify whether the five migrations are the intended final sequence; reconcile `docs/SECURE-WORKFLOW-TEST-PLAN.md` references to absent files with the actual SQL.
3. **Validate locally only:** use a disposable/local Supabase database and test the full migration chain. Do not run destructive reset commands against hosted Supabase. Capture exact errors and fix via new migrations rather than casually rewriting already-applied migrations.
4. **Test security with separate admin, coach, and evaluator accounts:** especially RLS, evaluator self-authorization, division/session boundaries, lock/closed-season behavior, audited corrections, audit-log write restrictions, historical read-only behavior, and coach-safe aggregates/notes.
5. **Implement secure reporting projections:** the current secure workflow test plan explicitly notes that coach-safe aggregate summaries, identity-safe notes, and separate private/shared notes are not yet implemented. Do not expose raw evaluation joins to coaches.
6. **Update `ROADMAP.md`, `docs/DECISIONS.md`, and this handoff** only after implementation and tests are actually complete.
7. Run `npm run lint` and `npm run build`; record results and fix issues.
8. Continue role-based UI, import preview/matching, absence workflow, and end-to-end test work according to the roadmap.

## Safety and handling notes

- Never commit `.env`, `.env.local`, Supabase service-role keys, database passwords, JWT secrets, or other credentials.
- Supabase local runtime state under `supabase/.temp/` should not be shared or committed. The uploaded archive included this local runtime directory (including an environment file). It has been excluded from this handoff archive, and `.gitignore` now ignores `/supabase/.temp/`.
- If any real credential from the local runtime directory was committed to a remote repository or otherwise exposed, remove it from repository history as appropriate and rotate/revoke it in Supabase. Do not paste credentials into ChatGPT.
- The cleaned archive is a working copy for review; it does not push changes to GitHub or alter the user's local files.

## How to resume in a new ChatGPT chat

Upload the latest project ZIP (or connect the repository if an appropriate integration is available) and say: **“Continue the RWCLL Player Evaluations project. Read `CHATGPT_HANDOFF.md` first, then inspect the current roadmap, decision log, database design, and migrations. Confirm the current state before changing anything.”**

At the end of each substantial work session, update this file with the current verified state, changed files, test results, decisions, blockers, and the single best next step. Keep it concise and factual; distinguish confirmed requirements, implemented code, and tested behavior.

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

