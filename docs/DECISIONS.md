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
| 2026-11-02 | Security | RLS for league data; test separate roles before loading real data. | Frontend hiding is not a security boundary. | Requirement confirmed; implementation pending |
| 2026-11-02 | Secrets | `.env.local` stays local and Git-ignored. | Verified with `git check-ignore -v .env.local`. | Verified |
| 2026-11-02 | Setup | Supabase Auth tested using starter login and protected page. | Test user signed in and page displayed claims; does not verify database schema or RLS. | Verified |
| 2026-11-02 | Coach assignments | A coach may be assigned to multiple teams in a season. | Use a season-scoped many-to-many `team_coach_assignments` table; do not assume one coach equals one team. | Confirmed; schema proposed, not implemented |
| 2026-11-02 | Coach visibility | Coaches can see both assigned-team and division-wide group averages. | Provide two aggregate scopes while withholding individual ratings and evaluator identities. | Confirmed; secure aggregate implementation pending |
| 2026-11-02 | Evaluation sessions | One evaluation session per division per season, with multiple evaluators. | Enforce one session per `season_division`; evaluator assignments and submissions belong to that shared session. | Confirmed; schema proposed, not implemented |

## Open decisions
- What are the final visibility rules for shared coach notes?
- What league policy and retention period apply to children’s names and birthdates? Minimize DOB retention where feasible.
- What stable Sports Connect member ID or trusted player-matching method can be used?
- What hosting plan and pricing will be used at launch?
- What is the admin process for inviting, disabling, and removing users?
- Are there additional league approval or audit requirements?
