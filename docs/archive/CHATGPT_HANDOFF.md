# ChatGPT Project Handoff --- RWCLL Player Evaluations

**Last reviewed:** 2026-11-07\
**Purpose:** Resume work in a new ChatGPT conversation using verified
project state, decisions, implementation notes, and test results.

## 1. Project at a glance

-   **Project:** RWCLL Player Evaluations
-   **Repository:** `rwclldb/rwcll-player-evaluations`
-   **Working branch:** `feature/admin-evaluation-review` (verify with
    `git status` / `git branch`; do not assume all local changes are
    pushed)
-   **Local folder:** `D:\sandbox\GitHubRepos\rwcll-player-evaluations`
-   **Stack:** Next.js App Router, Next.js 16.4.4, React 19, TypeScript,
    Supabase (PostgreSQL + Auth), Tailwind CSS, npm.
-   **Developer environment:** Windows, PowerShell, VS Code.
-   **Purpose:** Internal league player evaluation workflow for
    approximately 30--50 users; no parent/player accounts.
-   **Source of truth:** Current checked-out repository files,
    migrations, tests, `ROADMAP.md`, `docs/DECISIONS.md`,
    `docs/DATABASE-DESIGN.md`, `docs/FAQ.md`, and this handoff. Confirm
    actual files and git state before relying on historical status
    below.

### Safety boundaries

-   `.env.local` is configured for **local Supabase** in the current
    development workflow. Verify before database operations.
-   Local Supabase URLs:
    -   Studio: `http://127.0.0.1:54323`
    -   API: `http://127.0.0.1:54321`
    -   Mailpit: `http://127.0.0.1:54324`
-   **Do not apply migrations, run SQL, or make any other changes to
    hosted Supabase without explicit user approval for that specific
    hosted operation.**
-   Preserve synthetic test records. Do not clean up, reset, truncate,
    or delete data unless the proposed effects are explained and the
    user explicitly approves.
-   Do not commit staged import rows beyond the exact rows the user has
    authorized.
-   Never commit credentials, `.env`, `.env.local`, service-role keys,
    passwords, JWT secrets, or Supabase local runtime state
    (`supabase/.temp/`).
-   The current test data is synthetic. Do not assume that a production
    import or real player data has been loaded.
-   Explain the scope and consequences before destructive operations.
    Prefer read-only inspection first.
-   Keep `CHATGPT_HANDOFF.md` current after substantial work. This
    document is a handoff artifact; updating it here does not itself
    modify the user's repository or push to GitHub.

## 2. Application and validation environment

-   Development is performed locally on Windows using PowerShell.
-   `npm run test:all` is intended to run all discovered `test:*`
    scripts (excluding itself), lint, TypeScript checking, and
    production build. Verify the current `package.json` and runner
    before assuming its exact behavior.
-   Test reports are written to `test-results/`.
-   The latest older consolidated validation recorded in the previous
    handoff was **12 passed, 0 failed**, finished
    `2026-11-05T23:11:01.482Z`. This is a historical result, not proof
    that the current working tree passes.
-   Later focused UI and report tests were reported passing by the user
    as noted below. The latest coach access manual tests also passed.
-   Static tests do not replace runtime database-security tests.
    Continue validating RLS, authorization, transaction rollback,
    retries/idempotency, audit events, and failure recovery using
    separate admin and non-admin accounts.

## 3. Confirmed product and data decisions

### Users, roles, and workflow

-   One league, approximately 30--50 users; no parent/player accounts.
-   Individual accounts; invitations administered by league admins.
    Public sign-up should be disabled/removed for the intended product.
-   Coaches may be assigned to multiple teams in a season.
-   Coaches can evaluate players in any division, subject to the
    applicable evaluator workflow and permissions.
-   Evaluators can search/evaluate players in their assigned division;
    coaches may evaluate players in any division.
-   Coaches should not see other coaches' ratings.
-   Coach and independent-evaluator ratings/averages remain separate.
    Coaches see group aggregates only; independent evaluator identities
    are hidden from coaches. Admins can inspect individual submissions.
-   Admins can inspect player-level reports and export data.
    

### Seasons, ages, divisions, and draft

-   Evaluation groups are organized by official Little League age, not
    by eventual division. An age group may contain players who
    ultimately enter different divisions.
-   Use the official baseball age rule and season-specific age chart.
    The documented rule for the current synthetic test pack is age as of
    August 31, 2027. Verify the official source and import the
    appropriate chart for each real season before production use.
	Should probably have a way for an admin to upload an age chart for a season.
-   Active baseball divisions: AA, AAA, Majors, Juniors, Seniors.
-   Division assignment occurs after evaluations/drafts; requested
    Sports Connect division is not a final assignment.
-   Draft order: Seniors → Juniors → Majors → AAA → AA. Although drafts are not
    part of this application. 
-   Top-age placement rule from user: players at the top age of a
    division must be drafted into that division if not placed higher
    (example: 11-year-olds not placed in Majors go to AAA even if
    younger, higher-rated players remain). Verify/encode official league
    rules and exceptions explicitly before production use.
-   The app is a supplement/guide, not the official draft or rostering
    system. Optional AA random team generation is
    advisory/admin-reviewed only.
-   Each player has at most one roster assignment per season.
-   Each player-season has a season-specific `evaluation_number`; it can
    be generated from an admin-selected starting number, manually
    overridden, or imported. It may remain null; it does not carry
    forward between seasons. This is the bib number that a player wears
	during live evaluations.
-   New seasons carry forward only editable division setup. Do not copy
    teams/team names, coach assignments, player evaluations, or
    historical results. Team names are assigned after evaluations.
-   The only thing carried forward are potential coach ratings of Players
    at the end of the season. These are combined into final draft reports after
	evaluations.
-   Seasons are closed by default after completion. Admin reopening for
    correction must be explicit and audited. Session locking is a
    separate workflow state.

### Evaluations, rubric, attendance

-   All registered players in active divisions AA--Seniors are expected
    to attend evaluations, even if injured. Injured players attend in
    person but need not perform.
-   Makeup dates are tracked separately from primary evaluation
    sessions.
-   Attendance is tracked separately for each primary and makeup event
    and separately from performance.
-   Admin-approved exemptions require an explicit decision, reason,
    approver, timestamp, and clear scope (attendance and/or evaluation
    requirement).
-   Absences are recorded and reported to admins. Players missing
    required evaluations are flagged for admin handling; unresolved
    required evaluation/attendance issues affect eligibility according
    to league policy.
-   Five required core skills: hitting, throwing, grounders, fly balls,
    running/awareness.
-   Pitching and catching categories should be available for all
    evaluation age groups, possibly unscored. Their availability must
    not depend on eventual division assignment. This supersedes an older
    decision-log statement that pitching/catching were optional only for
    AAA and above; reconcile/update documentation if that older wording
    remains.
-   `Not Evaluated` is not zero and is excluded from averages. Blank
    optional ratings are not zero.
-   Evaluators can save drafts, resume, and edit their own submitted
    evaluations until session lock. Admin determines completion; missing
    ratings/submissions are flagged but do not automatically block
    completion. Admin corrections after lock require a reason and audit
    trail.

### Player identity and Sports Connect imports

-   Stable internal player ID is independent of name/birthdate.
-   Sports Connect Player IDs are external identifiers and matching
    clues, not universal permanent RWCLL player IDs. Same external ID is
    evidence, not proof; changed ID is not proof of a different child.
-   Candidate matches require administrator confirmation. Do not
    silently merge based on name alone or create a player automatically
    from a historical row.
-   Import all registrations, including Pending/unpaid. All
    registrations remain eligible and should appear in player
    lists/details/reports and shown the evaluator UI.
    The app does not process payments or care about eligibility -- it merely tracks and reports it.
-   Out-of-scope programs/divisions (A, Tee Ball, Wiffle Ball, other
    non-active divisions) may be imported/staged but must be flagged for
    admin review and kept out of the active evaluation pool by default.
-   Use supplied registration/evaluation numbers when present; otherwise
    leave blank until assigned. Do not invent numbers or auto-number as
    part of import.
-   Duplicate nonblank Sports Connect Player IDs within one
    import/season require admin review; never auto-merge.
-   Registration payment status must be preserved by import commit;
    blank source status falls back to `UNKNOWN`.
-   Import review decisions and commit are separate actions. Only
    explicitly approved rows may be committed.

### Historical evaluations

-   Coaches rate their own players at the end of each year using the
    same rating scales as spring evaluations. Historical ratings are
    imported before the next spring evaluation so coaches can see
    prior-year coach ratings.
-   Historical ratings are read-only context and must remain separate
    from current-season evaluations, averages, and completion counts.
-   Preserve historical source season, source division, team, coach
    label, source player ID, category/score, coverage notes, and match
    provenance.
-   Matching supports permanent RWCLL Player ID where available and a
    fallback candidate workflow using names/details. Never silently
    match on name alone. However sports connect can have different Player IDs
	for the same player (not on purpose, but it happens). So there
	should be a way to flag players with same name/birthdate to combine them
-   Do not create a player automatically from a historical row.
    Ambiguous matches remain unresolved until administrator review.
-   Historical records should appear in reports alongside current group
    results, with clear labels distinguishing source season/team/coach.
-   Test-only crosswalks described later deliberately map different
    synthetic source names to synthetic current players; these are not
    real-world identity assertions.

## 4. Current local database and migration state

### Migration history

The following migrations have been reported applied to local Supabase
during this project. **This is a historical inventory, not a substitute
for checking `npx supabase migration list --local` before applying
anything.**

1.  `20261103170921_initial_schema_baseline.sql`
2.  `20261103180000_add_rls_auto_enable_event_trigger.sql`
3.  `20261103193000_restore_private_correction_authorizations.sql`
4.  `20261103194500_add_evaluation_workflow_triggers.sql`
5.  `20261103200000_restrict_audit_log_writes.sql`
6.  `20261104210000_add_sports_connect_staging.sql`
7.  `20261104220000_add_import_row_review_decisions.sql`
8.  `20261104230000_phase_5_5_sports_connect_commit.sql`
9.  `20261104233000_handle_existing_registration_in_import_commit.sql`
10. `20261104234000_add_duplicate_player_id_resolution.sql`
11. `20261104235000_enforce_ignored_import_row_terminal_state.sql`
12. `20261105180000_add_age_based_evaluation_sessions.sql`
13. `20261105200000_add_admin_evaluator_roster.sql`
14. `20261105210000_fix_evaluation_workflow_trigger_record_fields.sql`
15. `20261105220000_preserve_payment_status_on_import_commit.sql`
16. `20261107020000_historical_coach_evaluation_schema.sql`
17. `20261107030000_scoped_coach_historical_reports.sql`
18. `20261107040000_seed_active_divisions_and_link_seasons.sql`

There were earlier filename/timestamp references in old handoff sections
that differ from the current local migration names (for example, older
notes mention `20261105010000` and `20261105160000`). Use the actual
checked-out migration files and local migration list as authoritative.
Do not blindly apply an old migration name from a prior note.

**Hosted Supabase:** No hosted changes are authorized by this handoff.
Historical notes mention earlier remote testing/migrations, but the
current hosted migration state has not been freshly inspected. Never
infer local/remote parity.

### Supabase implementation notes

-   The local app `.env.local` points to local Supabase; verify before
    use.
-   Local admin account exists and has administrator privileges.
-   SQL Editor sessions may have `auth.uid() = NULL` and
    `is_admin() = false`; admin-only RPCs should be exercised through
    the authenticated application workflow, not by assuming SQL Editor
    has the user's auth context.
-   Sports Connect staging/commit/review RPCs are protected and require
    authenticated admin access.
-   The app server actions verify claims and admin status before calling
    RPCs.
-   `commit_sports_connect_import_row(p_row_id bigint, p_reason text)`
    is an admin-only SECURITY DEFINER RPC. It handles only approved
    new/matched rows, checks import type and season state, checks
    existing registration conflicts, creates/matches the player and
    registration, marks the row committed, increments batch count, and
    writes audit data. It does not assign final division/team.
-   `review_sports_connect_import_row(...)` is admin-only and records
    review decisions/reasons through the audit log. Do not expect a
    `review_reason` column on the import row.
-   The staging RPC signature is
    `stage_sports_connect_import(p_season_id bigint, p_source_file_name text, p_rows jsonb)`.
    The app must pass the matching named arguments/signature.
-   `player_seasons.season_division_id` can remain null after import.
    Requested Sports Connect division is not automatically final
    division assignment.

## 5. Sports Connect import safeguards and test data

### Implemented staging/review/commit behavior

-   Phase 5.0 stages imported rows in protected staging tables; it does
    not directly change `players` or `player_seasons`.
-   Admin review supports approved new-player creation and approved
    matching to an existing player.
-   Duplicate Player ID resolution records an admin's explicit
    investigation reason and timestamp. It does not bypass actual
    uniqueness constraints or make a true conflict safe.
-   Duplicate registration protection prevents duplicate player-season
    registrations and protects retry/idempotency behavior.
-   Committed rows cannot be edited through the review UI.
-   Ignored-row terminal-state enforcement and explicit reopen workflow
    exist in the migration history; inspect the actual current behavior
    before changing it.
-   Payment status is copied from staged import data into
    `registration_payment_status`, trimmed, with `UNKNOWN` fallback for
    blank source values.
-   Keep testing rejected operations, cross-batch/season conflicts,
    duplicate IDs, duplicate registration numbers, retries, rollback,
    audit behavior, and failure recovery.

### Synthetic import batches to preserve

-   Batch #1: eight synthetic rows; includes duplicate external Player
    ID `TEST-DUP` on staged rows 5 and 6. Row 6 was previously
    committed; row 5 has a recorded duplicate-warning resolution reason.
    Preserve unless cleanup is explicitly approved.
-   Batch #6: focused duplicate-ID resolution test. Staged row 15
    remains unresolved/uncommitted; row 16 was resolved and committed.
    Preserve unless cleanup is explicitly approved.
-   Batch #8: synthetic Spring 2027 registration export test pack, 45
    rows. Details below.
-   Older notes also mention remote synthetic batch #2 / staged row 9,
    approved but uncommitted. This is a historical remote artifact;
    inspect current remote state before any action. It is not
    authorization to modify hosted Supabase.

### Batch #8 --- Spring 2027 synthetic registration import

-   Batch ID: `8`
-   Import type: `players`
-   Filename: `synthetic_spring_2027_registration_export(1).csv`
-   Season: Spring 2027, local season ID `1`
-   Source workbook: `synthetic_spring_2027_registration_test_pack.xlsx`
-   45 rows, source rows 2--46, 45 unique external Player IDs
    (`970001`--`970045`), 45 unique order numbers, 34 unique nonblank
    registration numbers, 11 intentionally blank registration numbers.
-   All 45 rows passed source-level integrity checks. No duplicates or
    missing external Player IDs. All 45 rows were retained.
-   Payment statuses: 27 Paid, 9 Pending, 9 Unpaid.
-   Requested divisions: AA 5, AAA 10, Majors 8, Juniors 7, Seniors 15.
-   Little League ages: exactly five players per age, ages 8--16.
-   The test pack's Read Me states age is calculated as of August 31,
    2027; it includes cutoff boundary tests.
-   Requested division is not final division/team assignment. Do not
    infer a final roster assignment from it.
-   11 missing registration numbers were intentionally retained; do not
    invent numbers.
-   Exactly three rows were explicitly approved and committed locally:
    -   External ID `970006`, Morgan Pebble06, row ID 24, source row 7,
        age 9, requested AAA, registration `R27-20006`, Paid → player ID
        10, player-season ID 10.
    -   External ID `970008`, Avery Sandbox08, row ID 26, source row 9,
        age 9, requested AAA, registration blank, Paid → player ID 9,
        player-season ID 9.
    -   External ID `970010`, Drew Willow10, row ID 28, source row 11,
        age 9, requested AAA, registration `R27-20010`, Pending → player
        ID 8, player-season ID 8.
-   Verified local registrations:
    -   Player 10 Morgan Pebble06 / player-season 10 / external ID
        970006 / registration R27-20006 / age 9 / Paid.
    -   Player 9 Avery Sandbox08 / player-season 9 / external ID 970008
        / no registration number / age 9 / Paid.
    -   Player 8 Drew Willow10 / player-season 8 / external ID 970010 /
        registration R27-20010 / age 9 / Pending.
-   Batch #8 after those commits: 3 committed; 42 still `needs_review`,
    not committed. Preserve the other 42 rows. Do not approve/commit any
    additional row without explicit user approval.
-   The import commit did not assign a final division;
    `season_division_id` was null for these registrations immediately
    after commit.

## 6. Historical player ratings --- schema, source review, and three test links

### Source workbook review

-   Historical data is for Spring 2026.
-   User asked to use provisional coach labels `Coach AA##`, where `##`
    is the source spreadsheet number. These are placeholders, not
    verified coach identities.
-   Working workbook reviewed:
    `RWCLL_Historical_Ratings_Working_Copy_and_Spring_2028_Form_Draft_with_PlayerIDs.xlsx`,
    18 sheets. It includes Source Inventory, Pre-Import Review, Field
    Guide, Spring 2028 Form Draft, and Original Team 01--12 sheets.
-   Source records: 82 player rows across 12 AA team files, with
    synthetic source IDs `SYN-...`, all unique.
-   63 players have all five detailed ratings; 19 are listed but
    unrated; no partial detailed rating sets.
-   Eight Easy scores were entered as values (all Team 05); five
    formula-derived Easy scores from Team 11.
-   Team 05 has six cases where entered Easy differs from detailed
    average. Preserve both separately.
-   Detailed ratings are numeric 1--5. No invalid scores; detailed
    totals agree with cached source totals.
-   Rows with no ratings should not automatically create historical
    evaluations. Formula-generated zero totals for unrated players are
    not real ratings.
-   Source Player IDs are synthetic source identifiers, not database
    IDs. App player ID and player-season ID must be established through
    a separately reviewed crosswalk. Do not infer matches by name alone.
-   Spring 2026 season label and provisional coach placeholders were
    user-confirmed. Do not assume a Spring 2026 season row exists in the
    app database.

### Historical schema and report implementation

-   Existing `historical_evaluations` and `historical_ratings` tables
    were extended, not duplicated.
-   Migration `20261107020000_historical_coach_evaluation_schema.sql`
    adds source season/coach/import metadata, match provenance, category
    mapping fields, and protected `historical_evaluation_import_rows`
    staging with review states/idempotency constraints.
-   Historical tables have RLS enabled and admin-only policies. Coach
    access is provided through scoped SECURITY DEFINER RPCs, not direct
    table reads.
-   Migration `20261107030000_scoped_coach_historical_reports.sql` adds:
    -   `coach_historical_report_roster(p_season_id bigint)`: roster
        limited to teams assigned to the authenticated coach; admins can
        see all.
    -   `coach_historical_report(p_player_season_id bigint)`: verifies
        authentication and current team assignment (or admin) before
        returning historical data.
-   Admin player report:
    -   `app/protected/reports/player/[playerSeasonId]/page.tsx`
    -   Reads current evaluations/current ratings separately from
        historical evaluations/ratings.
    -   Historical section is labeled "Historical player evaluations".
    -   Clearly states prior-season source ratings are context only and
        do not affect current ratings, averages, or completion counts.
-   Coach report:
    -   `app/protected/coach-reports/player/[playerSeasonId]/page.tsx`
    -   Uses the scoped RPC and displays historical player ratings only.
    -   Coach roster page uses the roster RPC.
    -   Evaluator workspace links to coach report list.
-   Coach-facing historical report access is based on current team
    assignment. A coach assigned to multiple teams can see the assigned
    teams' roster; a coach not assigned to a player's team must not
    access that player's report.
-   Direct non-admin reads of historical base tables should remain
    denied by RLS.

### Three explicit test-only crosswalks

The user explicitly approved three test-only links. Source names and IDs
are preserved as historical source metadata; the links are not real
identity assertions.

  -------------------------------------------------------------------------------
  Current             Player ID / Historical    Source team / Historical ratings
  synthetic       registration ID source player coach         
  Spring 2027                                                 
  player                                                      
  ------------- ----------------- ------------- ------------- -------------------
  Drew Willow10             8 / 8 `SYN-0801`    Team 08 /     hitting 3, throwing
                                  (Kaden        Coach AA08    2, grounders 2,
                                  Murphy)                     fly_balls 1,
                                                              running_awareness 2

  Avery                     9 / 9 `SYN-0401`    Team 04 /     hitting 3, throwing
  Sandbox08                       (Brady        Coach AA04    2, grounders 3,
                                  Sullivan)                   fly_balls 3,
                                                              running_awareness 2

  Morgan                  10 / 10 `SYN-0101`    Team 01 /     hitting 1, throwing
  Pebble06                        (Logan        Coach AA01    1, grounders 1,
                                  Turner)                     fly_balls 1,
                                                              running_awareness 1
  -------------------------------------------------------------------------------

-   All three historical evaluations are labeled Spring 2026, division
    AA, with their source team, provisional coach, source player ID, and
    `manual_review` match provenance.
-   `source_season_id` is null; the source season label is Spring 2026.
    No Spring 2026 season row was created.
-   Exactly three `historical_evaluations` and 15 `historical_ratings`
    were inserted locally. No other historical records were imported.
-   User confirmed all three players' admin reports show their
    historical records.
-   Historical ratings remain separate from current-season
    ratings/averages/completion counts.
-   No hosted Supabase changes were made.

## 7. Coach-facing historical report authorization test --- complete

### Test setup

The user explicitly approved the following local-only setup: 1. Create
test team `TEST - AAA Coach Report`. 2. Assign Drew Willow10's existing
Spring 2027 registration (player-season ID 8) to that team. 3. Assign
`coach-a-test@example.com` as `head_coach`.

Relevant local IDs: - Spring 2027 season ID: `1` - Spring 2027 AAA
`season_divisions.id`: `2` - Drew Willow10: player ID `8`, player-season
ID `8`, Little League age `9` - Coach A account:
`coach-a-test@example.com` - Coach B account: `coach-b-test@example.com`

### Important division assignment detail

-   Immediately after import, Drew's `player_seasons.season_division_id`
    was null. This is expected because the import workflow does not
    treat requested Sports Connect division as a final division
    assignment.
-   The team foreign-key constraint requires the player-season row and
    team to share the same `season_division_id` and `season_id`.
-   For this test only, the user approved simulating a post-draft AAA
    assignment. The guarded local transaction set Drew's
    `season_division_id = 2` and `team_id` to the test team. This was
    done only for Drew's test registration and does not establish a
    general rule to copy requested divisions during import.
-   The previous attempted transaction failed its guard before making
    changes; the corrected transaction succeeded.

### Verified result

The user's final verification query returned exactly:

  --------------------------------------------------------------------------------------------------------------------------------------------
    team_id team_name   season_name   division_name   first_name   last_name     player_season_id coach_email                assignment_role
  --------- ----------- ------------- --------------- ------------ ----------- ------------------ -------------------------- -----------------
          1 TEST - AAA  Spring 2027   AAA             Drew         Willow10                     8 coach-a-test@example.com   head_coach
            Coach                                                                                                            
            Report                                                                                                           

  --------------------------------------------------------------------------------------------------------------------------------------------

### Manual authorization outcomes

-   Signed in as `coach-a-test@example.com`: Coach A successfully opened
    Drew's coach-facing historical report and could see the historical
    record. **PASS**.
-   Signed in as `coach-b-test@example.com`, who is not assigned to
    Drew's team: direct access to the same report URL returned **404**.
    This is the expected unauthorized outcome and avoids disclosing
    whether the player/report exists. **PASS**.
-   Together these tests confirm the coach report route enforces current
    team assignment for the tested assigned and unassigned coach cases.
-   This manual test does not prove every API/data path is secure. Still
    test direct historical-table reads as non-admin, empty roster
    behavior, multiple team assignments, and administrator behavior if
    not already covered.
-   Local test coach accounts exist. Password/reset state is not
    documented; do not assume credentials. Use the app's supported local
    auth/reset workflow.
-   The test team, team assignment, and coach assignment are synthetic
    local data and should be preserved unless cleanup is explicitly
    approved.

## 8. Division and season initialization --- local migration verified

**Migration:**
`20261107040000_seed_active_divisions_and_link_seasons.sql`\
**Status:** Reported applied to local Supabase and verified. No hosted
change.

The migration: - Seeds five active divisions if absent: AA, AAA, Majors,
Juniors, Seniors, sort order 1--5. - Backfills links between these
divisions and all existing open seasons. - Adds
`public.attach_default_divisions_to_season()` and an `AFTER INSERT`
trigger on `public.seasons` to attach the five divisions to newly
created open seasons. - Uses conflict-safe inserts; preserves existing
division records/links. - Does not seed or modify rating categories or
division/category mappings.

Local verification: - All 11 global rating categories exist: five core,
three pitching, three catching. - Exactly five division records exist,
sort orders 1--5, all `evaluations_enabled = true`. - Spring 2027 has
five linked divisions with season-division IDs 1--5. - A temporary test
season received five links through the trigger; test transaction was
rolled back. - Initial CTE test returned no rows because same-statement
snapshot hid trigger side effects; a separate INSERT then SELECT
confirmed the trigger. - Current age-based evaluation code reads global
`rating_categories` by category code. Division/category mappings are not
required for the current evaluator workflow. - `evaluations_enabled` had
no current references in inspected `app`, `components`, and `lib` code.
It remains true by default; no new app behavior was added. -
`app/actions.ts` still inserts only into `seasons`; the database trigger
supplies division links. - The migration and trigger test did not modify
players, registrations, evaluations, or staged import rows.

## 9. Evaluation review dashboard, reports, and exports

### Administrator evaluation review

On `feature/admin-evaluation-review`: -
`app/protected/evaluations/page.tsx` was updated so Pending
registrations are included in evaluator eligibility and empty-state
messaging was clarified. The evaluator UI excludes unpaid and `UNKNOWN`
statuses; this must be reconciled with the broader confirmed requirement
that Pending remains eligible and appears in player lists/reports but
not as a payment-status control on evaluation screens. Verify current
code and product wording. - Payment-status normalization trims
whitespace and lowercases values in evaluator workspace and
administrator review dashboard. -
`app/protected/evaluation-review/page.tsx` adds an admin-only, read-only
dashboard grouped by season and Little League age. - Dashboard reports
eligible registrations, players with evaluation records, players with no
evaluation record, draft/submitted/not-evaluated counts, evaluator
progress, and per-player core-rating totals/averages. - Age-group
core-skill summary separates coach vs independent evaluator ratings.
Averages use submitted evaluations only; contributing rating counts are
shown; missing scores are excluded, not treated as zero. - Link added to
`app/protected/page.tsx`. - Test `scripts/test-evaluation-review-ui.cjs`
and package script `test:evaluation-review-ui`. - User reported the
age-group summary tests passed and the UI looked correct on
2026-11-07. - A prior handoff noted a payment-status normalization
follow-up that had not yet been fully validated at that time. Confirm
latest test results before asserting full suite status.

### Administrator player reports and CSV export

On `feature/admin-evaluation-review`: -
`app/protected/reports/page.tsx`: administrator-only season
selection/player report list. -
`app/protected/reports/player/[playerSeasonId]/page.tsx`: individual
report with current-season evaluations separate from historical player
ratings. - `app/protected/reports/export/route.ts`: admin-checked CSV
export. `CURRENT`, `CURRENT_GROUP_SUMMARY`, and `HISTORICAL_PLAYER` rows
are distinct; rating counts and historical source metadata/coverage
notes are retained where available. - Workspace link added to
`app/protected/page.tsx`. - `scripts/test-player-reports.cjs`,
registered as `npm run test:player-reports`. - `ROADMAP.md` and
`docs/FAQ.md` updated. - User reported focused tests passed and
report/export UI worked on 2026-11-07. - No migration was needed for
admin report/export. - Coach-scoped historical report access is
implemented separately as described above.

## 10. Other import safeguards and earlier tests

### Duplicate Player ID resolution

Earlier migration name in one checkpoint:
`20261105160000_add_duplicate_player_id_resolution.sql`. Verify actual
local filename/history because later migration inventory used a
different timestamp.

The feature: - Adds resolution timestamp, resolving admin ID, and reason
fields to `sports_connect_import_rows`. - Adds admin-only RPC
`resolve_duplicate_player_id_warning(p_row_id bigint, p_reason text)`. -
Requires admin access, a 5--1000 character reason, an existing
uncommitted row, the exact duplicate warning, and no prior resolution. -
Writes audit event `sports_connect_duplicate_player_id_resolved`. -
Leaves the original warning visible. - Trigger blocks transition to
committed while duplicate warning is unresolved. - Resolution records
that an admin investigated the warning; it does not bypass unique
constraints or make a real identifier conflict safe. - UI/server action
includes `resolveDuplicatePlayerIdWarning`; review page/form display and
save the resolution reason. - Focused test:
`scripts/test-import-duplicate-player-id-resolution.cjs`, package script
`test:import-duplicate-player-id-resolution`. - User previously reported
this local test passed: unresolved duplicate-warning commit was blocked;
reason/timestamp recorded; resolved row committed. Test batch #6; staged
rows 15 (unresolved) and 16 (resolved/committed).

### Duplicate registration protection and commit behavior

-   Earlier notes refer to
    `20261105010000_handle_existing_registration_in_import_commit.sql`;
    current migration list uses
    `20261104233000_handle_existing_registration_in_import_commit.sql`.
    Verify actual checked-out files and migration history.
-   It prevents an approved-match import from creating a second
    registration for the same player and season, rejects conflicting
    commits without changing the existing player's identity or creating
    another registration, and supports retry idempotency.
-   An earlier remote duplicate-external-ID regression test reported
    SQLSTATE `23505`, no player or registration created, staged row
    remained approved/uncommitted, and no commit audit event was written
    for the rejected row. This is a historical remote test, not fresh
    verification and not authorization for further remote changes.

## 11. Documentation and repository notes

Expected documentation files: - `CHATGPT_HANDOFF.md` - `ROADMAP.md` -
`docs/DATABASE-DESIGN.md` - `docs/DECISIONS.md` - `docs/FAQ.md` -
`docs/SECURE-WORKFLOW-TEST-PLAN.md` - `docs/IMPORT-WORKFLOW-DESIGN.md` -
`docs/PROPOSED-DATA-MODEL-REVIEW.md` (check exact filename; older notes
contain a malformed escaped spelling)

Documentation drift was previously identified: - Some roadmap/decision
entries may still describe implemented schema/migrations as proposed or
not implemented. - Secure-workflow test plan may reference replacement
migration/regression filenames not present in an earlier archive. -
Reconcile against actual checked-out migration files and tests before
changing status. - Ensure the old division-based test plan is consistent
with the age-based evaluation model. - Ensure documentation states
pitching/catching categories are available across age groups and not
gated by eventual division. - Ensure Pending eligibility is described
consistently across import, player lists/reports, and evaluator UI.

## 12. Immediate next steps

1.  **Inspect current repository state first:** `git status --short`,
    current branch, latest commit, and complete diff. Do not overwrite
    or discard uncommitted work.
2.  **Synchronize documentation:** update `CHATGPT_HANDOFF.md`,
    `ROADMAP.md`, `docs/DECISIONS.md`, `docs/DATABASE-DESIGN.md`, and
    `docs/FAQ.md` with the verified historical report and authorization
    results:
    -   Coach A assigned to Drew's test team can view Drew's historical
        report.
    -   Coach B, not assigned to the team, receives 404 on the same
        direct URL.
    -   Test team `TEST - AAA Coach Report`, Drew registration
        assignment, and Coach A assignment are local synthetic test
        data.
    -   The Drew AAA division assignment was an explicit test-only
        simulated post-draft assignment, not an import default.
3.  **Complete remaining coach security checks:** test direct non-admin
    reads of `historical_evaluations` and `historical_ratings` (should
    be denied by RLS), Coach B's roster list (should not include Drew),
    and any alternate RPC/API paths. Verify admin reports and CSV export
    remain functional.
4.  **Review and run focused tests/full suite** after inspecting the
    current branch and migration list. Do not claim the old 12/12 suite
    is current.
5.  **Review actual local migration list** before applying anything. Use
    local-only commands after confirming `.env.local` and Supabase
    target. Do not apply all pending migrations blindly without
    inspecting them.
6.  **Resolve documentation drift** and reconcile older division-based
    security test plan with age-based workflow.
7.  **Continue remaining import regression testing** for duplicate
    IDs/registration numbers across batches and seasons, retries,
    transaction rollback, audit events, ignored/reopen semantics, and
    failure recovery.
8.  Keep batch #8's other 42 rows staged and uncommitted. Do not import
    the other 79 historical rated rows or any unrated historical rows
    without a separate reviewed crosswalk and explicit authorization.
9.  No hosted database changes unless explicitly approved.

## 13. Credentials, synthetic data, and file safety

-   Never commit `.env`, `.env.local`, Supabase service-role keys,
    database passwords, JWT secrets, auth tokens, or other credentials.
-   Supabase local runtime files under `supabase/.temp/` should not be
    shared or committed. An earlier archive reportedly included files
    from this directory; `/supabase/.temp/` is reported ignored by
    `.gitignore`. Verify `git status` and repository history if exposure
    is suspected.
-   If a real credential was committed or exposed, remove it from
    repository history as appropriate and rotate/revoke it in Supabase.
    Do not paste credentials into ChatGPT.
-   Synthetic test records are intentionally retained. Do not assume
    they should be deleted.
-   Any generated archive/copy is separate from the user's working
    repository unless explicitly installed there.
-   This handoff update does not push changes to GitHub or alter the
    user's local repository.

## 14. How to resume in a new ChatGPT conversation

Upload the latest project ZIP or connect the repository if available,
then say:

> Continue the RWCLL Player Evaluations project. Read
> `CHATGPT_HANDOFF.md` first, then inspect the current roadmap, decision
> log, database design, FAQ, import workflow documentation, migrations,
> tests, and git status. Confirm the current state before changing
> anything. Keep database work local unless I explicitly approve hosted
> changes.

At the end of each substantial work session, update this file with
verified state, changed files, test results, decisions, blockers, and
the single best next step. Keep it factual; distinguish confirmed
requirements, implemented code, and tested behavior.


## 2026-11-09 Stage 1 session administration update (prepared, not yet applied locally)
- User confirmed evaluation ages are 7–16; age 6 is excluded.
- User confirmed all payment statuses, including Unpaid and Unknown and blank where present, are eligible for rating. Payment status should not be shown on evaluation screens.
- Added migration `20261109090000_allow_all_payment_statuses_in_evaluations.sql`, which supersedes the earlier pending-only eligibility migration in database-side validation and scoped read policies.
- Added migration `20261109100000_add_evaluation_session_events.sql`: one primary event per session, multiple makeup events, date/start/end/location/notes, assigned-evaluator read access, immutable schedules after opening/season close, and database guard requiring a primary event plus an evaluator assignment before opening.
- Session admin UI/actions now schedule/edit/delete events in Setup, disable Open until primary event and evaluator assignment exist, and retain server/database checks. Session creation, evaluator assignment, evaluator workspace, and admin evaluation review age lists now include ages 7–16.
- Added `npm run test:session-administration` and `docs/STAGE_1_SESSION_ADMINISTRATION_TESTS.md`. Static tests passed in the packaged workspace. Dependency installation timed out in this environment, so lint/TypeScript/build/full-suite results for these new changes are not yet verified.
- These changes are prepared in a reviewed ZIP only. Do not assume the migrations are applied to local or hosted Supabase; apply to local only after inspecting migration status.


## 2026-11-09 Global schedule and return-to-setup update (static checks completed; build validation blocked by dependency install)
- User supplied `rwcll-player-evaluations-2026-11-08r3.zip` from branch `feature/admin-evaluation-review`; used that archive as the code baseline.
- Added a per-season Global primary event schedule UI with example defaults 2027-02-20, 09:00–13:00, required location, optional notes, and a preview step. Preview targets only Setup sessions without an existing primary event.
- Added server action that rechecks season/session eligibility, creates primary events only for eligible sessions, preserves existing primary events, and excludes Open/Locked sessions. Makeup events remain individually managed.
- Added admin Return to Setup action for Open sessions. It is rejected if any evaluation records exist; no event, assignment, or evaluation rows are deleted. Locked sessions remain locked. Fixed status validation to allow the requested `setup` destination.
- Added a global makeup schedule with preview. It adds a makeup event to each eligible Setup session that already has a primary event; existing events are preserved, and Open/Locked sessions are skipped.
- Updated session-administration regression test, test-plan docs, FAQ, and decision log.
- Validation: `npm run test:session-administration` passed. `npm run test:all` passed 13 source-level test groups including session administration; lint, TypeScript, and production build could not run because `npm ci --ignore-scripts --no-audit --no-fund` timed out and left dependencies incomplete (`eslint`/`next` unavailable and type definitions missing). These failures are environment/dependency setup failures, not a successful code validation. Runtime browser/database behavior remains untested here.
- No migrations were added or applied. No local or hosted database was modified. Continue local-only migration/testing workflow.
