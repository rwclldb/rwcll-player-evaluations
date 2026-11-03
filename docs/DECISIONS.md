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
| 2026-11-02 | Imports | Sports Connect CSV/Excel import with preview and admin confirmation. | Sports Connect provides an ID, but it can change when a different parent registers the same child in a later season; it is not a universal child identifier. | Requirement confirmed; implementation pending |
| 2026-11-02 | Data model | Stable player identity separate from season-specific registration/team/division/league age. | Players may move teams/divisions between seasons. | Direction confirmed; schema pending |
| 2026-11-03 | Sports Connect ID and player matching | Store the Sports Connect ID as a season-specific external registration identifier, not as the app’s permanent player identity. A changed ID between seasons does not mean the child is a different player; all links to existing players require admin confirmation. | Sports Connect confirmed that a different parent registering the same child in a later season can result in a different ID. Same ID is useful evidence, not proof; different ID is not proof of a different child. Avoid silent merges and duplicates. | Confirmed; import workflow and tests pending |
| 2026-11-02 | Player IDs and imports | Generate a permanent internal `player_id`; do not derive it from name or birthdate. Use name/birthdate only to suggest possible matches, with administrator confirmation before linking an import row to an existing player. If no match is confirmed, the administrator can create a new player; uncertain rows remain pending review. | Names and birthdates are not guaranteed unique and can change or contain errors. Avoid silent merges and preserve reliable identity across seasons. | Confirmed; implementation pending |
| 2026-11-02 | Security | RLS for league data; test separate roles before loading real data. | Frontend hiding is not a security boundary. | Requirement confirmed; implementation pending |
| 2026-11-02 | Secrets | `.env.local` stays local and Git-ignored. | Verified with `git check-ignore -v .env.local`. | Verified |
| 2026-11-02 | Setup | Supabase Auth tested using starter login and protected page. | Test user signed in and page displayed claims; does not verify database schema or RLS. | Verified |
| 2026-11-02 | Coach assignments | A coach may be assigned to multiple teams in a season. | Use a season-scoped many-to-many `team_coach_assignments` table; do not assume one coach equals one team. | Confirmed; schema proposed, not implemented |
| 2026-11-02 | Coach visibility | Coaches must not see a comparison of their assigned-team averages against division-wide averages. Individual ratings remain hidden and independent evaluator identities remain hidden. | Avoid revealing team-versus-division comparisons while still providing approved group-level information. The exact coach-facing aggregate presentation must not juxtapose these scopes. | Confirmed; secure aggregate implementation pending |
| 2026-11-02 | Evaluation sessions | One evaluation session per division per season, with multiple evaluators. | Enforce one session per `season_division`; evaluator assignments and submissions belong to that shared session. | Confirmed; schema proposed, not implemented |
| 2026-11-02 | Player roster | A player may appear on only one roster in a season. | Enforce one `player_seasons` row per `(player_id, season_id)`; a player may be on a different team in a later season. | Confirmed; schema proposed, not implemented |
| 2026-11-02 | Evaluation identifier | Each player has an `evaluation_number` for that season, corresponding to the number coaches/evaluators see the player wearing during evaluations. It is not a permanent player ID or a jersey number carried forward. | Store it on `player_seasons`; make it unique within the season division when assigned, and assign a new number in each season. | Confirmed; schema proposed, not implemented |
| 2026-11-02 | Season lifecycle | A completed season is closed by default and remains viewable. Only an explicit administrator action can reopen it for corrections; log the administrator, timestamp, and reason, and allow it to be closed again. | Preserve historical integrity while providing a controlled correction path. Season closure is separate from evaluation-session locking. | Confirmed; schema/workflow proposed, not implemented |
| 2026-11-02 | New-season setup | When creating a new season, carry forward only the editable division setup. Do not copy team names, coach assignments, player evaluations, or historical results. Coaches are registered/assigned anew each season, and team names are added only after evaluations. | Keep each season's roster-building and team assignment process independent; team names are intentionally unavailable until evaluations are complete. | Confirmed; workflow/schema proposed, not implemented |

## Open decisions
- What are the final visibility rules for shared coach notes?
- What league policy and retention period apply to children’s names and birthdates? Minimize DOB retention where feasible.
- What exact review/audit details should be retained for each administrator-confirmed import match?
- What hosting plan and pricing will be used at launch?
- What is the admin process for inviting, disabling, and removing users?
- Are there additional league approval or audit requirements?


## 2026-11-02 — Evaluation and roster workflow decisions

| Date | Area | Decision | Rationale / notes | Status |
|---|---|---|---|---|
| 2026-11-02 | Evaluation numbers | Admins can generate numbers from a chosen starting value, override individual numbers, or import them from CSV. Evaluation without a number is allowed. | Support different check-in and roster workflows. | Confirmed |
| 2026-11-02 | Evaluator access | Evaluators can search/evaluate any player in their assigned division; coaches may evaluate players in any division. | Role-based access remains distinct from evaluator assignment and coach reporting access. | Confirmed |
| 2026-11-02 | Absences | Record absent players and provide an absence report for admins. Players missing required evaluations are flagged for admin handling and are not eligible to play unless the issue is resolved. | Absence is a workflow status, not a fabricated zero score. | Confirmed |
| 2026-11-02 | Drafts and edits | Evaluators can save drafts and resume later; submitted evaluations remain editable by their author until session lock. | Support real-world evaluation sessions. | Confirmed |
| 2026-11-02 | Completion | Admin decides when the session is complete. Missing ratings and missing evaluator submissions are flagged but are allowed. | Completion is an administrative decision, not an automatic all-submissions requirement. | Confirmed |
| 2026-11-02 | Locked corrections | Admin may correct submitted evaluations after session lock; corrections must be audited. | Preserve accountability and historical traceability. | Confirmed |
| 2026-11-02 | Team balancing | Optional tool generates proposed balanced rosters only, never official team assignments. It should support CSV export and print-friendly output. | Main team-management system remains authoritative. | Confirmed |
| 2026-11-02 | Team size | Admin specifies target team size for generated rosters; sizes may differ by one when players cannot be divided evenly. | Keep proposed rosters practical and balanced in size. | Confirmed |
| 2026-11-02 | Coach's child | Admin can designate a coach's child; the player is placed on that coach's proposed team automatically. All coaches may see which players are designated as a coach's child. | Apply the placement constraint transparently to coaches. | Confirmed; implementation pending |
| 2026-11-02 | Balancing inputs | Suggested team balancing may use available ratings, age, experience, and pitching/catching information. | Missing information must remain missing; no scores are invented. | Confirmed |
| 2026-11-02 | Late additions and history | Players added after team formation may lack evaluation scores; existing ratings and historical data are not silently changed or overwritten. | Explicitly handle incomplete data and preserve history. | Confirmed |
