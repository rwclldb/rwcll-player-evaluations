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
- `npm run demo:load`: wipe local Supabase and load the board demo (scored league staged as a live evaluation day dated today; registrar account `registrar.riley@example.com`; includes `--teams`). Run sheet and slides: `docs/board-demo/` (ask first)
- `npm run demo:draft-day`: jump an already-loaded league (usually the board demo) to draft day without wiping it: every fixture score not yet entered is saved through `save_evaluation` (scores already there, including live demo scoring, are kept), every age group is locked and released, and teams and drafts are added if missing. Safe to run twice. Hosted: `fixtures:load -- --hosted --confirm-project=<ref> --draft-day` (the user runs it)
- `--teams` on `fixtures:load`: teams and staff from the volunteer report (Teams upload), coach's kids linked, sibling groups, and the Juniors, Majors and AAA drafts set up with a drawn order (not started)
- `npm run e2e:evaluation-navigation`: browser test of the scoring screen in phone-sized Chrome. It needs `npm run dev` running and fixtures loaded with `--open-sessions`, cleans up after itself, and is not part of `test:all`. Run it after any change to the evaluation screen.
- `npm run e2e:draft`: browser test of a mock Majors draft: the admin starts it, round 1's coach's kids go on automatically, a sibling decision, a coach's kid another team can't take, the Cubs manager's phone updating and showing Pause, the must-draft note, fixing a wrong pick from Team rosters, the projector and Finish. Needs `npm run demo:load` then `npm run demo:draft-day` (Majors draft not started) and `npm run dev`; puts the Majors draft back in setup afterwards. Not part of `test:all`. Run it after any change to the draft room, draft setup or rosters. `E2E_SHOTS=<folder>` also saves the board-deck screenshots.
- `npm run e2e:offline-scoring`: browser test of scoring with no signal (Chrome's offline mode): saves kept on the phone, the header badge, automatic sending when back online, and refused saves. Same needs as above; run it after any change to the evaluation screen too.

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
6. **End of season.** Each team's manager rates their own players in the app (admin opens and closes the window). Those ratings become next year's historical context.

## Product rules

**Roles and visibility**
- Accounts are invite-only, administered by league admins. No public sign-up.
- Coaches and independent evaluators score only the age groups they are assigned to (Assignments page; decided 2026-11-14, "for now"). A coach can be assigned to several age groups.
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
- End-of-season ratings use the same form: 5 core skills (blanks allowed and flagged) plus optional pitching and catching, or Not rated. Only the team's Manager rates, one rating per team and player (decided 2026-11-20).

**Accounts**
- One person can be both a coach and an independent evaluator, but needs two separate accounts. An account never holds both roles in the same season.

**Evaluation (bib) numbers**
- League admins assign bib numbers, not the app. They come in by upload (keyed by Sports Connect Player Id, or by name plus birthdate) or are edited in the app. They must be unique across the whole season's evaluation. The current unique index is per division and needs to change.

**Attendance and sessions**
- All registered players are expected at evaluations, including injured players (they attend but need not perform).
- Each session has one primary event and any number of makeup events. Attendance is tracked per event, separately from performance.
- Exemptions need an explicit decision, reason, approver, timestamp, and scope (attendance, evaluation, or both). Admins and registrars record them (decided 2026-11-17); everyone who can see the player sees "Exempt" and the scope, only admins and registrars see the reason and approver.

**Seasons, ages, divisions**
- Active divisions: AA, AAA, Majors, Juniors, Seniors. Requested division from Sports Connect is not a final assignment.
- Age is the official baseball age for the season (the synthetic test pack uses age as of August 31, 2027).
- A new season carries forward division setup only. No teams, coach assignments, or current evaluations carry forward. Historical end-of-season coach ratings are the one thing that feeds the next season.
- Closed seasons can be reopened only by an explicit, audited admin action.

**Birthdates (a child's name plus exact birthdate is sensitive; decided 2026-11-17)**
- Never shown in lists, to anyone. Lists show the LL age and a marker: "✓ DOB" (on file) or "! No DOB".
- Never shown to coaches or evaluators anywhere; they see the Little League age only.
- Admins and registrars see one birthdate at a time: on the player edit page (hidden until Show or Change) or with Show on an import row. Every reveal is audited (`birthdate_revealed`).
- Nobody reads birthdate columns directly: `players.date_of_birth`, staged import birth dates and `source_data` have no SELECT grant; use `has_birth_date`, `reveal_birthdate` and `import_batch_candidates`. New columns on players, sports_connect_import_rows, bib_import_rows or historical_evaluation_import_rows need their own `GRANT SELECT (...)`.
- The audit log never stores birthdates; handled import rows forget them. No column encryption for now (Supabase encrypts storage and backups; matching needs the dates in the database).

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
  - CSV, print and PDF are built (PDF added 2026-11-16).
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

## Built 2026-11-13 (local only; migrations not on hosted)

- **Coach trimmed mean** (migration 20261113090000, test `test:coach-trimmed-runtime`): the draft report shows, in parentheses after each coach average, the coach average with that skill's single highest and single lowest coach score left out. Per skill, only where 3 or more coaches scored it (ties drop once). The trimmed overall averages the five core skills using the trimmed value where there is one and the normal mean otherwise, and appears only when at least one core skill was trimmed. Coaches only: evaluator and prior-year averages are never trimmed. Returned in `skill_averages.coach_trimmed` and `skill_averages.coach_trimmed_overall` from `private.session_player_summary` (no signature change). Also in the per-skill rows, pitching and catching columns, print legend and CSV ("(high/low dropped)" columns). Data Review and the admin player report show age-group averages, so they are unchanged.

- **Admin score correction** (migration 20261113120000, test `test:admin-correction-runtime`): Data Review shows "View / correct" on every evaluation card. The page (`/protected/evaluation-review/[evaluationId]`) shows the scorer, all scores, experience answers and status like the scoring screen, and saves through `admin_save_evaluation_correction` (reason required; before and after audited as `evaluation_admin_corrected`; original submitted time kept; returns false and writes nothing when unchanged). Works in Open, Locked and Released age groups (Released shows a warning that coaches can already see the report); refused in a closed season. The scorer is not notified. Cards show "Corrected by admin". The workflow guard now lets an authorized correction delete a single rating or answer in a locked session; deleting the evaluation stays blocked. The old `admin_correct_evaluation` is unused.
- **1,000-row limit fixed** (`lib/supabase/fetch-all.ts`): Data Review, the admin Reports CSV export and the admin player report's age-group comparison now page through all rows (Supabase returns at most 1,000 per request). Data Review was showing 1,000 of 1,230 fixture evaluations and the export was truncated.

- **Cleanup before demos (2026-11-13)** (migrations 20261113150000, 20261113160000):
  - Coach reports retired: `/protected/coach-reports` deleted, `coach_historical_report` and `coach_historical_report_roster` dropped. Draft reports cover prior-year ratings for every rated player.
  - Supabase starter leftovers deleted (tutorial, hero, logos, auth/logout buttons). Public sign-up removed entirely: `/auth/sign-up` only says accounts are managed by an administrator; no `signUpAction`, no `ALLOW_PUBLIC_SIGNUP`.
  - Wording: menu "Reports" is now **Season Export**; page titles match the menu (Data Review, Season Export, Sports Connect Import); "Phase 5.x" text removed; back links say "Roadmap" on admin pages and "Home" on pages coaches use.
  - **Edit a person** on People: Edit next to the name changes the name and sign-in email (`updateAccount`; email via the auth admin API, confirmed immediately, password unchanged; refused if the email is taken). Audited as `account_name_changed` / `account_email_changed`.

- **Coach's kids** (migration 20261113170000, test `test:coach-kids-stars-runtime`): `player_seasons.is_coach_kid`, per season, not linked to any coach. The app only records and shows it (league draft rules change often): a "Coach's kid" badge on the scoring list and page, Players page (with a "Coach's kids" filter), printed roster ("CK"), and draft report (badge, print, CSV column). Admins set it on a player's edit page (`admin_set_coach_kid`, audited) or through an optional "Coaches Kid" column (Yes/No) in the Sports Connect registration file; unclear values are flagged in the preview. Players are scored as usual.
- **Private stars** (same migration): `player_stars`, toggled with `toggle_player_star`. On the draft report, a star before each name and a "My stars" filter; CSV has a Starred column. Only the owner can read their stars (admins can't). Allowed for players in age groups the person can open (scoring access, or released draft reports).
- **Re-import sync** (migration 20261113180000, test `test:reimport-sync-runtime`): the full Sports Connect export can be staged again any time.
  - At staging, `private.sync_import_batch` compares each row whose Player Id is already registered this season (and appears once in the file) with that registration. New `review_state` values: `up_to_date`, `has_changes`, `changes_reviewed`; the row stores `existing_player_season_id` and `sync_changes`.
  - Applied automatically (audited `registration_synced_from_import`): payment status, Registration Number (when no other registration has it) and a missing bib from Registration Number.
  - Waits for the admin's tick on the batch page's "Players already registered" panel (`apply_import_row_changes`): name, birthdate, age group (blocked once the player has scores), bib that differs (blocked if taken) and Coaches Kid. Unticked changes keep the app's values; "Keep app values" reviews a row without changes. A value edited in the app after staging is never overwritten.
  - Same Player Id with a different name and birthdate stays in row review with a flag (probably another child). Rows whose Player Id and division were ignored in an earlier batch this season are ignored again (audited `sports_connect_import_rows_auto_ignored`).
  - "Registered but not in this file" lists players missing from the export (`import_batch_missing_registrations`). Nothing is ever removed.
  - Row review has an "Already registered" tab and refuses decisions on those rows. Requested division isn't stored on registrations, so division changes aren't compared.

## Built 2026-11-14 (local only; migration not on hosted)

- **Your account** (`/protected/account`, migration 20261114090000, test `test:my-account-runtime`): every signed-in person opens it from the account icon in the header (email shown on wide screens) or "Your account" in the phone menu. Shows the sign-in email (read-only; admins change it on People), roles with seasons and coach divisions (`my_account()`), a name form (`set_my_display_name`, audited `account_name_changed` with the owner as actor), and a password change that checks the current password first (throwaway client, so session cookies are untouched), needs 8+ characters, and is logged as `account_password_changed` (`log_my_password_change`; the password is never stored). Home says "Welcome, <name>".
- **Imports page** explains that uploading the full export again is safe.
- **Coach list re-import** (no migration; comparison in `lib/people-sync.ts`, checks in `test:csv-imports`): the People page's "Invite from a list" compares each email with the existing account and season role. Statuses: New account, Add role, Changes, Up to date (collapsed, unticked), Can't add (evaluator listed as coach or the reverse). New divisions are added; divisions the coach has but the file doesn't list get an unticked "Remove" box (only when the file has a division column); a different name gets an unticked "Use the file's name" box. List imports no longer overwrite an existing name unless ticked (the single-invite form still sets it). People with a role this season who aren't in the file are listed only.
- **Delete an account** (People → "Delete…", migration 20261114120000, test `test:account-delete-runtime`): only for accounts with no scores, no shared evaluator notes, no team coaching and no linked prior-year ratings; never admins or yourself (`admin_account_delete_blockers()` says why, shown in the popup; otherwise Disable). `admin_delete_account` does everything in one transaction: removes age-group assignments and private notes, clears "done by" columns, writes `account_deleted` (email, name, roles, divisions, what was removed), then deletes the auth user (roles, profile, divisions and stars cascade). The audit log's link to accounts was dropped so history keeps the deleted person's id.

## Built 2026-11-15 (local only; migration not on hosted)

- **Registrar role, part 1: evaluation day** (migration 20261115090000, test `test:registrar-runtime`):
  - `registrar` is a per-season role (People page, invite form). It can be combined with coach or evaluator. `lib/my-roles.ts` (`getMyRoles`, `onlyRegistrar`, `runsEvaluationDay`) drives menus and page access; the database checks every action (`is_registrar`, `can_register` = admin or registrar for the season).
  - Registrars read the season's registrations, player names and their season (new SELECT policies). They don't read sessions, assignments, scores, notes or draft reports; a registrar-only account is sent home from Evaluations, Draft Reports and My Notes. People, Sessions, Assignments, Data Review, Season Export and the prior-year upload stay admin-only.
  - **Home** for registrars is "Evaluation Day" (`app/protected/evaluation-day-hub.tsx`): next event day, a big Check players in button (with "X of Y here" on the day), Add a walk-up, Print rosters, Who scores when. Menu: Check-in, Walk-ups, Rosters, Who scores when.
  - **Check-in** (`/protected/check-in`, registrars and admins): day picker from `checkin_days`; list from `checkin_list(season, date)`, every player whose age group has an event that day. On a makeup day, players checked in at an earlier event of their age group or already scored are left out. Search by name or bib, age filter, "Not here yet"/"Everyone". Tapping toggles `toggle_checkin` (`player_checkins`, one per player per event; audited `player_checked_in` / `player_check_in_undone`); undo shows "Undone: ...". Players tapped on the screen stay listed so a quick tap can be undone. "+ Bib" sets a bib with `set_registration_bib` (unique in the season, audited `registration_bib_set`). Refreshes every 30 seconds.
  - **Walk-ups**: `admin_add_onsite_registration` allows registrars; `/protected/players/new` sends registrars back to check-in.
  - **Rosters** open to registrars for their season. **Who scores when** (`/protected/timetable`, `registrar_timetable`): each age group's times and places with coach and evaluator names, by age group or by person, printable.
  - **"Here" marker**: coaches and evaluators see "Here" on the scoring list for players checked in at their age group's event today, Pacific time (`session_checked_in_today`).
  - Admin roadmap: Evaluation day has a "Check players in" step; Evaluation week's rosters step links Who scores when.
- **Registrar role, part 2: registrations** (migration 20261115120000, test `test:registrar-imports-runtime`):
  - Registrars run the Sports Connect import (stage, row review, bulk review, commit, re-import changes), the bib upload, and the Players page (edit name, birthdate, age group, bib, coach's kid; walk-ups) for their own season. The 15 functions behind those pages now check `can_register` for the season of the batch, row or registration instead of `is_admin` (error text unchanged). Pages gate on `is_admin_or_registrar()`; RLS limits what they read (`import_batches` of type players/bibs, staged rows and bib rows through `is_registrar_for_batch`).
  - The player edit page reads `registration_history` and `registration_has_scores` (yes/no) instead of `audit_log` and `evaluations`, so registrars never read those tables.
  - Menu for registrars: Check-in, Players, Imports, Rosters, Who scores when; the home page adds Players and Registration imports cards. The Imports page hides the prior-year button from registrars; back links say "Home".
  - Fixed with it: after a re-import, the bib upload held every player as "on more than one registration" because already-registered rows counted as waiting in import review (`private.match_registration`).

## Built 2026-11-16 (local only; no migration)

- **Offline scoring** (`e2e:offline-scoring`):
  - The scoring screen (`app/protected/evaluations/scoring-session.tsx`) is now a client component. The page loads the whole open age group once (players, your evaluations with ratings and answers, notes, prior-year, Here) and the player list, bib search, Previous/Next and Save & Next run on the device. The URL still follows the player (`?player=`) through `history.pushState`; Back works. Same labels and field names as before.
  - Saves go through `saveScores(payload)` (`actions.ts`), which returns a result instead of redirecting and doesn't call `revalidatePath` (that re-downloaded the whole age group after every save). The old form action `saveEvaluation` and `unsaved-guard.tsx` are gone; the unsaved-changes warning lives in the screen.
  - No signal (browser offline, or the request fails): the save is kept in localStorage (`lib/offline-queue.ts`, one list per signed-in person, newest save per player), the player shows "On phone (not sent)", and Save & Next still moves on. A Save needs at least one core skill on the device too, so queued saves aren't refused later for that.
  - `OfflineStatus` (`components/offline-sync.tsx`, in the header on every page) shows "N not sent" and sends the saves when the connection returns, on any page, every 15 seconds while anything waits. An expired sign-in keeps the save and retries after signing in again. A save the server refuses (age group locked, for example) turns the badge red with the reason and waits for Send now or Discard.
  - Not covered: reloading the page while offline shows the browser's offline page (no service worker). Saved scores are safe on the device and are sent the next time the app is opened online.

- **In-app help** (`/protected/help`, test `test:help-content`): guides for coaches (the coach quick start), independent evaluators and registrars, all in `lib/help.ts`. Each guide prints or saves as a PDF (the quick-start sheet to hand out). Reached from the Help icon in the header (phone menu: Help), "How to score" on the scoring screen, Help on Check-in, and "How imports work" on Imports. The index puts the reader's own guides first ("For you"). `[[Label]]` marks on-screen labels; the test fails when a label no longer exists in the app or a help link points at a missing section.

- **Scoring progress** (`/protected/progress`, admin; migration 20261116090000, test `test:scoring-progress-runtime`): per age group, each assigned coach and evaluator with a progress bar (done = saved + not evaluated, out of players registered at that age), last save time, not-evaluated and draft counts, and players checked in today. Open age groups first; a banner counts who has started and names anyone quiet for 15+ minutes. Refreshes every 30 seconds. Counts only (`admin_scoring_progress(season)`). Linked from the Evaluation day roadmap step "Watch scoring progress".
- **Show-password eye** (`components/password-input.tsx`): sign-in, set-password and Your account password boxes have an eye button to show the typed password. Shown only on touch screens (`@media (pointer: coarse)`), per the user's request.

- **View as (read-only preview)** (People → "View as", migration 20261116120000, test `test:view-as-runtime`):
  - For accounts with a role that have signed in at least once; never admins or yourself. `previewLink` makes a one-time magic link and records a SHA-256 of its token (`admin_create_preview`); the admin opens it in a private window. `/auth/confirm` calls `start_preview_from_token`, which marks that sign-in session (JWT `session_id`) as a preview in `preview_sessions`, whatever the link's `next`, and puts back the person's real `last_sign_in_at`.
  - Read-only: `proxy.ts` refuses every server action from a preview session (403), and `save_evaluation`, `save_private_note` and `save_shared_note` refuse too (`private.in_preview()`). The header shows a purple banner (`current_preview()`) with End preview (`/auth/end-preview`, a GET route: `end_preview` and sign-out) in place of Sign out.
  - The `rwcll_preview` cookie only words messages ("Admin preview is read-only: nothing is saved", `app/protected/error.tsx`, the scoring screen) and stops the offline queue; normal sign-in, sign-out and ordinary links clear it. Audited: `account_preview_link_created`, `account_preview_started`.

- **QR codes** (`/protected/qr`, admins and registrars; no migration; `qrcode` package, `lib/qr.ts`, test `test:qr-and-redirects`): a printable sheet with a large "Scan to open RWCLL Evaluations" code, the coach quick start, and one code per age group that opens its scoring list (`registrar_timetable` for the list). Codes use the app's own address (`lib/app-origin.ts`), so print them from the hosted site; the page warns on localhost. Printed help guides carry an "open the app" code (print only). Linked from the registrar home and the Evaluation week rosters step.
- **Back to the scanned page after signing in**: when signed out, `proxy.ts` sends people to `/auth/login?next=<page>`; the sign-in form passes it on and `loginAction` returns there. `lib/safe-next.ts` only allows `/protected...` paths (no other sites, `//`, backslashes or line breaks). A wrong password keeps `next`.

- **Invites on the roadmap** (migration 20261116150000, test `test:roadmap-invites-runtime`): the roadmap steps "Invite coaches and evaluators", "Make sure everyone can sign in" and "Help someone sign in" list who hasn't signed in yet (`admin_people_not_signed_in(season)`: coaches, evaluators and registrars, not disabled), with roles and invite date, an **Email invite again** and a **Sign-in link** button per person, and "Copy all emails". Open by default when 5 or fewer. People actions accept `returnTo` (checked by `safeNext`) so they come back to the roadmap. The roadmap's `not_signed_in` now counts registrars and each person once; `unassigned` still leaves registrars out.

- **Draft report PDF** (no migration; `jspdf` + `jspdf-autotable`, loaded only when the button is used; `lib/draft-report-pdf.ts`): a PDF button next to CSV and Print downloads the table as shown (same sort order and My stars filter). Landscape Letter; heading with the sort, the filter and when it was made; a legend; per row star, bib, player (CK), evaluator, coach (high/low dropped) and prior-year overalls, then each core skill plus pitching and catching as "E / C (trimmed) / P"; flags. Header row repeats on each page. Made in the browser, so no server load.

## Built 2026-11-17 (local only; migration not on hosted)

- **Exemptions** (migration 20261117090000, test `test:exemptions-runtime`):
  - `player_exemptions`: one active per registration, scope `attendance` / `evaluation` / `both`, reason (5+ characters), optional "approved by" name, who recorded it and when. Replacing or removing keeps the old row (`revoked_at`, `revoke_reason`). Audited `player_exemption_set` / `player_exemption_revoked`. No direct table access.
  - Admins and registrars record and remove them on the player edit page (`set_player_exemption`, `revoke_player_exemption`; details via `registration_exemption`). Players page: Exempt badge and filter (`season_exemptions`).
  - Everyone who can see the age group gets only the scope (`session_exemptions`): "Exempt" badge on the scoring list and page, the draft report (badge, CSV "Exempt" column, PDF), check-in.
  - Check-in: players exempt from attending are left out of "Not here yet", the "X of Y here" count (home and check-in) and makeup-day lists (`checkin_list` returns `exempt_scope`). Scoring Progress leaves players exempt from evaluation out of "of N players".

- **Birthdate protection** (migration 20261117120000, test `test:birthdate-protection-runtime`):
  - Column privileges: no SELECT on `players.date_of_birth`, staged rows' `birth_date` / `birth_date_text`, or `source_data` of bib and prior-year uploads; each table has a generated `has_birth_date`. `reveal_birthdate(kind, id, context)` returns one birthdate to admins and registrars (prior-year rows: admins) and logs `birthdate_revealed`. `import_batch_candidates(batch)` compares names and birthdates in the database for the import batch and Row Review pages (every player, not the first 1,000). `checkin_list` no longer returns birthdates; the scoring screen shows LL age only.
  - Screens: `DobMarker` ("✓ DOB" / "! No DOB") on Players, the walk-up page, import pages and the upload preview; `RevealBirthdate` ("Show", logged) on import rows, bib rows, prior-year rows and re-import birthdate changes; the player edit page's `BirthdateField` stays hidden until Show or Change and sends `birthDateMode=keep` so `admin_save_registration(..., p_keep_date_of_birth)` keeps the stored birthdate without reading it. Printed rosters have no birthdate column. Change history shows "Birthdate changed" / "Birthdate shown".
  - Copies: an `audit_log` insert trigger replaces birthdate values with "(hidden)" (and adds `date_of_birth_changed`); 660 existing entries were scrubbed once (the immutability trigger was switched off for that statement only; logged as `audit_birthdates_hidden`). Staged Sports Connect, bib and prior-year rows forget birthdates once handled. Re-import comparisons keep an md5 of the app's birthdate, not the dates. Ignored Sports Connect rows lose theirs too, so a reopened row commits without a birthdate.
  - The upload preview's "download issues" CSV still includes the file's own birthdate value, to fix it in Sports Connect.

- **Season close and reopen** (migration 20261117150000, test `test:season-close-runtime`): Season page `/protected/seasons/[id]` (admin; "Close…"/"Reopen…" on the roadmap's Seasons list, and the End of season "Close the season" step). Checklist from `admin_season_close_check` (open age groups block; the rest warn). `admin_close_season` / `admin_reopen_season` need a reason (10+) and the season name typed; audited `season_closed` (with the checklist) / `season_reopened`; `seasons.closed_at` / `closed_by`. A trigger refuses changing `is_closed` through the API (signed-in users), so every change goes through the audited functions. History from `admin_season_status_history`.

- **Possible duplicates** (migration 20261117180000, test `test:duplicate-players-runtime`): `/protected/players/duplicates` (admins; button on Players with the count, roadmap step "Check for duplicate players" in Before evaluations). Pairs of player records across all seasons are flagged for same name (case and spaces ignored) and birthdate, same name with a birthdate missing, or the same Sports Connect Player Id (`private.possible_duplicate_pairs`; birthdates compared in the database, never returned). `admin_possible_duplicates()` returns both records' registrations (season, age, bib, Player Id, scores, check-ins) and prior-year counts. **Merge** (`admin_merge_players(keep, remove, reason)`, audited `players_merged`) moves registrations, prior-year ratings and import links to the kept record and deletes the other. A season both are registered in keeps the registration with scores (or the kept record's); the other's check-ins, stars, exemptions and import links move, a coach's two private notes are joined, and its bib and Sports Connect ids fill gaps. Refused when both have scores or that season is closed, and for pairs that aren't flagged. **Not a duplicate** (`admin_dismiss_duplicate`, reason, `player_duplicate_dismissals`) hides a pair; **Flag again** (`admin_restore_duplicate`). Both audited.

- **Birthdate triggers run as owner** (migration 20261117200000): `private.forget_handled_import_birthdates` and `private.audit_log_hide_birthdates` are SECURITY DEFINER, so writes with the secret key (the fixture loader) work. Before this, `npm run fixtures:load` failed at the prior-year step with "permission denied for schema private".
- **Board demo** (2026-11-14, no migration): `npm run demo:load` (`--demo` on the fixture loader, `--demo-date=YYYY-MM-DD` optional). Ages 7–8 open and partly scored (coach Avery hasn't started age 7), 9–12 locked and released, 13–16 locked, 46 check-ins, an exemption, coach's kids, a duplicate walk-up, Avery's stars and notes. `docs/board-demo/DEMO-SCRIPT.md` is the run sheet; `RWCLL-Player-Evaluations-Board.pptx` the backup deck with speaker notes and the board questions. **Live-site version** (`LIVE-DEMO-SCRIPT.md`, the user runs `fixtures:load -- --hosted --confirm-project=<ref> --demo`): `--board-seats=N` (default 6) adds coaches `board1@example.com`... assigned to age 8 so board members score on their own phones, then watch age 8 get locked and released. The loader reuses accounts that survive a wipe (password reset, name restored).

- **Admin top bar grouped** (no migration; `components/app-nav.tsx`, `components/app-header.tsx`): admins see Roadmap, **Players ▾** (Players, Imports, Possible duplicates), **Evaluations ▾** (Sessions, Assignments, Scoring progress, Data Review), **Evaluation day ▾** (Check-in, Rosters, Who scores when, QR codes), **Reports ▾** (Draft Reports, Season Export) and People, in one row from 1024px (`lg`). On the right: Help and an account menu (Your account, Light/Dark/System, Sign out or End preview). The seconds clock and the separate theme switch and Sign Out button are gone. Below `lg` the menu button lists the same groups. Coaches, evaluators and registrars keep their short flat menus.

- **Draft report flags explain themselves** (no migration; `app/protected/draft-reports/report-flags.tsx`): each flag (No bib, Not rated, N blank skills, N not evaluated, and for admins N unsubmitted drafts) is a button that opens what it means. Admins also get Fix links: the player's page (No bib, Not rated), Scoring progress (Not rated), and each scorer's View / correct page for that player (drafts, Not Evaluated marks, saved evaluations with blank core skills; loaded by `loadScoreIssues` in the page from `evaluations` + `ratings` + `user_profiles`). Coaches see the explanation and "A league admin can fix this." CSV, PDF and print keep the plain labels. Coach help mentions tapping a flag.

## Built 2026-11-15 (local only; migration not on hosted)

- **Announcer role** (migration 20261117220000, test `test:announcer-runtime`; decided 2026-11-15):
  - `announcer` is a per-season role (People: invite form and "+ Add a role"). It can be combined with other roles. `is_announcer`, `can_announce` (admin, registrar or announcer). Announcers see names, bibs, ages, Here and Exempt only, through `announce_list`; no player tables, scores, notes, birthdates or reports. `lib/my-roles.ts`: `announcerSeason`, `callsPlayers`, `callingSeason`; `onlyEventStaff` (was `onlyRegistrar`) keeps registrar- or announcer-only accounts out of Evaluations, Draft Reports and My Notes.
  - **Call players** (`/protected/announce`; announcers, registrars, admins): day picker (`announce_days`), age group tabs, a big **Next up** (next 5 bibs here and not called), "X of Y called · Z here", Hide players not here, find by bib or name; everyone in bib order, not-here greyed. One tap marks a player called at that event (`toggle_call`, `player_calls` one per player per event, no direct table access; audited `player_called` / `player_call_undone`); tap again undoes. Refreshes every 20 seconds. Home for announcers: `AnnouncerHub` (Call players with today's count, Who scores when; `registrar_timetable` now allows announcers). Menus: announcers Call players + Who scores when; registrars add Call players; admins under Evaluation day (Call players, End-of-day check).
  - **Scoring screen**: "Called" badge per player and a **Now up** strip (latest 5 calls today, tap to open the player) on the list and each player; `session_calls(session)` loaded once, then `todaysCalls` every 20 seconds while online. List badges sit under the name.
  - **Scoring progress**: "N called" per age group; per scorer "N called by the announcer but not scored by this coach/evaluator yet" (`admin_scoring_progress` gained `called` and `called_not_done`).
  - **End-of-day check** (`/protected/end-of-day`, admin, printable; `admin_call_gaps`): called but a score missing (names the assigned scorers with no saved or Not Evaluated score), checked in but never called (age groups where calling was used), never checked in (after the main day, where check-in was used; not exempt). Roadmap steps: "Call players up" (Evaluation day), "Check nobody was missed" (After evaluations).
  - **Draft report**: "Not called" flag (explained; admins get End-of-day check and the player's page), only in age groups where calling was used, not for players exempt from evaluation.
  - **Makeup days**: check-in and calling lists now leave out players called at an earlier event or already scored, instead of anyone checked in earlier, so a child who came but was never called or scored is listed again.
  - Help: announcer guide; coach/evaluator scoring lists **Called** and **Now up**; registrar home and makeup wording. Demo loader adds `announcer.alex@example.com` and calls for the scored players in ages 7–8.

## Built 2026-11-16 (no migration)

- **DOB marker on handled import rows** (`components/import-row-dob.tsx`): committed, ignored and already-registered Sports Connect rows forget their birthdate copy, so the batch page and Row Review used to say "! No DOB" for every committed row. They now show the player record's birthdate (✓ Show / ! No DOB, labelled "player record"), and ignored rows show a dash. Both pages also page through all rows instead of `.limit(5000)` (capped at 1,000).

## Built 2026-11-16 (migration not on hosted)

- **Season backup** (migration 20261118090000, test `test:season-backup-runtime`): Season page → "Download season backup" (also Roadmap → Seasons → Backup, and steps in After evaluations and End of season). `admin_season_backup(season)` (admins) returns every season table as JSON and audits `season_backup_downloaded` with row counts; the route `app/protected/seasons/[id]/backup/route.ts` adds `draft_report` per age group and zips (`fflate`) readable CSVs (draft-report, scores, players, prior-year, people, schedule), `tables/*.csv` and a README (`lib/season-backup.ts`). Never birthdates (only `has_birth_date`), private notes, stars, import staging rows or the audit log. The app does not restore from it.
- **Full database copy and restore** are user-run steps in docs/FAQ.md ("Backups", "Start fresh"). `backups/` is git-ignored.

## Built 2026-11-19 (local only; migration not on hosted)

- **Teams, coach's kids and siblings: draft step 1** (migration 20261119090000, test `test:teams-families-runtime`; spec `docs/DRAFT-SPEC.md`):
  - **Teams** (`/protected/teams`, admins and registrars of the season): teams per division, each with one Manager, one Coach and any assistants (`team_coach_assignments.assignment_role` is now `manager` / `coach` / `assistant_coach`; `head_coach` became `manager`). Staff need the coach role this season; a person can be on only one team per division (trigger). Writes only through audited functions (`admin_save_team`, `admin_delete_team` (no players), `admin_set_team_staff`); no direct writes to `teams` or `team_coach_assignments`. Page data from `team_setup(season)` (coach emails only for admins).
  - **Teams upload** (`lib/teams-csv.ts`, `TEAMS_TEMPLATE`): one row per team (Division, Team, Manager Email, Coach Email, Assistant Emails) or the Sports Connect volunteer report as is (Team Manager → manager, Coach → coach, Assistant Coach → assistant; "Unallocated" rows skipped; two managers or coaches flagged). `admin_import_teams(season, rows, apply)`: the preview runs the same code and rolls back. Blank manager/coach keeps the current one; assistants are added, never removed.
  - **Coach's kids and siblings** (`/protected/teams/families`): `coach_kid_links` (player → parent account, a coach this season; twins are two links; linking sets the "Coach's kid" label, unlinking keeps it) and `sibling_groups` / `sibling_group_members` (grouping overlapping groups joins them). `family_overview(season)` feeds the page. No direct table access.
  - **Suggestions from the registration file:** the import page computes SHA-256 of the lower-cased "User Email" in the browser and sends only that (`accountKey`); `set_import_account_keys` stores it on `sports_connect_import_rows.account_key` (no SELECT grant). Players sharing a fingerprint are suggested as siblings; a fingerprint matching a season coach's sign-in email (`private.email_key`) suggests that coach's kid. Accept, or dismiss (`admin_dismiss_family_suggestion`). The fixture loader sends fingerprints too (fixture emails are unique, so it makes no suggestions).
  - **Roadmap:** a sixth stage, **Teams and draft**, between After evaluations and End of season (`suggestedStage`: the database's "end" becomes "draft" until the season is closed). Steps: teams with manager and coach, coach's kids linked, siblings and suggestions, release first, then the coming draft steps. Numbers from `teamsSummary` (team_setup + family_overview).
  - Menus: admins get **Draft ▾** (Teams, Coach's kids and siblings); registrars get Teams. Registrar help has a "Teams, coach's kids and siblings" section. Season backup includes the new tables.

- **Draft setup: draft step 2** (migration 20261120090000, test `test:draft-setup-runtime`; rules checks in `test:admin-roadmap-runtime`):
  - **Drafts** (`/protected/drafts`, admins and registrars): every division, oldest first, with pool and must-draft counts; "Set up a <division> draft" (`admin_create_draft`) copies the rules of the same division's draft in the latest earlier season (`copied_from_draft_id`), else defaults (top age must-draft, 12 per team, snake, open, coach's kids in rounds 1 and 2, siblings together, ask at the pick, no timer).
  - **Setup page** (`/protected/drafts/[seasonDivisionId]`, data from `draft_setup`): a "before the draft can start" box (`setupChecks` in `lib/drafts.ts`: teams, missing manager/coach, order not set or out of date, unreleased age groups, must-draft players vs roster spots, unrated players, kids outside the pool); Rules (`admin_save_draft_settings`, frozen once status leaves `setup`); Teams and first-round order (random draw `admin_draw_draft_order` or by hand `admin_set_draft_order`, both audited; per-team roster size `admin_set_draft_roster_size`); Coach's kids with their round (`admin_set_kid_round`; default from the rule: fixed rounds in order with the manager's kid first, else the round suggested from rank = ceil(rank / teams)); the Pool, ranked by evaluator then coach overall, with filters and per-player Change… (take out or move to another division's pool) and Add, each with a note (`admin_set_pool_override`, `admin_move_pool`; `division_pool_overrides`, audited).
  - **Pool rule** (`private.division_pool`): not on a team; overrides first (out here, or in elsewhere, removes); age within the division's range; then coach's kid of this division's Manager or Coach (must draft, within the age range), must-draft age, "Pool by age only", requested division, or left over from another division's finished draft (`draft_leftovers`, filled by step 3). Requested division comes from the latest Sports Connect row linked to the registration (`private.season_requested_divisions`; exact name, or the name plus a space or dash, so "Softball Majors" isn't Majors). Walk-ups have no requested division. A player can be in two pools (an 11 who asked for Majors is also must-draft in AAA); the setup page says "Also in AAA pool".
  - Tables `drafts`, `draft_teams`, `draft_kid_rounds`, `division_pool_overrides`, `draft_leftovers`; no direct access. Menus: Draft ▾ → Drafts (admins), Drafts (registrars). Roadmap step "Set up each draft" is live (Juniors, Majors and AAA with an order = done). Registrar help: "Setting up a draft".
  - Default must-draft ages (`private.default_must_draft_ages`, migration 20261120100000): every age in Juniors (13 and 14), the top age elsewhere. A coach's kid outside the division's ages (a 9-year-old in Majors) stays out unless added by hand (confirmed 2026-11-19).

## Built 2026-11-21 (local only; migration not on hosted)

- **The draft room: draft step 3** (migration 20261121090000, test `test:draft-room-runtime`; screen rules in `lib/draft-room.ts`, checked in `test:admin-roadmap-runtime`):
  - **Start** (setup page "Start the draft…", `admin_start_draft`): needs teams, the order for every team and every age group in the division's range released. Freezes each coach's kid's team and round in `draft_kid_rounds` (team_id; round from the hand-set value or the rule; "picked by a round" kids have no round; kids beyond the listed fixed rounds get 40, i.e. only their team can pick them). "Placed before the draft" kids fill their slot at once (open drafts).
  - **Room** (`/protected/drafts/[seasonDivisionId]/room`, `draft-room.tsx`): polls `draft_board` every 3 seconds; `draft_players` loads ratings once (again when a new player appears). Board grid (rounds × teams, on-the-clock cell, "Must draft" marks, queued siblings shown in their slot, coach's kid / sibling / override labels); players list sortable by evaluator, coach, coach with high/low dropped, prior year and (for managers and coaches) their own scores, with Must / reserved kid / sibling badges and "Next best" (top player who can be taken now without an override). Phones get Players / Board / My team tabs. Projector view `?view=board`. Pick clock counts down from `clock_started_at` (no automatic picks).
  - **Picks** (`admin_draft_pick`, admins and registrars; the bar at the bottom of the room): place the player on the team immediately (`player_seasons.team_id` + `season_division_id`), so they leave every pool. Refused: another team's coach's kid, a sibling decision waiting, paused. Needs a note (kept on the pick, audited): a non-must-draft player on a marked pick (open drafts: the last N picks still to be made, N = must-draft players left who aren't reserved kids; reserved kid slots and queued sibling slots aren't counted), or a younger player in an oldest-first draft (tier = oldest age left among non-reserved players; `draft_tiers` records the round each age opened, for kid rounds within an age).
  - **Automatic picks** (`private.draft_advance`, after start, picks, decisions and resume): a coach's kid whose round has come, else a queued sibling. Siblings: must-draft or "always take" → queued for the team's next pick; "always send down" → noted pool override out + `draft_leftovers`; "ask" → `draft_sibling_asks`, answered with Take with next pick / Send down (`admin_draft_sibling_decision`).
  - Pause/Resume (`admin_pause_draft`), Finish (`admin_finish_draft`: everyone left in the pool goes to `draft_leftovers`, so they join the next division's pool when their age fits). No undo (Move player is step 4). Teams in a started draft can't be deleted (trigger).
  - **Who** (`private.can_watch_draft`): admins and registrars of the season run it; each team's Manager and Coach in the division watch (stars via `toggle_player_star`, private notes via `save_private_note`). `my_drafts()` feeds a Drafts card on the home page ("Watch the draft"). Same privacy as the draft report: averages only, plus the viewer's own scores.
  - Roadmap step "Run the Juniors, Majors and AAA drafts" is live. Help: coach "Watching the draft", registrar "Running the draft".

- **Draft-sized fixtures** (2026-11-21; migration 20261121100000): the generator adds 76 draft players, families and a 27-team volunteer report (`generated/sports-connect-volunteers-teams-spring-2027.csv`); `--teams` loads them through the app's functions. The youngest division (AA) has no default must-draft age (`private.default_must_draft_ages`), so a 9 who asked for AAA isn't pulled into AA. `docs/TEST-PLAN-SEASON-SETUP.xlsx` was rebuilt with the new counts (`python scripts/build-test-plan-season-setup.py docs/TEST-PLAN-SEASON-SETUP.xlsx`).

## Built 2026-11-22 (local only; migration not on hosted)

- **Team rosters: draft step 4** (migration 20261122090000, test `test:team-rosters-runtime`):
  - **Team rosters** (`/protected/team-rosters`, admins and registrars; `roster-board.tsx`, data from `season_rosters`): every division with its teams, staff (emails for admins only), players and how each got there (`private.placement`: round and pick, coach's kid, sibling, moved with the note, placed); unplaced players grouped by the pool they're in; the last 100 moves. Find by name or bib.
  - **Move player** (`admin_move_player(player, team | NULL, note)`): to any team this season or back to the pool, any time, note required; `roster_moves` + audit `roster_move`. Back to the pool while the player's draft is live or paused removes the pick (`draft_pick_removed`), so that slot is the next pick again: the way to fix a wrong pick. A moved drafted player stays on the draft board with "moved to <team>".
  - **Release** per division (`admin_release_rosters`, `roster_releases`; admins and registrars). Then each team's Manager, Coach and assistants see their team on **Your team** (`/protected/my-team`, `my_team_rosters()`, printable) and a home page card.
  - **CSV** (`/protected/team-rosters/export?season=`, `season_roster_rows`): one row per placed player: season, division, team, manager and coach (emails for admins only), player names, Player Id, Registration Number, bib, LL age, coach's kid, sibling group, placed by, requested division. UTF-8 with BOM; formula-like cells get an apostrophe.
  - Menus: Draft ▾ → Team rosters (admins), Team rosters (registrars). Roadmap step "Release rosters and export" is live. Help: coach "Your team", registrar "Team rosters and moves". Season backup includes draft picks, roster moves and releases.
- **Draft day jump** (no migration): `npm run demo:draft-day` (see Commands).

## Built 2026-11-23 (local only; migration not on hosted)

- **Make teams: draft step 5** (migration 20261123090000, tests `test:team-maker` (rules) and `test:team-maker-runtime`): any division can make balanced teams instead of a draft (RWCLL: AA, and Seniors when there's more than one team). `/protected/drafts/[seasonDivisionId]/make-teams` (admins and registrars; links on Drafts cards and Team rosters). `team_maker_data` gives the division's teams and players (its pool plus anyone already on its teams, who stay put) with evaluator, coach and prior-year overalls, sibling group and coach's-kid team. The balancing runs in the browser (`lib/team-maker.ts`, seeded): rating = mean of the ticked sources (median for players with none; nothing ticked = random), sizes at most 1 apart, coach's kids to the parent's team, sibling groups as one unit, then greedy lowest-total placement and pair swaps for even averages and, optionally, ages. Make again = new seed; players can be moved by hand. `admin_place_players` saves (refused while the division's draft runs, for players already on a team, or teams of another division); each placement is a `roster_moves` row of kind `team_maker`, one `teams_generated` audit entry keeps the settings. Rosters and the CSV say "Team maker". Roadmap "Make the AA teams" is live. Registrar help: "Making teams without a draft".
- **Test plans**: `docs/TEST-PLAN-DRAFT.xlsx` (new; teams, families, draft setup, the Juniors/Majors/AAA drafts with a coach watching, Make teams, team rosters, what must not work; built by `scripts/build-test-plan-draft.py`) and `docs/TEST-PLAN-SEASON-SETUP.xlsx` (prior-year numbers updated). Both use the shared builder `scripts/test_plan_xlsx.py`; run `python scripts/build-test-plan-<name>.py docs/TEST-PLAN-<NAME>.xlsx` (needs openpyxl). Keep them current when the screens or fixtures change.

- **Draft rehearsal: step 6** (no migration): `npm run e2e:draft` (see Commands; the room's player rows carry `data-player`, `data-must`, `data-reserved`, `data-queued`, `data-age` for it). The board demo has a "Teams and the draft" section in both run sheets (jump with `demo:draft-day` mid-talk) and five new deck slides (17 divider, 18 teams, 19 draft room, 20 managers' phones, 21 Make teams and rosters; 28 slides now); question 6 asks whether to run this year's draft in the app. Slide 3 still shows five stages.

## Built 2026-11-24 (local only; migration not on hosted)

- **Age chart upload** (migration 20261124090000, test `test:age-chart-runtime`; parser checks in `test:csv-imports`): Players ▾ → **Age chart** (`/protected/age-chart`; admins upload, registrars can look). Drop or choose the official Little League CSV (`JAN`…`DEC` birth years, then `AGE`, one row per league age; parser `lib/age-chart.ts`), check the preview grid and problems (a month in two ages, missing columns, bad ages or years), then save. `admin_save_age_chart` replaces the season's whole chart (`season_age_charts`, `season_age_chart_uploads`; no direct access; refused in a closed season; audited `age_chart_uploaded`). `season_age_chart(season)` feeds the page, the Sports Connect import preview (ages from the chosen season's chart; a season without one flags each row "No age chart for this season") and the player edit page. `age_chart_mismatches(season)` lists players whose age differs from the chart (birthdates compared in the database, never returned). Roadmap step "Upload the age chart" (Before evaluations). The migration fills Spring 2027 from the built-in chart; the fixture loader uploads `rwcll-fictional-test-league/little-league-baseball-age-chart-2027.csv` (not with `--bare`: the season-setup test plan uploads it in step 2.0).

## Built 2026-11-25 (local only; migration not on hosted)

- **End-of-season ratings by managers** (migration 20261125090000, test `test:team-ratings-runtime`; sheet and step rules in `lib/team-ratings.ts` / `lib/roadmap.ts`, checked in `test:admin-roadmap-runtime`):
  - Admins open and close the window per season on Draft ▾ → **End-of-season ratings** (`/protected/team-ratings`; `admin_open_team_ratings` / `admin_close_team_ratings`, audited `team_ratings_opened` / `team_ratings_closed`; `team_rating_windows`, no direct access; refused in a closed season). The page shows each team's manager (and whether they've signed in) with done / not rated / last saved (`admin_team_rating_progress`, counts only) and an Open link to the team's sheet.
  - Only the team's **Manager** rates (not coaches or assistants): a "Rate your players" home card while the window is open (`my_rating_teams()`), then `/protected/team-ratings/[teamId]` (`team_rating_sheet`, `rating-sheet.tsx`): phone-first list (To do / Rated / Not rated, core average, blanks), one player at a time with the scoring screen's `RatingInputs`, Save & Next (next player still to do), Save, Not rated, Previous/Next, `?player=` in the URL so Back works, and an unsaved-changes warning. After closing, read-only. Admins can save for a manager until the season closes (audit `by_admin`).
  - Saves: `save_team_rating(team, registration, ratings, not_rated)`: player must be on the team now; one core skill needed unless Not rated; refused in preview; audited `team_rating_saved` with the old scores. Stored as prior-year ratings: `historical_evaluations` (new `source_team_id`, `source_player_season_id`, `not_rated`, `updated_at`; `player_match_method = 'team_roster'`; one per team and player) + `historical_ratings`. Nothing to import next season.
  - **Prior-year averages** (`private.session_player_summary`) now use only seasons that start before the viewed season (ratings with no known season still count) and only ratings with scores, so a season's own end-of-season ratings never show as its prior year and Not rated counts as nothing.
  - Roadmap End of season: "Managers rate their players" is live (to do / needs attention while open / done). Season close checklist warns while ratings are open and counts players on teams with no rating. Coach help: "Rating your team at the end of the season (managers)". Test plan: `docs/TEST-PLAN-DRAFT.xlsx` Phase 9.

## Tracked additions (confirmed requirements, not yet built)

- **Test dates** (agreed 2026-11-20, next after end-of-season ratings): an admin-only tool, shown only when an env setting such as `ENABLE_TEST_TOOLS=true` is on (never on the real site), with buttons that move the season's session event dates rather than faking the clock: Make today evaluation day, Make today a makeup day, Make today the week before, and Put the dates back (the real dates are saved first). Audited; refused in a closed season. Draft day needs no date (`demo:draft-day`, and drafts start when an admin presses Start).

- **Teams and the draft** (approved 2026-11-19; spec `docs/DRAFT-SPEC.md`; steps 1–5 built; step 6, the rehearsal, is mostly covered by the draft fixtures, `demo:draft-day` and `docs/TEST-PLAN-DRAFT.xlsx`): teams with a Manager, Coach and assistants; coach's kids linked to a parent; sibling groups; per-division drafts (Juniors Feb 1, Majors Feb 2, AAA Feb 4, 2027) with pool rules, a draw, snake order and rule switches copied forward; a live draft room (admins pick; the division's managers and coaches watch, sort and keep stars and notes); undrafted players fall through to the next division; a team generator for AA (rosters by Feb 6) and Seniors; Move player with notes; a roster CSV.

- **Shared test server.** Vercel + hosted Supabase is running; `SUPABASE_SECRET_KEY` is set on Vercel (2026-11-11). Hosted needs every 2026-11-11 migration and Site URL / Redirect URLs (user-run steps; see docs/FAQ.md). The hosted plan can't edit email templates, so the app doesn't depend on them.

## Working preferences

- UI suggestions are welcome. The user isn't attached to the current design. Propose changes that make screens cleaner and easier to use, especially for admins and for scoring on phones.

## Known issues and open decisions

- **One registration per Sports Connect Player Id per season** (`player_seasons_season_external_player_id_uidx`). Decided 2026-11-10: keep this rule. Repeated Ids are data errors, so the app flags them and holds later rows in import review.
- Documentation drift: some docs still describe implemented migrations as proposed, describe division-based evaluation, or say pitching/catching is AAA-and-up only. Reconcile against actual code.
- Remaining security checks: confirm admin reports and CSV export still work. (2026-11-13: the export now includes every row; check the content.)
- Other queries that could return more than 1,000 rows should use `fetchAllRows` / `fetchAllByIds`.
- `.claude/settings.json` denies Supabase CLI commands that reach the hosted project. A hosted deployment is a step the user runs or explicitly approves.

## Test data (local)

All local data is disposable. Rebuild it with `npm run fixtures:load -- --reset`, which wipes local Supabase and loads the **pre-evaluation** fictional league. Ask the user before wiping. Details are in `rwcll-fictional-test-league/README.md`.

- Season Spring 2026 (id 1, closed) and Spring 2027 (id 2).
- 357 registrations ages 7–16, 354 with bibs (201–676). Harper Oak (PLY-008) stays in import review because of the duplicate Player Id. Sized like the real league (decided 2026-11-21): Majors ~110 asking (68 twelves), AAA, AA ~100, Juniors 26–27, Seniors 15. 76 generated draft players (DRF-001..., bibs 601–676) carry the draft scenarios in `generated/draft-families-spring-2027.csv`.
- 40 prior-year coach ratings of players (2 rows left pending), 10 age-group sessions in Setup with events and assignments.
- 18 fixture accounts: `admin.jordan@example.com`, `coach.avery@example.com`, `eval.kendall@example.com`, and so on; `--teams` adds 47 coach accounts from the volunteer report (`first.last@example.com`). The password is `FIXTURE_PASSWORD` in `.env.local`. Never print it.
- Fixtures are regenerated with `npm run fixtures:generate`. Never hand-edit `generated/`.
- `npm run fixtures:load -- --reset --scored` also enters all 1,502 Spring 2027 evaluations through `save_evaluation`, signed in as each evaluator. It then checks the database averages against `scored/expected-draft-report.csv`. Sessions are left Open.

## Reference docs

`ROADMAP.md`, `docs/DRAFT-SPEC.md`, `docs/TEST-PLAN-SEASON-SETUP.xlsx`, `docs/TEST-PLAN-DRAFT.xlsx`, `docs/DECISIONS.md`, `docs/DATABASE-DESIGN.md`, `docs/FAQ.md`, `docs/IMPORT-WORKFLOW-DESIGN.md`, `docs/SECURE-WORKFLOW-TEST-PLAN.md`. The old ChatGPT handoff (`docs/archive/CHATGPT_HANDOFF.md`) is history only. Where it conflicts with this file or the code, this file and the code win.

## Working style

- Work on a feature branch. Make small, focused commits with clear messages.
- Before calling something done, run the relevant focused test, then `npm run test:all`.
- Read a migration fully before applying it locally. Apply migrations one at a time, never blindly.
- When a product decision isn't covered here, ask the user instead of guessing. Then record the answer in this file or `docs/DECISIONS.md`.
- Keep this file current: update "Tracked additions" and "Known issues" as work lands.
- Keep the in-app help current: when a screen a coach, evaluator or registrar uses changes, update the matching section of `lib/help.ts` in the same branch. `test:help-content` catches renamed buttons but not changed behaviour.
