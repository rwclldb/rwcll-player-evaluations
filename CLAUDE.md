# RWCLL Player Evaluations

Internal tool for Redwood City Little League (RWCLL) to run spring player evaluations and produce reports coaches use in the draft. About 30–50 users (admins, coaches, independent evaluators). No parent or player accounts.

**Hard deadline:** evaluation day is **January 23, 2027**. Goal is everything built and tested by **December 31, 2026**. Favor finishing and testing core workflows over polishing edge cases.

## Stack and environment

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, npm
- Supabase (PostgreSQL + Auth), run **locally** during development
- Windows, PowerShell, VS Code
- Local Supabase: Studio http://127.0.0.1:54323, API http://127.0.0.1:54321, Mailpit http://127.0.0.1:54324

## Commands

- `npm run dev`: start the app
- `npm run test:all`: runs every `test:*` script plus lint, TypeScript check, and production build. Reports go to `test-results/`.
- `npx supabase status` / `npx supabase start`: check or start local Supabase
- `npx supabase migration list --local`: see which migrations are applied locally. Check this before applying anything.

## Safety rules (always follow)

- **Never touch hosted Supabase** (no `db push`, `link`, remote SQL, or remote migrations) unless the user explicitly approves that specific operation in the current session.
- Confirm `.env.local` points at local Supabase before any database work.
- Never commit or print `.env`, `.env.local`, service-role keys, passwords, JWT secrets, or anything in `supabase/.temp/`.
- Do not reset, truncate, or delete data (including synthetic test data) without explaining the effect and getting approval.
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
- Evaluators can save drafts and edit their own submissions until the session is locked. Admin decides completion. Missing ratings are flagged, not blocking. Admin corrections after lock need a reason and audit entry.

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

## Tracked additions (confirmed requirements, not yet built)

- **Draft reports for coaches (top priority).** Decided 2026-11-10 (see `docs/DECISIONS.md`):
  - One report per age group. Default sort is overall average; other sorts where practical.
  - Coach averages, independent evaluator averages, and prior-year coach ratings in separate columns.
  - CSV first; PDF is a nice-to-have.
  - Coaches see reports only after the admin locks the session (lock = release, assumption to confirm). Admins see them anytime.
- **Evaluation-day roster printout.** Per age group, no ratings, sortable by bib number or last name, first name.
- **Prior-year ratings for all players.** Coaches can see prior-year ratings for every rated player (data will be sparse). Always shown in draft reports. During live evaluations, an admin on/off setting controls it (default off).
- **Age chart upload.** Admin uploads the official age chart for each season.
- **Possible-duplicate player flag.** Flag players with the same name and birthdate for admin review and merge.

## Known issues and open decisions

- **Coach access to historical ratings is scoped to current team assignment** (`coach_historical_report_roster`, `coach_historical_report`). Decided 2026-11-10: replace with access to all rated players, as described under Tracked additions. Not yet built.
- No in-app way to invite or disable users. Public sign-up is off, so accounts are created in Supabase Studio or through the admin API for now.
- Documentation drift: some docs still describe implemented migrations as proposed, describe division-based evaluation, or say pitching/catching is AAA-and-up only. Reconcile against actual code.
- Remaining security checks: confirm admin reports and CSV export still work.
- `.claude/settings.json` denies Supabase CLI commands that reach the hosted project. A hosted deployment is a step the user runs or explicitly approves.

## Synthetic test data to preserve (local)

> **As of 2026-11-10 this data no longer exists locally.** The local database was rebuilt that day. It holds only season 1 (Spring 2027), the 5 divisions, rating categories, and one admin user. Fixtures for rebuilding it are in `rwcll-fictional-test-league/`. The list below describes what used to be there.

- Season Spring 2027 = season ID 1. Import batches #1, #6, and #8 are test data. Batch #8 has 3 committed rows (players 8, 9, 10) and 42 rows intentionally left in `needs_review`.
- Three test-only historical links (Drew Willow10, Avery Sandbox08, Morgan Pebble06). These are not real identity matches.
- Test team `TEST - AAA Coach Report` with Drew Willow10 and `coach-a-test@example.com` as head coach. `coach-b-test@example.com` is the unassigned coach. Passwords aren't documented; use the local reset flow through Mailpit.

## Reference docs

`ROADMAP.md`, `docs/DECISIONS.md`, `docs/DATABASE-DESIGN.md`, `docs/FAQ.md`, `docs/IMPORT-WORKFLOW-DESIGN.md`, `docs/SECURE-WORKFLOW-TEST-PLAN.md`. The old ChatGPT handoff (`docs/archive/CHATGPT_HANDOFF.md`) is history only. Where it conflicts with this file or the code, this file and the code win.

## Working style

- Work on a feature branch. Make small, focused commits with clear messages.
- Before calling something done, run the relevant focused test, then `npm run test:all`.
- Read a migration fully before applying it locally. Apply migrations one at a time, never blindly.
- When a product decision isn't covered here, ask the user instead of guessing. Then record the answer in this file or `docs/DECISIONS.md`.
- Keep this file current: update "Tracked additions" and "Known issues" as work lands.
