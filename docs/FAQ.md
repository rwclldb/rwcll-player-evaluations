# RWCLL Player Evaluations — FAQ & How-To

## Project overview
- Stack: Next.js, Supabase (PostgreSQL and Auth), npm
- Local development: Windows, PowerShell, VS Code
- Local folder: `D:\sandbox\RWCLL\rwcll-player-evaluations`
- Private GitHub repository: `rwcll-player-evaluations`
- Detailed proposed schema: [`DATABASE-DESIGN.md`](DATABASE-DESIGN.md)

## Verified setup (2026-11-02)
- [x] Next.js + Supabase starter created.
- [x] App loads at `http://localhost:3000`.
- [x] `.env.local` is Git-ignored (`git check-ignore -v .env.local` confirmed `.gitignore:34:.env*.local`).
- [x] Initial scaffold committed as `34f85d2` and pushed to `main`.
- [x] Supabase test user created; sign-in succeeded and protected page displayed user claims.
- [ ] RWCLL database tables, aggregate functions, and RLS policies created and tested.

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
- **SQL Editor:** apply reviewed schema SQL/migrations.
- **Table Editor:** inspect development data.
- **Project Settings → API:** view project URL and publishable key.

Prefer version-controlled SQL migrations as the schema develops. Do not load live league data before RLS policies are implemented and tested.

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
- Coaches can see group averages for their assigned teams and division-wide group averages.
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

The `evaluation_number` is stored with the player's season roster record, shown to coaches/evaluators on the evaluation screen, and must be unique within that season division when assigned. It is a new value for each season. For imports, `player_id` is generated internally and remains stable across seasons; name and birthdate are matching clues only, and an administrator must confirm a match before records are linked. The schema document describes the intended tables and relationships. It is still a proposal: no RWCLL database tables, aggregate functions, or RLS policies have been created yet. Use secure database-side aggregate functions/views; frontend hiding alone is not sufficient. Test access with separate coach accounts assigned to different teams, as well as independent evaluator and administrator accounts.

## Authentication and roles
The starter includes sign-up UI. The intended RWCLL app uses administrator-managed invitations, not public registration. A Supabase-authenticated user is not automatically an RWCLL administrator; application roles and permissions must be implemented separately. Enforce access with database RLS, not just frontend visibility.

## Troubleshooting
**App will not start:** confirm the terminal is in the folder containing `package.json`, run `npm run dev`, and inspect the first terminal error.

**Environment warning:** confirm `.env.local` is in the project root and variable names match `.env.example`. Do not share values. Restart the dev server after edits.

**Sign-in fails:** confirm the user exists in Supabase Authentication and check email confirmation status. Remove tokens and personal information before sharing error text.

## Documentation upkeep
Update the FAQ with verified procedures, the roadmap with implementation-and-test status, and the decision log with durable decisions. Update the database design when structural decisions change. After substantive project updates, update all relevant docs. The current updated documentation has not yet been confirmed copied into the Git repository.


## Evaluation workflow rules (confirmed 2026-11-02)

### Evaluation numbers and finding players
- Administrators can generate evaluation numbers beginning at a chosen number, override numbers manually, or import numbers from CSV. Players may be evaluated without a number.
- Evaluators can find and evaluate any player in their assigned division. Coaches may evaluate players in any division.
- The system records absences and provides an administrator report. Players who miss required evaluations are flagged for administrator follow-up and are not eligible to play unless the issue is resolved.

### Drafts, missing work, and locking
- Evaluators can save a draft and return to it later. They can edit their submitted evaluations until the session is locked.
- Administrators decide when a session is complete. The system flags missing ratings and missing evaluator submissions, but these gaps do not automatically block completion.
- Once locked, an evaluation can be corrected only by an administrator, and the correction must be recorded in the audit trail.

### Optional team suggestions
- Team generation is an optional planning aid, not the league's official team-management system. Administrators remain responsible for reviewing and using any proposed rosters.
- Administrators set the target team size. If player counts do not divide evenly, suggested teams may differ in size by one player. Coaches are assigned before players are placed.
- Administrators can flag a coach's child for automatic placement on that coach's proposed team. The designation must not be visible to coaches.
- Balancing may use available ratings, age, experience, and pitching/catching information. Missing ratings are not invented.
- Suggested rosters should be exportable to CSV and printable. Players added after teams are formed may have no evaluation scores; existing ratings and historical data must not be silently overwritten.
