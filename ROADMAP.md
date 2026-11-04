# RWCLL Player Evaluations — Roadmap

A task is checked only after it is implemented **and tested**. A confirmed requirement or design decision is not the same as an implemented feature.

## 1. Requirements agreed
- [x] One league; approximately 30–50 users.
- [x] Responsive web app/PWA direction for phones, tablets, and desktop.
- [x] No parent or player accounts.
- [x] Coach and independent-evaluator ratings/averages remain separate.
- [x] Coaches see group averages only; independent evaluator identities hidden from coaches.
- [x] Administrators can inspect individual submissions.
- [x] Not Evaluated is not zero and is excluded from averages.
- [x] Five required core skills; optional pitching/catching for AAA and above.
- [x] Historical ratings are read-only and excluded from current averages.
- [x] Admin-managed invitations; no public registration in intended product.
- [x] Preserve prior seasons.
- [x] Seasons are closed by default after completion; an administrator may explicitly reopen a season for corrections, with the action recorded in an audit trail.
- [x] When creating a new season, carry forward only the editable division setup; do not copy teams/team names, coach assignments, player evaluations, or historical results. Team names are assigned after evaluations.
- [x] Generate a permanent internal player ID; use name/birthdate only to suggest import matches, with administrator confirmation and no silent merges.
- [x] Coaches may be assigned to multiple teams in a season.
- [x] Coaches can view authorized group averages, but must not see a comparison of their assigned-team averages against division-wide averages.
- [x] Confirm age-based evaluation groups that can include players later drafted to different divisions; this supersedes the prior division-based session assumption.
- [x] Each player has one roster assignment per season (no multiple team rosters in the same season).
- [x] Store a season-specific `evaluation_number` for identifying the player by the number they wear during evaluations; it does not carry over.

## 2. Development foundation
- [x] Create private GitHub repository and clone locally.
- [x] Scaffold Next.js app with Supabase starter.
- [x] Configure `.env.local`.
- [x] Verify `.env.local` is Git-ignored.
- [x] Load app at `http://localhost:3000`.
- [x] Commit scaffold (`34f85d2`) and push to `main`.
- [x] Create Supabase test user.
- [x] Sign in and display protected-page user claims.
- [x] Add the project documentation to the Git repository and commit/push updates as design decisions are confirmed.
- [ ] Establish version-controlled SQL migration workflow.
- [ ] Verify lint and production build.

## 3. Database foundation
- [x] Agree on conceptual entities and relationships; see `docs/DATABASE-DESIGN.md` (proposed only).
- [x] Confirm season-scoped many-to-many coach/team assignments.
- [x] Confirm coach-facing visibility rule: do not show a comparison between assigned-team averages and division-wide averages.
- [x] Confirm age-based evaluation groups and primary/makeup events; schema implementation remains pending.
- [x] Confirm one player roster record per season.
- [x] Confirm season-specific evaluation number displayed to evaluators; does not carry over between seasons.
- [ ] Review and approve detailed database design before migration work.
- [x] Confirm season lifecycle: closed by default; explicit administrator-only reopen for corrections, with audit logging.
- [x] Confirm new-season setup: copy only editable division configuration; create coaches/assignments and teams/team names fresh later, after evaluations; never copy evaluations or historical results.
- [ ] Design seasons, divisions, teams, players, user profiles, and roles.
- [ ] Separate stable player identity from season-specific registration/team/division/league age and `evaluation_number`.
- [ ] Define season-specific Little League age calculation (official Aug. 31 rule).
- [x] Confirm Sports Connect IDs are useful external registration identifiers but not universal child IDs: the same child can receive a different ID when a different parent registers them in a later season.
- [x] Agree on import identity rules: permanent internal `player_id`; season-scoped Sports Connect ID as a matching clue only; name/birthdate as candidate suggestions; administrator-confirmed linking; and pending review for uncertain rows.
- [ ] Design and implement import preview, duplicate detection, audit of match decisions, and admin-confirmed matching; no silent name/DOB matching.
- [ ] Implement and test database migrations.
- [ ] Implement and test RLS for all league data.
- [ ] Implement and test secure aggregate outputs for assigned-team and division views; no individual rating access for coaches.

## 4. Evaluations and permissions
- [ ] Replace division-based evaluation session model with age-based groups, dated primary/makeup events, and evaluator assignments.
- [ ] Implement coach and independent-evaluator submission flows.
- [ ] Support coaches assigned to multiple teams in a season.
- [ ] Require five core ratings for submitted evaluations.
- [ ] Implement optional pitching/catching ratings for AAA, Majors, Juniors, Seniors.
- [ ] Implement experience/interest Yes/No/Unknown questions.
- [ ] Implement Not Evaluated and average/count calculations.
- [ ] Keep evaluator-group averages separate.
- [ ] Implement and test coach-facing aggregate views that do not compare or juxtapose assigned-team averages against division-wide averages.
- [ ] Hide independent evaluator identities from coaches.
- [ ] Restrict individual submissions to administrators and appropriate authors.
- [ ] Implement private coach notes and separately controlled shared notes.
- [ ] Implement draft/submitted/locked states, author/timestamp, and audit trail.
- [ ] Test permissions with separate role accounts, including coaches assigned to multiple teams.

## 5. Imports and history
- [ ] Build CSV/Excel import preview, mapping, duplicate detection, confirmation.
- [ ] Import current Sports Connect data after matching rules are approved.
- [ ] Obtain unredacted historical names or a reliable mapping file.
- [ ] Match historical AA ratings with administrator confirmation.
- [ ] Label historical coverage as partial (one team), keep read-only.
- [ ] Verify historical data is excluded from current averages.

## 6. User experience and launch
- [ ] Build role-specific dashboards and evaluation screens.
- [ ] Support age-group evaluation events with multiple evaluators, per-player attendance, and separate performance records.
- [ ] Test phone, tablet, and desktop layouts.
- [ ] Test backup/restore and retention procedures.
- [ ] Confirm league policy for children’s names, birthdates, and retention.
- [ ] Verify hosting, pricing, environment variables, and production security.
- [ ] Run end-to-end pilot with test data and representative users.
- [ ] Obtain board approval before live data or launch.

## Current checkpoint
**Verified:** local app runs; `.env.local` is Git-ignored; scaffold is pushed; Supabase sign-in and protected-page claims work.

**Design confirmed, not implemented:** a new season carries forward only the editable division setup; teams/team names and coach assignments are not copied, and teams are named after evaluations; evaluations and historical results are never copied into a new season. Coaches may be assigned to multiple teams; coach-facing views must not show a comparison between assigned-team averages and division-wide averages; age-based evaluation groups can span multiple eventual divisions, with primary/makeup events and multiple evaluators; each player has one roster record per season; `evaluation_number` is season-specific and used to match the on-screen player to the number worn during evaluations; permanent internal player IDs are generated independently of personal data, and import matches require administrator confirmation; completed seasons are closed by default and require an explicit, audited administrator action to reopen.

**Next:** review/approve `docs/DATABASE-DESIGN.md`, then establish the SQL migration workflow. Database tables, aggregate functions, and RLS are not yet implemented.


## 2. Confirmed workflow requirements (2026-11-02)

These are agreed requirements, not implemented features. Keep implementation checkboxes unchecked until the feature is built and tested.

- [ ] Evaluation numbers can be generated from an administrator-chosen starting number, manually overridden, and imported from CSV; a player may be evaluated without a number.
- [ ] Evaluators can find and evaluate any player in their assigned division; coaches can evaluate players in any division.
- [ ] Record absences and provide an administrator absence report. Players who miss required evaluations are flagged for administrator handling and are not eligible to play unless the issue is resolved.
- [ ] Evaluators can save drafts, resume later, and edit submitted evaluations until session lock.
- [ ] Administrators determine completion; flag missing player ratings and missing evaluator submissions without requiring all submissions to be present.
- [ ] After lock, administrator corrections to submitted evaluations are permitted and audited.
- [ ] Optional team-balancing tool generates proposed rosters only; it is not the official team-management system. Export proposed rosters to CSV and provide a print-friendly view.
- [ ] For generated rosters, administrators set target team sizes; team sizes may differ by one player when the count does not divide evenly. Coaches are assigned first.
- [ ] An administrator can flag a coach's child for automatic placement on that coach's team. All coaches may see which players are designated as a coach's child; the designation is not hidden from coaches.
- [ ] Team suggestions may use available ratings, age, experience, and pitching/catching information. Missing ratings remain missing; use available information without inventing scores.
- [ ] Players added after team formation may have no evaluations. Preserve existing and historical ratings; do not silently alter or overwrite them.

## 4. Newly confirmed workflow requirements (2026-11-03)
- [x] Spring 2027 season is 2027-01-01 through 2027-06-30; preserve the existing record.
- [x] Active baseball divisions: AA, AAA, Majors, Juniors, Seniors.
- [x] Import all registrations including Pending; pending means payment is outstanding, not evaluation-ineligible. The app does not process payments.
- [x] Show registration status on player lists, player details, and reports; never show it on evaluation screens.
- [x] Import out-of-scope programs but flag for admin review and exclude from active evaluation pool by default.
- [x] Use supplied registration/evaluation number if present; otherwise leave blank until assigned.
- [x] Group evaluations by official Little League age, not final division; one age group may span multiple eventual divisions.
- [x] Track per-player attendance at each primary/makeup event separately from ratings; injured present players may have no or partial ratings.
- [x] Admin exemptions can resolve attendance and/or evaluation requirements only with explicit scope, reason, approver, and timestamp.
- [x] App records post-draft team/division assignments; it does not perform the official draft or replace official rostering.
- [x] Draft order is Seniors → Juniors → Majors → AAA → AA; mandatory top-age placement rules and admin-approved exceptions must be explicit and based on verified league rules.
- [x] Optional AA random team suggestions are advisory and require admin review.

## 5. Next implementation sequence (not yet implemented)
1. [ ] Reconcile the existing schema with the proposed age-based workflow; do not apply a migration yet.
2. [ ] Finalize and review `docs/IMPORT-WORKFLOW-DESIGN.md` and `docs/PROPOSED-DATA-MODEL-REVIEW.md`.
3. [ ] Implement CSV preview/validation, duplicate conflict handling, explicit identity matching, and admin-confirmed import transaction.
4. [ ] Add season registration status and out-of-scope review flags.
5. [ ] Add age-based evaluation groups, primary/makeup events, per-player attendance, performance records, and audited exemptions.
6. [ ] Add post-draft division/team assignment and configurable age-placement rules.
7. [ ] Validate the migration chain on a disposable local Supabase instance; reconcile RLS and regression tests.
8. [ ] Run `npm run lint` and `npm run build`; record results.
9. [ ] Test with separate admin, coach, and evaluator accounts and synthetic import edge cases.
10. [ ] Only after local review and explicit approval, plan hosted migration deployment.

**Status note:** the project ZIP contains five migrations, but their presence is not proof that this newly proposed workflow exists or is fully tested. Do not mark the new workflow complete until implementation and tests pass.

