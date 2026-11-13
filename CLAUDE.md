# RWCLL Player Evaluations

Internal tool for Redwood City Little League (RWCLL) to run spring player evaluations and produce reports coaches use in the draft. About 30–50 users (admins, coaches, independent evaluators). No parent or player accounts.

**Hard deadline:** evaluation day is **January 23, 2027**. Goal is everything built and tested by **December 31, 2026**. Favor finishing and testing core workflows over polishing edge cases.

## Stack and environment

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, npm
  - Next.js 16 differs from older versions (for example, `proxy.ts` replaces `middleware.ts`). Before writing Next.js code, check the docs bundled at `node_modules/next/dist/docs/` and heed deprecation notices. `AGENTS.md` carries the same advice for other AI tools. `next dev` writes and maintains it, so keep it committed and don't hand-edit it.
- Supabase (PostgreSQL + Auth), run **locally** during development
- Windows, PowerShell, VS Code
- Local Supabase: Studio http://127.0.0.1:54323, API http://127.0.0.1:54321, Mailpit http://127.0.0.1:54324

## Commands

- `npm run dev`: start the app
- `npm run test:all`: runs every `test:*` script plus lint, TypeScript check, and production build. Reports go to `test-results/`.
- `npx supabase status` / `npx supabase start`: check or start local Supabase
- `npx supabase migration list --local`: see which migrations are applied locally. Check this before applying anything.
- `npm run fixtures:load -- --reset`: wipe local Supabase and load the fictional league (ask first)
- `npm run fixtures:generate`: rebuild the fixture CSVs from the roster and people files
- `npm run fixtures:load -- --reset --bare`: wipe local Supabase and create only the two admin accounts and seasons, for walking through setup in the app (`docs/TEST-PLAN-SEASON-SETUP.xlsx`) (ask first)
- `npm run e2e:evaluation-navigation`: browser test of the scoring screen in phone-sized Chrome. It needs `npm run dev` running and fixtures loaded with `--open-sessions`, cleans up after itself, and is not part of `test:all`. Run it after any change to the evaluation screen.

## Safety rules (always follow)

- **Never touch hosted Supabase** (no `db push`, `link`, remote SQL, or remote migrations) unless the user explicitly approves that specific operation in the current session.
- Confirm `.env.local` points at local Supabase before any database work.
- Never commit or print `.env`, `.env.local`, service-role keys, passwords, JWT secrets, or anything in `supabase/.temp/`.
- Do not reset, truncate, or delete data without asking first. Until live testing begins, all data in both local and hosted Supabase is disposable test data (user, 2026-11-10). Wiping it is fine once the user says yes, and nothing needs to be backed up. The hosted deny rules still apply: hosted operations need explicit approval.
- Do not discard uncommitted work. Check `git status` before starting.
- Do not commit staged import rows unless the user approves those specific rows.
- Say what was actually run and verified. Do not report something as passing unless the test ran in this session.

## How the season works

1. **Registration import.** Sports Connect registration CSVs are staged, reviewed by an admin, and committed row by row. All payment statuses are imported and eligible (Paid, Pending, Unpaid, Unknown, blank → `UNKNOWN`). The app tracks payment status but never gates on it, and payment status is not shown on evaluation screens.
2. **Prior-year context.** At the end of the previous season, each coach rated their own players on the same scales. Those ratings are imported as historical evaluations before spring evaluations.
3. **Spring evaluations (no teams exist yet).** Players are grouped by official Little League age (7–16), not by division. Coaches and independent evaluators score players live. Each player wears a season-specific evaluation (bib) number.
4. **Draft reports (main deliverable).** After evaluations, the app produces reports coaches use in the draft: current coach averages, independent evaluator averages, and prior-year coach ratings, kept clearly separate. The draft itself happens outside the app.
5. **Teams.** After the draft, players are assigned a division and a team. Coaches may be assigned to multiple teams.
6. **End of season.** Coaches re-rate their own players. Those ratings become next year's historical context.

## Product rules

**Roles and visibility**
- Accounts are invite-only, administered by league admins. No public sign-up.
- Coaches can evaluate players in any age group. Independent evaluators work their assigned group.
- Coaches never see other individual coaches' current-season ratings. They see group aggregates only. Independent evaluator identities are hidden from coaches.
- Coach averages and independent evaluator averages are always kept separate.
- Prior-year (historical) coach ratings are meant to be visible to the next year's evaluators and coaches.
- Admins see everything, including individual submissions, and can export.

**Ratings**
- Five required core skills: hitting, throwing, grounders, fly balls, running/awareness.
- Pitching and catching categories are available for all ages, optional, and never gated by division.
- `Not Evaluated` and blank optional ratings are not zero and are excluded from averages.
- Evaluators can edit their own saved ratings until the session is locked. Admin decides completion. Missing ratings are flagged, not blocking: evaluators can save with some core skills blank. The scoring screen offers Save & Next, Save, and Not Evaluated (`save_evaluation`, migration 20261110200000). Save stores status `submitted` and needs at least one core skill. Save Draft was removed from the screen (2026-11-11); the database still accepts `draft`, and older drafts show as "Draft (not counted)". Only submitted evaluations count in reports. Admin corrections after lock need a reason and audit entry.
- **Only players are rated. Coaches are never rated by anyone.** Names like `historical_coach_evaluation_*` mean ratings of players made by coaches.
- End-of-season coach ratings use the same form: 5 core skills plus optional pitching and catching.

**Accounts**
- One person can be both a coach and an independent evaluator, but needs two separate accounts. An account never holds both roles in the same season.

**Evaluation (bib) numbers**
- League admins assign bib numbers, not the app. They come in by upload (keyed by Sports Connect Player Id, or by name plus birthdate) or are edited in the app. They must be unique across the whole season's evaluation. The current unique index is per division and needs to change.

**Attendance and sessions**
- All registered players are expected at evaluations, including injured players (they attend but need not perform).
- Each session has one primary event and any number of makeup events. Attendance is tracked per event, separately from performance.
- Exemptions need an explicit admin decision, reason, approver, timestamp, and scope.

**Seasons, ages, divisions**
- Active divisions: AA, AAA, Majors, Juniors, Seniors. Requested division from Sports Connect is not a final assignment.
- Age is the official baseball age for the season (the synthetic test pack uses age as of August 31, 2027).
- A new season carries forward division setup only. No teams, coach assignments, or current evaluations carry forward. Historical end-of-season coach ratings are the one thing that feeds the next season.
- Closed seasons can be reopened only by an explicit, audited admin action.

**Player identity and imports**
- Internal player ID is independent of name, birthdate, and Sports Connect ID.
- Sports Connect Player IDs are matching evidence, not proof. The same child can show up with different IDs.
- Never auto-merge or auto-create a player from a historical row. Ambiguous matches wait for admin review.
- Use supplied registration and evaluation numbers. Never invent numbers during import.
- Out-of-scope programs (A, Tee Ball, Wiffle Ball, etc.) can be staged but are flagged and kept out of the evaluation pool.

## Built 2026-11-10 (local only; migrations not on hosted)

- **Draft reports** (`/protected/draft-reports`, migration 20261110220000):
  - All averages come from `private.session_player_summary`, through `draft_report` and `draft_report_sessions`.
  - Admins see every age group anytime. Coaches and independent evaluators see an age group only after it is released (evaluators added 2026-11-11, migration 20261111130000).
  - Default sort is evaluator overall. Columns sort on click, and rows expand to per-skill detail and the viewer's own ratings.
  - CSV and print are built. PDF is still a nice-to-have.
- **Lock and release** (migration 20261110210000): Sessions page with confirmations and an explainer.
- **Evaluation-day roster** (`/protected/roster`, admin): blank Check-in and Notes columns, bib or name sort, and "All ages" prints one age group per page.
- **Prior-year switch**, one per season, on the Sessions page. When on, coaches and evaluators see prior-year ratings while scoring (`prior_year_for_session`). Draft reports always include prior-year ratings.
- **Evaluation screen:** a player list with bib, name, LL age and status, plus bib search. A one-player scoring page has Previous/Next at top and bottom, Save & Next, and an unsaved-changes warning.
- **Bibs are unique per season** (index `player_seasons_unique_season_evaluation_number`).

## Built 2026-11-11 (local only; migrations not on hosted)

- **Player notes** (migration 20261111120000, test `test:player-notes-runtime`):
  - Coaches keep **private notes** (`private_notes`, one per coach per registration). Only the author can read them; admins can't, in the app or through the table. Editable anytime, including after lock and after the season closes. Not shown in later seasons.
  - Independent evaluators write **shared notes** (`evaluator_notes`, one per evaluation). They lock with the session. Admins see them anytime, with the author's name. Coaches and evaluators see them in the draft report after release, labelled only "Independent evaluator". Notes on drafts are hidden from coaches. Evaluators see only their own.
  - Reads go through `player_notes(session)` and `my_notes()`. Writes go through `save_private_note` and `save_shared_note`.
  - Screens: a notes box on the scoring page, a **My Notes** page (`/protected/my-notes`) for coaches and evaluators, and notes in expanded draft report rows (coaches can edit their private note there).

- **Evaluators see released draft reports** (migration 20261111130000), like coaches. `my_season_roles()` lets pages tell coaches from evaluators.
- **Players page** (`/protected/players`, admin; migration 20261111140000): search and filter the season's registrations (no bib, no age group, on site). Edit page fixes name, birthdate, age group and bib through `admin_save_registration` (audited; reason required for name, birthdate or age changes; age locked once the player has evaluations). Age set by hand is marked `league_age_source = 'admin'`.
- **On-site players** (`admin_add_onsite_registration`): walk-ups get `registration_source = 'on_site'`. When Sports Connect later lists them and the admin approves the match in import review, `commit_sports_connect_import_row` links the existing registration (keeps bib and age) instead of failing.
- **Bib upload** (`/protected/players/bibs`, migration 20261111150000): CSV keyed by Player Id or name + birthdate. Preview groups rows into new, change (admin ticks which to accept), conflict, same, held (no match yet; re-checkable), rejected. Never creates players. Matching lives in `private.match_registration`.
- **Prior-year upload** (`/protected/prior-year`, migration 20261111160000): rows matched to the chosen season's registrations as matched / review / held / invalid. Admin imports matched rows and confirms review rows; held rows can be re-checked or dismissed. Duplicate ratings are rejected. Never creates players.
- **People page** (`/protected/people`, migration 20261111170000): invite by email (single or CSV list), add or remove season roles, resend invites, disable or enable accounts. Uses `SUPABASE_SECRET_KEY` on the server only (`lib/supabase/admin.ts`). A trigger blocks coach + evaluator roles on one account in one season. Works with Supabase's default invite email (`components/auth-hash-handler.tsx` picks up the session from the link), and admins can skip email: "Give me a link" on invite, or the per-account Sign-in link (one-time `/auth/confirm` link, also for forgotten passwords). Hosted needs Site URL and Redirect URLs set; SMTP only if the app should send the emails.
- **Bulk import review** (migration 20261111180000): on an import batch, admins ignore all out-of-scope rows and approve-and-commit all clean rows (active division, age set, no warnings except payment, no same-name player, unused Player Id) in two clicks. The rest stay for row review.
- Test: `test:season-setup-runtime` (29 checks). Walkthrough: `docs/TEST-PLAN-SEASON-SETUP.xlsx` (built by `scripts/build-test-plan-season-setup.py`). Test-plan bibs use 901–903 and 950, outside the fixture range 201–548.
- **Admin UI polish (2026-11-11, no migrations):**
  - **Assignments** (`/protected/assignments`) covers age-group assignments only. Accounts and roles are on People. It has a "By age group" view, where the assignment type follows the person's season role, and a "By person" view: a who-scores-what overview plus age checkboxes saved in bulk (`setPersonAgeGroups`). Only Setup age groups change.
  - **Sessions:** closed seasons and the "Season-wide settings" box (prior-year switch, global schedules) start collapsed.
  - **People:** each row labels "Roles in <season>:", then a divider, then "+ Add a role…" offering only roles the account can take.
  - Home says "Welcome," instead of "Welcome back,".
- **Admin roadmap** (admin home page `/protected`, migration 20261111190000, test `test:admin-roadmap-runtime`):
  - Five stages: Before evaluations, Evaluation week, Evaluation day, After evaluations, End of season. `admin_season_roadmap(season, today)` returns all counts and the suggested stage in one call. The stage is worked out from data and event dates (rules in the migration header); the page passes today's Pacific date.
  - Each stage lists steps with a live status (done, needs attention, to do, tool, coming later) and buttons to the right page. Step rules live in `lib/roadmap.ts`. Admins can click any stage to look ahead or back; the top menu (with a "Roadmap" link) stays for anything off the map.
  - Desktop-first; admins do this on a laptop. End-of-season steps (teams, coach re-rating, close season) show as "coming later".
  - Coaches and evaluators get a "Your evaluations" card instead: evaluation date, their assigned age groups with times, location, makeups, and a Score or Draft report button (`my_evaluation_schedule()`).

## Built 2026-11-12 (local only; migration not on hosted)

- **Row review filter** (no migration): the import batch row review opens on "Needs work" and hides ignored and committed rows. Tabs show Ignored, Committed and All rows; ignored rows are reopened from the Ignored tab.
- **Coach divisions** (migration 20261112090000, test `test:coach-divisions-runtime`):
  - **Division ages** per season (`season_divisions.min_age/max_age`), edited on Sessions → Season-wide settings (`admin_set_division_ages`, audited). RWCLL defaults: AA 7–9, AAA 8–11, Majors 10–12, Juniors 13–14, Seniors 15–16. Ranges overlap on purpose. New seasons copy the latest earlier season's ranges.
  - **Coach divisions** (`coach_divisions`, coaches only, not carried forward). The people import reads "Division Name". Rows with the same email merge their divisions. Names that aren't divisions this season (Tee Ball, Other) are shown struck through and skipped. The People page shows and edits them. `admin_set_coach_divisions` adds (import) or replaces (People page), audited. Removing the coach role drops them.
  - **Assignments → From divisions**: `division_assignment_preview` lists each coach's ages (union of their divisions' ranges). "Add N assignments" (`apply_division_assignments`) only adds, only to Setup age groups, and adds nothing on a second run. Audited with the count. Coach names show their divisions everywhere on the page, e.g. "Avery Smith (AA, Juniors)".

- **Prior-year upload reads the Sports Connect export** (no migration; parser in `lib/prior-year-csv.ts`, test `test:csv-imports`). Rating columns match by skill name or code, with or without a "DR " prefix ("DR Running-Awareness"). Players with no ratings are skipped. DR Total, Easy Rating, User Email and Order No are ignored and never stored (only recognised columns go into `source_data`). "AA Ball - Little League Baseball" becomes AA. The coach name comes from Team Name after the last " - " unless there's a Coach Name column. The season box defaults to the latest closed season.
- Prior-year season comes from a "Program Name" (or "Season") column when present, else the page's season box.
- **Bibs from Registration Number at import** (migration 20261112120000, test `test:bib-from-registration-runtime`): committing a Sports Connect row sets the bib from Registration Number when it's a whole number and unused in the season. Otherwise the bib stays blank and the audit entry's `bib_note` says why. Walk-ups keep their on-site bib. The bib upload is the fallback when Registration Number isn't filled in at import time.
- **Spreadsheet line numbers** (migration 20261112130000): bib and prior-year review pages say "Line N", matching Excel's row number even when rows were skipped or blank. `readCsv` and the Sports Connect preview count blank rows (`parseCsvLines`); the app sends `line` and `stage_bib_import` / `stage_prior_year_import` store it.
- **Bib upload accepts "Registration Number"** (where the league keeps bibs in Sports Connect). `findHeader` now prefers earlier aliases, so Evaluation Number or Bib wins when a file has both.
- **Expected-columns panel on every CSV upload** (`components/csv-template.tsx`, lists in `lib/csv-templates.ts`): column list with required/optional, "Download blank CSV" (UTF-8 with BOM for Excel), and "Copy headings" (tab-separated, pastes into row 1). Templates are tested against their own parsers.

## Built 2026-11-13 (local only; migration not on hosted)

- **Coach trimmed mean** (migration 20261113090000, test `test:coach-trimmed-runtime`): the draft report shows, in parentheses after each coach average, the coach average with that skill's single highest and single lowest coach score left out. Per skill, only where 3 or more coaches scored it (ties drop once). The trimmed overall averages the five core skills using the trimmed value where there is one and the normal mean otherwise, and appears only when at least one core skill was trimmed. Coaches only: evaluator and prior-year averages are never trimmed. Returned in `skill_averages.coach_trimmed` and `skill_averages.coach_trimmed_overall` from `private.session_player_summary` (no signature change). Also in the per-skill rows, pitching and catching columns, print legend and CSV ("(high/low dropped)" columns). Data Review and the admin player report show age-group averages, so they are unchanged.

## Tracked additions (confirmed requirements, not yet built)

- **Retire the team-scoped coach report** (`/protected/coach-reports`, `coach_historical_report*`). It's superseded by draft reports and no longer linked from the evaluation screen or the top menu (the pages and functions still exist).
- **Age chart upload.** Admin uploads the official age chart for each season. (The 2027 chart is built in: `lib/data/age-chart-2027.json`.)
- **Possible-duplicate player flag.** Flag players with the same name and birthdate for admin review and merge.
- **Shared test server.** Vercel + hosted Supabase is running; `SUPABASE_SECRET_KEY` is set on Vercel (2026-11-11). Hosted needs every 2026-11-11 migration and Site URL / Redirect URLs (user-run steps; see docs/FAQ.md). The hosted plan can't edit email templates, so the app doesn't depend on them.

## Working preferences

- UI suggestions are welcome. The user isn't attached to the current design. Propose changes that make screens cleaner and easier to use, especially for admins and for scoring on phones.

## Known issues and open decisions

- **Coach access to historical ratings is scoped to current team assignment** (`coach_historical_report_roster`, `coach_historical_report`). Decided 2026-11-10: replace with access to all rated players, as described under Tracked additions. Not yet built.
- **One registration per Sports Connect Player Id per season** (`player_seasons_season_external_player_id_uidx`). Decided 2026-11-10: keep this rule. Repeated Ids are data errors, so the app flags them and holds later rows in import review.
- Documentation drift: some docs still describe implemented migrations as proposed, describe division-based evaluation, or say pitching/catching is AAA-and-up only. Reconcile against actual code.
- Remaining security checks: confirm admin reports and CSV export still work.
- `.claude/settings.json` denies Supabase CLI commands that reach the hosted project. A hosted deployment is a step the user runs or explicitly approves.

## Test data (local)

All local data is disposable. Rebuild it with `npm run fixtures:load -- --reset`, which wipes local Supabase and loads the **pre-evaluation** fictional league. Ask the user before wiping. Details are in `rwcll-fictional-test-league/README.md`.

- Season Spring 2026 (id 1, closed) and Spring 2027 (id 2).
- 290 registrations ages 7–16, 287 with bibs. Harper Oak (PLY-008) stays in import review because of the duplicate Player Id.
- 36 prior-year coach ratings of players (2 rows left pending), 10 age-group sessions in Setup with events and assignments.
- 18 accounts: `admin.jordan@example.com`, `coach.avery@example.com`, `eval.kendall@example.com`, and so on. The password is `FIXTURE_PASSWORD` in `.env.local`. Never print it.
- Fixtures are regenerated with `npm run fixtures:generate`. Never hand-edit `generated/`.
- `npm run fixtures:load -- --reset --scored` also enters all 1,230 Spring 2027 evaluations through `save_evaluation`, signed in as each evaluator. It then checks the database averages against `scored/expected-draft-report.csv`. Sessions are left Open.

## Reference docs

`ROADMAP.md`, `docs/DECISIONS.md`, `docs/DATABASE-DESIGN.md`, `docs/FAQ.md`, `docs/IMPORT-WORKFLOW-DESIGN.md`, `docs/SECURE-WORKFLOW-TEST-PLAN.md`. The old ChatGPT handoff (`docs/archive/CHATGPT_HANDOFF.md`) is history only. Where it conflicts with this file or the code, this file and the code win.

## Working style

- Work on a feature branch. Make small, focused commits with clear messages.
- Before calling something done, run the relevant focused test, then `npm run test:all`.
- Read a migration fully before applying it locally. Apply migrations one at a time, never blindly.
- When a product decision isn't covered here, ask the user instead of guessing. Then record the answer in this file or `docs/DECISIONS.md`.
- Keep this file current: update "Tracked additions" and "Known issues" as work lands.
