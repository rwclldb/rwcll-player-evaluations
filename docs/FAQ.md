# RWCLL Player Evaluations — FAQ & How-To

## Project overview
- Stack: Next.js, Supabase (PostgreSQL and Auth), npm
- Local development: Windows, PowerShell, VS Code
- Local folder: `D:\sandbox\GitHubRepos\rwcll-player-evaluations`
- Private GitHub repository: `rwcll-player-evaluations`
- Detailed proposed schema: [`DATABASE-DESIGN.md`](DATABASE-DESIGN.md)

## Verified setup (2026-11-02)
- [x] Next.js + Supabase starter created.
- [x] App loads at `http://localhost:3000`.
- [x] `.env.local` is Git-ignored (`git check-ignore -v .env.local` confirmed `.gitignore:34:.env*.local`).
- [x] Initial scaffold committed as `34f85d2` and pushed to `main`.
- [x] Supabase test user created; sign-in succeeded and protected page displayed user claims.
- [ ] Complete end-to-end validation of database schema, RLS policies, and reporting/aggregate outputs.

Successful sign-in verifies Supabase Auth, not the RWCLL database schema, queries, or authorization policies.

## Start the app
From the project root in VS Code:
```powershell
npm run dev
```
Open `http://localhost:3000`. Stop with `Ctrl+C`.

## Git basics
```powershell
git status
git add .
git status
git commit -m "Describe the change"
git push
```
Review staged files before committing. Test locally first. Never commit secrets. Roadmap items are checked only after implementation and testing.

## Environment variables and secrets
`.env.local` contains the Supabase project URL and publishable key. Keep it local and untracked.
```powershell
git check-ignore -v .env.local
```
Variable names: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
`.env.example` may be committed only with placeholders. Never share `.env.local`, passwords, tokens, service-role keys, or database credentials. Never expose a service-role/secret key to browser code. Restart the dev server after changing environment variables.

## Supabase dashboard
- **Authentication → Users:** manage test accounts.
- **SQL Editor:** inspect the database and run carefully reviewed SQL.
- **Table Editor:** inspect development data.
- **Project Settings → API:** view the project URL and publishable key.

Prefer version-controlled SQL migrations as the schema develops. Do not load live league data before RLS policies are implemented and tested.

### Switch Supabase CLI accounts or projects
The Supabase Dashboard browser login and the Supabase CLI login are separate. The CLI account also does not automatically determine which project this repository is linked to.

To switch the account used by the CLI, from the repository folder in VS Code PowerShell:

```powershell
npx supabase logout
npx supabase login
```

1. Sign in to the Supabase Dashboard using the account that owns the intended project. If necessary, use a private/incognito browser window so you do not disturb your usual browser session.
2. In that account, create a personal access token under **Account → Access Tokens** in the Supabase Dashboard.
3. Run `npx supabase login` and provide the token only in your own terminal when prompted. Never paste the token into chat, commit it, or put it in `.env.local`.
4. Verify which projects the CLI account can access:

   ```powershell
   npx supabase projects list
   ```

5. Link this repository to the intended project:

   ```powershell
   npx supabase link
   ```

   Follow the prompts and choose the correct project. Check the project reference carefully before any remote database command.

Signing out of the CLI does not sign you out of the Dashboard browser, and switching the CLI account does not itself change this repository's existing project link. Verify both the account and project before remote operations. Do not share personal access tokens, database passwords, API keys, or connection strings.

## Local Supabase migrations: staging and review features

Use these steps when a local page reports that a Phase 5.0/5.3 migration is missing, or when a new migration needs to be applied. Run commands from the project root—the folder containing `package.json` and `supabase/`.

1. Check which Supabase instance the CLI sees:
   ```powershell
   npx supabase status
   ```
   Confirm the local API is `http://127.0.0.1:54321`. If the local stack is stopped, run `npx supabase start`, then check status again.
2. Check migration history:
   ```powershell
   npx supabase migration list --local
   ```
   Review the **Local** column and identify any migrations that are pending locally. The Phase 5.0 Sports Connect staging migration is `20261104210000_add_sports_connect_staging.sql`; Phase 5.3 review decisions is `20261104220000_add_import_row_review_decisions.sql`.
3. If the relevant migration file is present in `supabase/migrations/` and is pending, apply pending local migrations:
   ```powershell
   npx supabase migration up --local
   ```
   This applies **all migrations pending locally**, not just one selected file. Review the list first and stop if any unexpected migration is pending.
4. Verify the result:
   ```powershell
   npx supabase migration list --local
   ```
   Refresh the app page after the migration succeeds. If the page still reports a missing migration, verify that the app's `.env.local` uses the local Supabase URL and restart `npm run dev` after changing environment variables.

### Safety rules

- These instructions are for local Supabase only. Do not run `npx supabase db push`, link/sync commands, or other hosted-database operations as part of this procedure.
- Do not run `npx supabase db reset --local` just to apply a migration; reset destroys local database contents and is not needed for an ordinary pending migration.
- Never assume the app and CLI use the same database just because the page opens. Check the local API URL and `.env.local` (do not share secret values).
- Keep the hosted Supabase database unchanged unless a separate, explicit approval is given for a specific hosted change.

### Import batch screen says “Could not load staged batches”

1. Confirm local Supabase is running and the local staging migration is applied using the steps above.
2. Confirm the signed-in user has the administrator role in the **local** database. Authentication alone does not make a user an administrator.
3. Check that `.env.local` points to the local Supabase API (`http://127.0.0.1:54321`) and restart the Next.js dev server after environment changes.
4. If it still fails, capture the exact page message and relevant terminal error, removing secrets. Do not reset the database as a first troubleshooting step.

### Import batch page says “Read-only review” and has no review buttons

The presence of staged rows confirms that the batch can be read, but it does not confirm that the review controls are enabled. Before attempting decisions:

1. Confirm the app is signed in as the local administrator account, not a different account or session.
2. Verify that the administrator role exists for that account in the local database. The intended global administrator role uses `role_name = 'administrator'` and `season_id IS NULL` in `public.user_roles`.
3. Confirm the Phase 5.4 administrator review UI files were copied into the project and that the app is running the updated source. Refresh the page; if source files changed while the dev server was running, restart `npm run dev`.
4. If the page still says “Read-only review,” do not assume the browser test passed and do not try to bypass the UI. Record the signed-in account email (do not share passwords or tokens), the exact page URL, and whether the local administrator-role query returns that account. Then inspect the Phase 5.4 role-check/UI wiring.

### What import review does—and does not do

Review decisions are audit-recorded decisions about staged rows. They do not themselves create or update player or player-season registration records, merge identities, or commit an import. Continue using fake/test data until the complete import workflow is separately implemented and validated.


### Database snapshot and migration safety
As of 2026-11-03, the initial tables, helper/trigger functions, triggers, and RLS policies have been created directly in the hosted RWCLL Supabase project. The four checked tables (`players`, `player_seasons`, `teams`, `evaluations`) currently contain zero records. A schema-only reference snapshot named `schema-baseline-review.sql` was exported from the `public` schema (60,543 bytes) to the local repository root. It is a review artifact, not yet an approved or replayable migration, and it has not been confirmed committed to Git.

Do not run `npx supabase db pull`, `npx supabase db push`, or `npx supabase db reset` as a shortcut. In this CLI version, `db pull` can update remote migration history. First review the snapshot and reconcile the live schema, establish the baseline deliberately, and validate migrations locally. The database schema and access policies are not launch-ready; do not import real league data yet.

## Season lifecycle (design confirmed; implementation pending)
- Each season is a separate record; creating a new season must not overwrite previous seasons, rosters, or evaluations.
- A season is closed by default once completed. Closed seasons remain available for authorized viewing, but ordinary users cannot change their historical data.
- Only an administrator may explicitly reopen a closed season to make a correction. The reopen action, administrator, timestamp, and reason should be recorded in the audit log; the administrator can close it again afterward.
- Closing/reopening a season is distinct from locking an evaluation session. Session locks continue to control evaluation submissions.

## Creating a new season (design confirmed; implementation pending)
- Carry forward only the division setup from the previous season. Divisions remain editable for the new season. The usual evaluation divisions are AA, AAA, Majors, Juniors, and Seniors; the season setup should allow the administrator to edit which divisions apply.
- Do not copy team names, coach assignments, player evaluations, or historical results into a new season.
- Coaches are registered and assigned anew for each season. Team names are not entered until after evaluations, when teams are formed.

## Confirmed database and access rules
- A coach can be assigned to multiple teams in a season. Assignments are season-scoped.
- Coaches must not see a comparison of assigned-team averages against division-wide averages. Coach-facing screens must not juxtapose these scopes or otherwise present a team-versus-division comparison.
- Coaches do not see individual coach ratings or individual independent-evaluator ratings.
- Coach and independent-evaluator averages remain separate; never combine the groups.
- Independent evaluator identities are hidden from coaches.
- Administrators can inspect individual submissions.
- There is one evaluation session per division per season, with multiple evaluators assigned to it.
- A player can appear on only one team roster in a season; the player can move to a different team in a later season.
- The app generates a permanent internal `player_id`; it is not derived from name or birthdate.
- During imports, name and birthdate may suggest a possible existing-player match, but an administrator must confirm the match. Uncertain rows stay pending review; the app must not silently merge records. If no existing player is confirmed, the administrator can create a new player record.
- Each player has a season-specific `evaluation_number` matching the number they wear during evaluations. It is not a permanent ID and does not carry over to the next season.
- Not Evaluated is not zero and is excluded from averages.
- Blank optional categories are not zero; show counts alongside averages.
- Five required core ratings: Hitting, Throwing, Grounders, Fly balls, Running / Awareness.
- Pitching/catching categories are optional for AAA and above.
- Historical ratings are read-only and excluded from current averages.
- Private coach notes must not leak through shared notes or score queries.

The `evaluation_number` is stored with the player's season roster record, shown to coaches/evaluators on the evaluation screen, and must be unique within that season division when assigned. It is a new value for each season. For imports, `player_id` is generated internally and remains stable across seasons; name and birthdate are matching clues only, and an administrator must confirm a match before records are linked. The schema document describes intended tables and relationships; the initial tables, helper/trigger functions, triggers, and RLS policies have now been created directly in the hosted Supabase project, but they are not yet fully reconciled with this design or tested end-to-end. Secure database-side aggregate functions/views are still required; frontend hiding alone is not sufficient. Test access with separate coach accounts assigned to different teams, as well as independent evaluator and administrator accounts. Do not import real league data until these checks pass.

## Authentication and roles
The starter includes sign-up UI. The intended RWCLL app uses administrator-managed invitations, not public registration. A Supabase-authenticated user is not automatically an RWCLL administrator; application roles and permissions must be implemented separately. Enforce access with database RLS, not just frontend visibility.

## Troubleshooting
**App will not start:** confirm the terminal is in the folder containing `package.json`, run `npm run dev`, and inspect the first terminal error.

**Environment warning:** confirm `.env.local` is in the project root and variable names match `.env.example`. Do not share values. Restart the dev server after edits.

**Sign-in fails:** confirm the user exists in Supabase Authentication and check email confirmation status. Remove tokens and personal information before sharing error text.

## Documentation upkeep
Update the FAQ with verified procedures, the roadmap with implementation-and-test status, and the decision log with durable decisions. Update the database design when structural decisions change. After substantive project updates, update all relevant docs. The current updated documentation has not yet been confirmed copied into the Git repository.

## Running the full test suite

Run the test suite from the repository root in PowerShell. The
duplicate-player-ID resolution test requires explicit authorization
for local import tests.

1. Confirm that `.env.local` points to the local Supabase instance:

   `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`

2. Set the local-test authorization variable and run the full suite:

   ```powershell
   $env:ALLOW_LOCAL_IMPORT_TESTS = "YES"
   npm run test:all


## Evaluation workflow rules (confirmed 2026-11-02)

### Evaluation numbers and finding players
- Administrators can generate evaluation numbers beginning at a chosen number, override numbers manually, or import numbers from CSV. Players may be evaluated without a number.
- Evaluators can find and evaluate any player in their assigned division. Coaches may evaluate players in any division.
- The system records absences and provides an administrator report. Players who miss required evaluations are flagged for administrator follow-up and are not eligible to play unless the issue is resolved.

### Sports Connect IDs and matching returning players
- Sports Connect provides a player ID, but the same child can receive a different ID in a later season if a different parent registers them. Treat it as a season-specific external registration ID, not the app’s permanent player ID.
- A matching Sports Connect ID can help suggest a returning player. A changed ID does not rule out a match. Names and dates of birth also only suggest candidates; they must not trigger an automatic merge.
- An administrator must explicitly confirm any link to an existing player. Keep ambiguous rows pending review, and record the decision. If uncertain, do not merge or overwrite an existing external ID.

Before trusting the import-matching workflow, test with synthetic/anonymized records:
1. Same child, same Sports Connect ID in two seasons: candidate should be suggested; admin confirmation is still required.
2. Same child, different Sports Connect IDs in two seasons: candidate should still be suggested from other matching details; the ID difference must not block review.
3. Different children with similar names or the same date of birth: show possible candidates but never auto-merge.
4. One source row with no plausible candidate: allow an admin to create a new internal player.
5. An ambiguous source row: keep it pending until an admin decides; do not create a duplicate automatically.
6. Repeated non-null Sports Connect ID in the same season: flag a duplicate/conflict for review rather than silently assigning the ID to multiple player-season rows.
7. Same external ID reused in different seasons: permit it; external ID uniqueness is season-scoped, not global.

Use test names and IDs only—never paste real children’s identifiers into chat or public issue trackers.

### Drafts, missing work, and locking
- Evaluators can save a draft and return to it later. They can edit their submitted evaluations until the session is locked.
- Administrators decide when a session is complete. The system flags missing ratings and missing evaluator submissions, but these gaps do not automatically block completion.
- Once locked, an evaluation can be corrected only by an administrator, and the correction must be recorded in the audit trail.

### Optional team suggestions
- Team generation is an optional planning aid, not the league's official team-management system. Administrators remain responsible for reviewing and using any proposed rosters.
- Administrators set the target team size. If player counts do not divide evenly, suggested teams may differ in size by one player. Coaches are assigned before players are placed.
- Administrators can flag a coach's child for automatic placement on that coach's proposed team. All coaches can see which players are designated as a coach's child.
- Balancing may use available ratings, age, experience, and pitching/catching information. Missing ratings are not invented.
- Suggested rosters should be exportable to CSV and printable. Players added after teams are formed may have no evaluation scores; existing ratings and historical data must not be silently overwritten.


## 2026-11-03 workflow update

The prior FAQ/schema notes describe division-based sessions. They are superseded for future implementation by the age-based workflow in [`DATABASE-DESIGN.md`](DATABASE-DESIGN.md), [`IMPORT-WORKFLOW-DESIGN.md`](IMPORT-WORKFLOW-DESIGN.md), and [`PROPOSED-DATA-MODEL-REVIEW.md`](PROPOSED-DATA-MODEL-REVIEW.md).

- Spring 2027 is 2027-01-01 through 2027-06-30; preserve the existing season record.
- Import Completed and Pending registrations; pending is payment status only and does not block evaluation.
- Show registration status on player lists/details/reports, but not on evaluation screens.
- Import out-of-scope programs for review, but exclude them from the active evaluation pool by default.
- Evaluations are age-group based, with primary and makeup events; track attendance separately from ratings.
- The app records post-draft assignments and optional advisory AA team suggestions; it does not replace official rostering.
- The revised schema and import process are not implemented yet. Do not import real data until migrations, RLS, and role tests pass.


## Imported registrations show UNKNOWN payment status

The Sports Connect staging rows retain the source payment status, but older versions of the commit RPC did not copy that value into `player_seasons.registration_payment_status`. The migration `20261107010000_preserve_payment_status_on_import_commit.sql` updates the commit RPC for future imports and backfills existing registrations only when their current status is `UNKNOWN` and a linked committed staging row contains a nonblank source status.

For local development, pull the feature branch and apply pending migrations only after reviewing the local migration list:

```powershell
npx supabase status
npx supabase migration list --local
npx supabase migration up --local
npx supabase migration list --local
```

This changes the local database only when the CLI is connected to the local stack. Do not run a hosted migration or `db push` without separate explicit approval. Then rerun `npm run test:all` and recheck registration statuses. The backfill does not alter non-`UNKNOWN` statuses or registrations that have no linked committed import row.

## Administrator evaluation review

The administrator workspace links to **Review evaluations** at `/protected/evaluation-review`. The page is read-only and summarizes the age-based sessions for each season.

- **Eligible registrations:** includes the supported completed/paid statuses and Pending registrations. Pending is a payment state, not an evaluation disqualification.
- **Excluded registrations:** unpaid and `UNKNOWN` statuses are not included in the evaluator's eligible pool.
- **Status normalization:** eligibility checks trim whitespace and compare status values without regard to capitalization, so `Paid`, `paid`, and `PAID` are treated consistently.
- **Players with a record:** a player counts as having an evaluation record when at least one evaluation record exists for that player in the age session. This is not the same as having all five core ratings or a submitted evaluation.
- **Missing:** eligible players with no evaluation record in that session.
- **Core total/average:** computed from ratings actually entered for Hitting, Throwing, Grounders, Fly Balls, and Running / Awareness. Missing ratings are not zero. The total shows the rated count when fewer than five core ratings are present.
- **Evaluator progress:** counts records by evaluator and evaluator type. Administrators can see individual evaluator records; coach-facing aggregate permissions remain a separate requirement.

This dashboard is currently a development feature. Run `npm run test:evaluation-review-ui` for static UI regression checks, then validate it against local synthetic data and test both administrator and non-administrator access before relying on its counts.


## Historical end-of-season coach evaluations

The database already has basic `historical_evaluations` and `historical_ratings` tables. They do not yet provide the full import/matching workflow. The feature branch now contains a local-only migration draft, `20261107020000_historical_coach_evaluation_schema.sql`, which extends those tables and adds `historical_evaluation_import_rows` for staging and administrator review. A static regression script, `scripts/test-historical-coach-evaluation-schema.cjs`, has been run locally; all 10 checks passed. The migration has **not yet been applied or validated against the local database**.

Matching rules:
- Prefer an exact permanent RWCLL Player ID when supplied, but flag conflicts with other identifying information.
- If the ID is absent, suggest possible matches using normalized names and available date of birth, source season, team, and division.
- Never link automatically on name alone. Ambiguous/no-match rows remain in review.
- Historical import rows never create a new player automatically. An administrator must confirm the player link or reject the row.
- Preserve original row data, source season/team/division/coach, match method, reviewer, and import lineage.
- Historical scores use the same 1–5 categories where mapped, but stay separate from current spring ratings and never affect current completion counts or averages.

Apply only to local Supabase after reviewing the migration and current local migration status. Do not run hosted migrations or `db push` without explicit approval. Coach access to historical player ratings must later be implemented through scoped server-side report access, not broad table permissions.


## Player reports and CSV export

Administrators can open **Player reports** from the workspace at `/protected/reports`, choose a season, open an individual player report, or export a season CSV.

- Current-season evaluations and historical coach evaluations are shown in separate sections. Historical scores are prior-season context only; they are never combined into current averages or completion counts.
- Reports display registration payment status, including Pending/Unknown values; payment status is not displayed in the evaluator rating UI.
- The individual report also shows current age-group averages for the five core skills, split between coach and independent-evaluator ratings. The season CSV labels rows as `CURRENT`, `CURRENT_GROUP_SUMMARY`, or `HISTORICAL_COACH`, includes the number of ratings behind scores/averages, and preserves historical source season, coach, division, team, and coverage note where available.
- Reports and exports are administrator-only in this first version because the historical tables are protected by administrator-only RLS. Do not expose historical ratings to coaches until scoped server-side authorization for their assigned players is implemented.
- Missing ratings remain absent rather than being written as zero. Players with no evaluation record are still represented in the CSV.
- Validate locally with `npm run test:player-reports`, `npm run test:all`, lint, TypeScript, and a production build. Then check a report with no current evaluations, a report with incomplete ratings, and a player with historical ratings.
