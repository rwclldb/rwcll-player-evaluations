# RWCLL Player Evaluations — Decision Log

Record durable decisions and rationale. When a decision changes, append a new entry rather than silently erasing history. Status distinguishes a confirmed requirement from implementation and testing.

## Decision history

| Date | Area | Decision | Rationale / notes | Status |
|---|---|---|---|---|
| 2026-11-02 | Product | Application name: **RWCLL Player Evaluations**. | League-specific evaluation workflow. | Confirmed |
| 2026-11-02 | Scope | One league, approximately 30–50 users; no parent/player accounts. | Keep initial product small. | Confirmed |
| 2026-11-02 | Platform | Responsive Next.js web app/PWA. | Supports phones, tablets, desktop. | Confirmed |
| 2026-11-02 | Backend | Separate Supabase project for RWCLL. | Isolates RWCLL data, Auth, and configuration. | Confirmed |
| 2026-11-02 | Tools | GitHub, VS Code, PowerShell, npm. | Existing development setup. | Confirmed |
| 2026-11-02 | Authentication | Individual accounts; admin-managed invitations; no public registration in intended app. | Starter sign-up UI still needs removal/disablement. | Requirement confirmed; implementation pending verification |
| 2026-11-02 | Evaluations | Coach and independent-evaluator scores/averages remain separate. | Preserve distinct evaluator groups. | Confirmed |
| 2026-11-02 | Permissions | Coaches see approved group aggregates only; independent evaluator identities hidden from coaches; admins can inspect individual submissions. | Must be enforced in database/RPCs, not just UI. | Requirement confirmed; full authorization validation pending |
| 2026-11-02 | Ratings | Five core categories are required. | Matches evaluation design. | Confirmed |
| 2026-11-02 | Missing values | `Not Evaluated` and blank optional ratings are not zero; averages use actual ratings and show counts. | Avoid misleading averages. | Confirmed |
| 2026-11-02 | History | Historical data is read-only and excluded from current averages. | Preserve context without mixing seasons. | Confirmed; implemented for current historical report path |
| 2026-11-02 | Imports | Sports Connect CSV/Excel import with preview and admin confirmation. | Sports Connect ID is not a universal child identifier. | Confirmed; staging/review/commit workflow implemented locally |
| 2026-11-02 | Data model | Stable player identity separate from season-specific registration/team/division/league age. | Players may move teams/divisions between seasons. | Confirmed; implemented in current schema direction |
| 2026-11-02 | Security | RLS for league data; test separate roles before loading real data. | Frontend hiding is not a security boundary. | Requirement confirmed; broad role/RLS matrix pending |
| 2026-11-02 | Secrets | `.env.local` stays local and Git-ignored. | Verified earlier with `git check-ignore -v .env.local`. | Verified; recheck if repo config changes |
| 2026-11-02 | Setup | Supabase Auth tested using starter login and protected page. | Test user signed in and page displayed claims; does not verify all database RLS. | Verified |
| 2026-11-02 | Coach assignments | A coach may be assigned to multiple teams in a season. | Use season-scoped many-to-many `team_coach_assignments`; do not assume one coach equals one team. | Confirmed; schema present, broader runtime tests pending |
| 2026-11-02 | Coach visibility | Coaches must not see a comparison of assigned-team averages against division-wide averages. Individual ratings and independent evaluator identities remain hidden. | Avoid revealing team-versus-division comparisons while allowing approved group information. | Confirmed; secure aggregate implementation/validation pending |
| 2026-11-02 | Evaluation sessions (superseded 2026-11-03) | Previous assumption: one evaluation session per division per season. | Superseded by age-based evaluation groups and separate primary/makeup events. | Superseded |
| 2026-11-02 | Player roster | A player may appear on only one roster in a season. | Enforce one `player_seasons` row per `(player_id, season_id)`. | Confirmed; schema constraint/workflow to be verified |
| 2026-11-02 | Evaluation identifier | Each player has nullable season-specific `evaluation_number`; it is not permanent or carried forward. | Use supplied number when available; otherwise leave blank until assigned. Review season-wide uniqueness under age-group design. | Confirmed |
| 2026-11-02 | Season lifecycle | A completed season is closed by default and remains viewable. Only explicit administrator action can reopen it for corrections; record administrator, timestamp, and reason. | Preserve historical integrity; season closure is separate from session locking. | Confirmed; full workflow validation pending |
| 2026-11-02 | New-season setup | Carry forward only editable division setup. Do not copy team names, coach assignments, player evaluations, or historical results. | Each season's roster-building process is independent; team names are added after evaluations. | Confirmed; division-link initialization implemented locally |
| 2026-11-02 | Evaluation numbers | Admins can generate numbers from a chosen starting value, override individual numbers, or import them from CSV. Evaluation without a number is allowed. | Support different check-in and roster workflows. | Confirmed; implementation/validation pending |
| 2026-11-02 | Evaluator access | Evaluators can search/evaluate players in their assigned division; coaches may evaluate players in any division. | Role-based access remains distinct from coach reporting access. | Confirmed; full workflow validation pending |
| 2026-11-02 | Absences | Record absent players and provide an absence report for admins. Players missing required evaluations are flagged and not eligible unless resolved. | Absence is a workflow status, not a fabricated zero score. | Confirmed; implementation/validation pending |
| 2026-11-02 | Drafts and edits | Evaluators can save drafts and resume; submitted evaluations remain editable by author until session lock. | Support real-world evaluation sessions. | Confirmed; full workflow validation pending |
| 2026-11-02 | Completion | Admin decides when a session is complete. Missing ratings/submissions are flagged but allowed. | Completion is an administrative decision. | Confirmed; full workflow validation pending |
| 2026-11-02 | Locked corrections | Admin may correct submitted evaluations after lock; corrections require reason and audit. | Preserve accountability and traceability. | Confirmed; full workflow validation pending |
| 2026-11-02 | Team balancing | Optional tool generates proposed balanced rosters only; never official assignments. Support CSV and print-friendly output. | Official team management remains authoritative. | Confirmed; implementation pending |
| 2026-11-02 | Team size | Admin sets target team size; sizes may differ by one if player count does not divide evenly. | Keep proposed rosters practical. | Confirmed; implementation pending |
| 2026-11-02 | Coach's child | Admin can designate a coach's child for placement on that coach's proposed team. All coaches may see the designation. | Apply placement constraint transparently. | Confirmed; implementation pending |
| 2026-11-02 | Balancing inputs | Suggested balancing may use available ratings, age, experience, and pitching/catching information. | Missing information remains missing; do not invent scores. | Confirmed; implementation pending |
| 2026-11-02 | Late additions and history | Players added after team formation may lack evaluations; preserve existing/current/historical ratings. | Avoid silently altering prior records. | Confirmed |
| 2026-11-03 | Season | Spring 2027 runs 2027-01-01 through 2027-06-30. Preserve existing season record. | Current development season. | Confirmed |
| 2026-11-03 | Active divisions | Active baseball divisions are AA, AAA, Majors, Juniors, Seniors. | Other programs may be imported but flagged and excluded from active evaluation pool by default. | Confirmed; local seed/link migration applied and verified |
| 2026-11-03 | Registration imports | Import all registrations, including Completed/Paid and Pending/unpaid. Pending does not disqualify a player from evaluation. App does not process payments. | Preserve status on registration and show on lists/details/reports, not evaluation screens. | Confirmed; import commit preserves staged payment status |
| 2026-11-03 | Registration number | Use supplied registration/evaluation number; otherwise leave null until admin assigns it. | Do not generate automatically during import. | Confirmed; import behavior follows this rule |
| 2026-11-03 | Evaluation organization | Group players by official Little League age, not final division. | One age group can include players later drafted to different divisions. | Confirmed; age-based schema/code work exists locally; full workflow validation pending |
| 2026-11-03 | Little League age | Calculate age using supplied season age chart and official Aug. 31 baseball rule; validate source before production. | Age is not based on season start/evaluation date. | Confirmed; source verification required before production |
| 2026-11-03 | Attendance | Track attendance separately for each primary/makeup event and independently of ratings. Injured attendees may have no/partial ratings. | Attendance and performance are distinct facts. | Confirmed; full workflow validation pending |
| 2026-11-03 | Exemptions | Admin-approved exemptions resolve attendance and/or evaluation requirements only with explicit scope and reason; record approver/time. | Exemptions must be auditable and never inferred. | Confirmed; full workflow validation pending |
| 2026-11-03 | Draft workflow | App records division/team assignments after real-world draft; it is not official draft/roster management. Draft order Seniors → Juniors → Majors → AAA → AA. | Top-age placement rules must come from verified league rules. | Confirmed; assignment workflow validation pending |
| 2026-11-03 | Team suggestions | Optional AA random-team suggestions are advisory and require admin review. | App supplements coaches; does not replace official rostering. | Confirmed; implementation pending |
| 2026-11-03 | Import matching | Sports Connect Player ID is a season-scoped clue, not permanent identity. Existing-player links require explicit admin confirmation. | Preserve internal player ID; uncertain matches remain pending. | Confirmed; implemented in import workflow |
| 2026-11-07 | Historical coach evaluations | Reuse/extend existing `historical_evaluations` and `historical_ratings`; stage imports, prefer permanent RWCLL Player ID, use other details as candidate clues, and require admin confirmation for every link. Preserve source metadata and match provenance. | Prevent false links from duplicate names or changing external IDs; unmatched rows must not create players or enter reports/current averages. | Confirmed; schema applied locally; three test links inserted |
| 2026-11-07 | Historical report access | Coaches may view prior-season coach ratings only for players assigned to teams for which they have a current-season `team_coach_assignments` record. Use narrowly scoped RPCs; do not grant direct historical-table access. | Enforce authorization at database boundary. Admins retain full report/CSV access. | Confirmed; RPCs/pages implemented locally; runtime matrix partly tested |
| 2026-11-07 | Pitching/catching availability — supersedes older division rule | Pitching and catching categories should be available for all evaluation age groups, possibly unscored; availability must not depend on eventual division assignment. | Evaluation groups are age-based and final division is assigned after draft. The older “optional only for AAA and above” wording conflicts with this direction. | Confirmed product direction; verify/reconcile implementation |
| 2026-11-07 | Test-only historical crosswalks | Link three Spring 2026 source rows explicitly to three synthetic Spring 2027 test players while preserving source names and IDs. | Demonstrates explicit crosswalk behavior without implying real-world identity match. | Completed locally: 3 historical evaluations, 15 ratings; admin report display verified |
| 2026-11-07 | Coach report authorization test setup | Create local test team `TEST - AAA Coach Report`, assign Drew Willow10's registration to it as a simulated post-draft AAA placement, and assign `coach-a-test@example.com` as head coach. | A current team assignment is needed to test coach-scoped historical report access. Sports Connect commit intentionally leaves final division/team unset. | Completed locally; test-only data |
| 2026-11-07 | Coach report authorization result | Assigned Coach A can view Drew's historical report. Unassigned Coach B receives 404 for the same report URL. | 404 for an unassigned coach is consistent with the intended access restriction. This is an initial positive test, not complete authorization coverage. | Runtime-tested locally; different-team and direct-table RLS cases remain open |
| 2026-11-07 | Division initialization | Seed the five active divisions, link them to existing open seasons, and attach them to newly inserted open seasons through a database trigger. | New seasons should carry forward editable division setup only, not teams or assignments. | Migration `20261107040000_seed_active_divisions_and_link_seasons.sql` applied and verified locally |

## Important implementation notes

### Historical source labels

`Coach AA01`, `Coach AA04`, etc. are provisional labels based on spreadsheet numbers. They are not verified coach identities. Preserve them as source labels until reliable coach identity data is supplied.

### Test-only division assignment

The AAA team assignment for Drew Willow10 is a local test-only simulated post-draft assignment. It does not mean the Sports Connect requested division is final, and it does not change the rule that division/team placement follows evaluations and draft.

### Local/hosted separation

Migrations and data changes described in the 2026-11-07 checkpoints were applied/tested locally only. Hosted Supabase remains unchanged unless separately and explicitly approved. Always inspect actual local and remote migration histories before future migration operations.

## Open decisions

- What are the final visibility rules for shared coach notes?
- What league policy and retention period apply to children's names and birthdates? Minimize DOB retention where feasible.
- What exact review/audit details should be retained for each administrator-confirmed import match?
- What hosting plan and pricing will be used at launch?
- What is the admin process for inviting, disabling, and removing users?
- Are there additional league approval or audit requirements?
- Confirm the precise pitching/catching scoring workflow (available for all age groups, but whether each category is scored or displayed as unscored in each age group).
