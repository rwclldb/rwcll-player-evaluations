# RWCLL Player Evaluations — Proposed Database Design

**Status:** Proposed design; not implemented. The choices in this document reflect confirmed product requirements and the three database-design decisions confirmed on 2026-11-02. Review this design before writing or applying migrations.

## Confirmed design decisions

1. A coach may be assigned to multiple teams in a season.
2. Coaches can view group averages for both their assigned teams and the wider division.
3. There is one evaluation session per division per season. Multiple coaches and independent evaluators participate in that session.
4. Coach and independent-evaluator results remain separate. Coaches see aggregate results only, never individual ratings. Independent evaluator identities are hidden from coaches.
5. Administrators can inspect individual submissions.
6. A Not Evaluated record contains no ratings and is excluded from averages.
7. Historical evaluations are read-only and excluded from current-season averages.

## Proposed tables

### Season, roster, and player identity

| Table | Purpose / important fields |
|---|---|
| `seasons` | One row per league season; name, start/end dates, active flag. |
| `divisions` | Tee Ball, A, AA, AAA, Majors, Juniors, Seniors. |
| `season_divisions` | A division participating in a particular season; unique season/division pair. |
| `teams` | Team within a `season_division`; team name and season/division association. |
| `players` | Stable player identity across seasons; name and only the minimum personal data needed. |
| `player_seasons` | Player's season-specific roster record; season division, optional team, league age, external registration identifier if available, import/match status. |

Use one stable `players` row per child and a separate `player_seasons` row per season. A team belongs to a season/division, so the season/division can be derived through the team where appropriate; retaining the season-division relationship on the roster row can also support players not yet assigned to a team. Add database constraints to prevent a player from having duplicate roster records in the same season division.

Calculate Little League age for each season using the official Aug. 31 rule. Store the season-specific result; do not treat birthdate as a substitute for league age. Confirm whether the league needs to retain full birthdates after import. The existing Sports Connect export inspected for this project did not contain a stable member ID, so do not silently match people by name or birthdate. Use an external registration ID if one becomes available; otherwise require administrator review and confirmation of matches.

### Users and team assignments

| Table | Purpose / important fields |
|---|---|
| Supabase `auth.users` | Authentication identity managed by Supabase. |
| `user_profiles` | Application profile linked one-to-one to `auth.users`; display name and active status. |
| `user_roles` | One or more roles per user, such as administrator, coach, independent evaluator. |
| `team_coach_assignments` | Season-scoped many-to-many link between a coach and a team. Include `season_id`, `team_id`, `user_id`, active dates/status, and who created the assignment. |

A coach may have multiple rows in `team_coach_assignments`, including assignments to several teams in the same season. Scope assignments to a season so they do not accidentally carry forward to a new season. Validate that the assigned team belongs to the specified season.

Do not create a separate password system. A Supabase-authenticated account is not automatically authorized to access league data; application roles and row-level security (RLS) determine access.

### Evaluation session and submissions

| Table | Purpose / important fields |
|---|---|
| `evaluation_sessions` | Exactly one session for each `season_division`; status (planned/open/locked), lock metadata, and administrative timestamps. Enforce a unique `season_division_id`. |
| `evaluator_assignments` | Users authorized to evaluate in a session; evaluator group/type (coach or independent evaluator), assignment status. |
| `evaluations` | One evaluator's evaluation of one player in one session; evaluator user ID, player-season ID, status (draft/submitted/not_evaluated), timestamps. |
| `rating_categories` | Configurable rating category definitions and ordering. |
| `division_rating_categories` | Which categories apply to each season division and whether each is required. |
| `ratings` | Individual category scores, constrained to 1–5, linked to an evaluation and category. |
| `experience_answers` | Yes/No/Unknown answers for prior pitching/catching experience and interest. |

The one-session-per-division rule is represented by one `evaluation_sessions` row per `season_division`, not by one session per evaluator. Multiple evaluator assignments point to the same session. Multiple evaluators can independently submit an evaluation for the same player.

Add a uniqueness constraint so an evaluator cannot create duplicate evaluation records for the same player in the same session. If a coach evaluates a player in more than one assigned team context, use the player's single season roster record and the division session; do not duplicate the player's evaluation merely because the coach has multiple team assignments.

For a submitted evaluation, require all five core categories: Hitting, Throwing, Grounders, Fly balls, and Running / Awareness. Pitching and catching categories are optional for AAA, Majors, Juniors, and Seniors. Experience/interest questions use Yes/No/Unknown and are not numeric ratings. A Not Evaluated submission has no `ratings` rows and must never be converted to a zero score. Drafts are not included in averages.

### Notes, historical data, imports, and audit

| Table | Purpose / important fields |
|---|---|
| `private_notes` | Coach's private notes, visible only to that coach and administrators. |
| `shared_notes` | Notes intentionally shared with authorized league users; final visibility rules still need confirmation. |
| `historical_evaluations` | Imported prior-season evaluation records, marked read-only and source/coverage-labeled. |
| `historical_ratings` | Category-level historical scores; never included in current averages. |
| `import_batches` | Source file, import date, importing administrator, counts, and batch status. |
| `audit_log` | Important actions, actor, target record, timestamp, and safe change metadata. |

Keep private and shared notes in separate tables and policies. A shared-note permission must not grant access to private notes or individual scores. Historical AA data currently represents only one team's records and should be labeled as partial coverage. It requires unredacted names or a reliable mapping and administrator-confirmed player matching before import.

## Relationships (conceptual)

```mermaid
erDiagram
  SEASONS ||--o{ SEASON_DIVISIONS : includes
  DIVISIONS ||--o{ SEASON_DIVISIONS : participates
  SEASON_DIVISIONS ||--o{ TEAMS : contains
  PLAYERS ||--o{ PLAYER_SEASONS : rostered_as
  SEASON_DIVISIONS ||--o{ PLAYER_SEASONS : registers
  TEAMS o|--o{ PLAYER_SEASONS : roster_assignment
  AUTH_USERS ||--o| USER_PROFILES : profile
  USER_PROFILES ||--o{ USER_ROLES : has
  USER_PROFILES ||--o{ TEAM_COACH_ASSIGNMENTS : assigned
  TEAMS ||--o{ TEAM_COACH_ASSIGNMENTS : coached_by
  SEASON_DIVISIONS ||--o| EVALUATION_SESSIONS : has_one
  EVALUATION_SESSIONS ||--o{ EVALUATOR_ASSIGNMENTS : authorizes
  EVALUATION_SESSIONS ||--o{ EVALUATIONS : contains
  PLAYER_SEASONS ||--o{ EVALUATIONS : evaluated
  USER_PROFILES ||--o{ EVALUATIONS : submits
  EVALUATIONS ||--o{ RATINGS : has
  RATING_CATEGORIES ||--o{ RATINGS : category
```

This diagram is conceptual. Exact foreign keys, nullable fields, delete behavior, and constraints must be finalized in SQL migrations.

## Coach views and average calculations

Provide two authorized aggregate scopes to coaches:

- **Assigned-team view:** group averages for each team to which that coach is assigned for the season.
- **Division-wide view:** group averages across the division.

For both scopes, calculate coach-submitted and independent-evaluator-submitted averages separately. Never combine the two evaluator groups. Show the number of actual ratings used alongside each average, such as `4.2 (5 of 6 evaluators)`. Only submitted numeric ratings count; drafts, Not Evaluated submissions, and blank optional categories do not count. Historical scores are displayed separately as context and never enter current averages.

The application must not give coaches direct read access to individual `ratings` or `evaluations` rows in a way that lets them reconstruct individual scores. Use carefully scoped database views or, preferably where needed, security-definer functions/RPCs that return only approved aggregates. Review function ownership, `search_path`, grants, and RLS carefully. Do not rely on frontend filtering to hide individual scores. Test team and division aggregates using separate coach accounts with different team assignments, plus independent evaluator and administrator accounts.

Independent evaluator names/IDs must not appear in coach-facing aggregate responses or notes. Administrators retain authorized access to individual submissions and audit records.

## Security and implementation requirements

- Enable RLS on every table containing league or child data.
- Deny access by default; grant only the minimum required actions by role and assignment.
- Enforce coach access to assigned-team and division aggregate outputs without exposing individual score rows.
- Restrict individual evaluation records and raw ratings to their author where appropriate and to administrators; independent-evaluator identity is not exposed to coaches.
- Restrict private coach notes to their author and administrators.
- Lock sessions administratively and reject writes after lock, including direct API/database attempts.
- Preserve author, creation/submission timestamps, and audit events.
- Use test accounts for every role and test both allowed and denied operations before importing real children’s data.
- Keep service-role/secret keys server-side only; never expose them in browser code.

## Still to confirm before implementation

- Final visibility rules for shared coach notes.
- Whether historical AA ratings should be visible only for the matching player and how to present missing historical coverage.
- Whether a player can be rostered without a team at evaluation time and the precise roster uniqueness constraints.
- Whether the league can obtain a stable Sports Connect identifier or a trusted mapping for historical records.
- Data retention policy for children’s names and birthdates.

## Implementation status

No RWCLL tables, migrations, aggregate functions, or RLS policies have been created yet. The existing successful sign-in test verifies Supabase Auth only; it does not verify this proposed database design.
