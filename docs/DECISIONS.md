# RWCLL Player Evaluations — Decision Log

Record durable decisions and rationale. When a decision changes, add a new entry rather than silently erasing history.

| Date | Area | Decision | Rationale / notes | Status |
|---|---|---|---|---|
| 2026-11-02 | Product | Application name: **RWCLL Player Evaluations**. | League-specific evaluation workflow. | Confirmed |
| 2026-11-02 | Scope | One league, approximately 30–50 users; no parent/player accounts. | Keep initial product small. | Confirmed |
| 2026-11-02 | Platform | Responsive Next.js web app/PWA. | Supports phones, tablets, desktop. | Confirmed |
| 2026-11-02 | Backend | Separate Supabase project for RWCLL. | Isolates RWCLL data, Auth, and configuration. | Confirmed |
| 2026-11-02 | Tools | GitHub, VS Code, PowerShell, npm. | Existing development setup. | Confirmed |
| 2026-11-02 | Authentication | Individual accounts; admin-managed invitations; no public registration in intended app. | Starter sign-up UI still needs removal/disablement. | Requirement confirmed; implementation pending |
| 2026-11-02 | Evaluations | Coach and independent-evaluator scores/averages remain separate. | Preserve distinct evaluator groups. | Requirement confirmed |
| 2026-11-02 | Permissions | Coaches see group averages only; independent evaluator identities hidden from coaches; admins can inspect individual submissions. | Must be enforced in RLS, not just UI. | Requirement confirmed; implementation pending |
| 2026-11-02 | Ratings | Five core categories required; pitching/catching optional for AAA and above. | Matches evaluation design. | Requirement confirmed |
| 2026-11-02 | Missing values | Not Evaluated and blank optional ratings are not zero; averages use actual ratings and show counts. | Avoid misleading averages. | Requirement confirmed |
| 2026-11-02 | History | Historical data read-only and excluded from current averages. | Preserve context without mixing seasons. | Requirement confirmed |
| 2026-11-02 | Imports | Sports Connect CSV/Excel import with preview and admin confirmation. | Existing export lacked a permanent ID; name-only matching is unsafe. | Requirement confirmed; implementation pending |
| 2026-11-02 | Data model | Stable player identity separate from season-specific registration/team/division/league age. | Players may move teams/divisions between seasons. | Direction confirmed; schema pending |
| 2026-11-02 | Player IDs and imports | Generate a permanent internal `player_id`; do not derive it from name or birthdate. Use name/birthdate only to suggest possible matches, with administrator confirmation before linking an import row to an existing player. If no match is confirmed, the administrator can create a new player; uncertain rows remain pending review. | Names and birthdates are not guaranteed unique and can change or contain errors. Avoid silent merges and preserve reliable identity across seasons. | Confirmed; implementation pending |
| 2026-11-02 | Security | RLS for league data; test separate roles before loading real data. | Frontend hiding is not a security boundary. | Requirement confirmed; implementation pending |
| 2026-11-02 | Secrets | `.env.local` stays local and Git-ignored. | Verified with `git check-ignore -v .env.local`. | Verified |
| 2026-11-02 | Setup | Supabase Auth tested using starter login and protected page. | Test user signed in and page displayed claims; does not verify database schema or RLS. | Verified |
| 2026-11-02 | Coach assignments | A coach may be assigned to multiple teams in a season. | Use a season-scoped many-to-many `team_coach_assignments` table; do not assume one coach equals one team. | Confirmed; schema proposed, not implemented |
| 2026-11-02 | Coach visibility | Coaches can see both assigned-team and division-wide group averages. | Provide two aggregate scopes while withholding individual ratings and evaluator identities. | Confirmed; secure aggregate implementation pending |
| 2026-11-02 | Evaluation sessions | One evaluation session per division per season, with multiple evaluators. | Enforce one session per `season_division`; evaluator assignments and submissions belong to that shared session. | Confirmed; schema proposed, not implemented |
| 2026-11-02 | Player roster | A player may appear on only one roster in a season. | Enforce one `player_seasons` row per `(player_id, season_id)`; a player may be on a different team in a later season. | Confirmed; schema proposed, not implemented |
| 2026-11-02 | Evaluation identifier | Each player has an `evaluation_number` for that season, corresponding to the number coaches/evaluators see the player wearing during evaluations. It is not a permanent player ID or a jersey number carried forward. | Store it on `player_seasons`; make it unique within the season division when assigned, and assign a new number in each season. | Confirmed; schema proposed, not implemented |

## Open decisions
- What are the final visibility rules for shared coach notes?
- What league policy and retention period apply to children’s names and birthdates? Minimize DOB retention where feasible.
- What exact review/audit details should be retained for each administrator-confirmed import match?
- What hosting plan and pricing will be used at launch?
- What is the admin process for inviting, disabling, and removing users?
- Are there additional league approval or audit requirements?
