# RWCLL Player Evaluations — Roadmap

A task is checked only after it is implemented **and tested**.

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

## 2. Development foundation
- [x] Create private GitHub repository and clone locally.
- [x] Scaffold Next.js app with Supabase starter.
- [x] Configure `.env.local`.
- [x] Verify `.env.local` is Git-ignored.
- [x] Load app at `http://localhost:3000`.
- [x] Commit scaffold (`34f85d2`) and push to `main`.
- [x] Create Supabase test user.
- [x] Sign in and display protected-page user claims.
- [ ] Add these docs to the Git repository and commit them.
- [ ] Establish version-controlled SQL migration workflow.
- [ ] Verify lint and production build.

## 3. Database foundation
- [ ] Design seasons, divisions, teams, players, user profiles, and roles.
- [ ] Separate stable player identity from season-specific registration/team/division/league age.
- [ ] Define season-specific Little League age calculation (official Aug. 31 rule).
- [ ] Confirm whether Sports Connect exports a stable member/registration ID.
- [ ] Design import preview, duplicate detection, and admin-confirmed matching; no silent name/DOB matching.
- [ ] Implement and test database migrations.
- [ ] Implement and test RLS for all league data.

## 4. Evaluations and permissions
- [ ] Create evaluation sessions and evaluator assignments.
- [ ] Implement coach and independent-evaluator submission flows.
- [ ] Require five core ratings for submitted evaluations.
- [ ] Implement optional pitching/catching ratings for AAA, Majors, Juniors, Seniors.
- [ ] Implement experience/interest Yes/No/Unknown questions.
- [ ] Implement Not Evaluated and average/count calculations.
- [ ] Keep evaluator-group averages separate.
- [ ] Enforce group-average-only coach access.
- [ ] Hide independent evaluator identities from coaches.
- [ ] Restrict individual submissions to administrators.
- [ ] Implement private coach notes and separately controlled shared notes.
- [ ] Implement draft/submitted/locked states, author/timestamp, and audit trail.
- [ ] Test permissions with separate role accounts.

## 5. Imports and history
- [ ] Build CSV/Excel import preview, mapping, duplicate detection, confirmation.
- [ ] Import current Sports Connect data after matching rules are approved.
- [ ] Obtain unredacted historical names or a reliable mapping file.
- [ ] Match historical AA ratings with administrator confirmation.
- [ ] Label historical coverage as partial (one team), keep read-only.
- [ ] Verify historical data is excluded from current averages.

## 6. User experience and launch
- [ ] Build role-specific dashboards and evaluation screens.
- [ ] Support multiple sessions by age group.
- [ ] Test phone, tablet, and desktop layouts.
- [ ] Test backup/restore and retention procedures.
- [ ] Confirm league policy for children’s names, birthdates, and retention.
- [ ] Verify hosting, pricing, environment variables, and production security.
- [ ] Run end-to-end pilot with test data and representative users.
- [ ] Obtain board approval before live data or launch.

## Current checkpoint
**Verified:** local app runs; `.env.local` is Git-ignored; scaffold is pushed; Supabase sign-in and protected-page claims work.

**Next:** add these docs to the repository, then design the database and migration approach. Database tables and RLS are not yet implemented.
