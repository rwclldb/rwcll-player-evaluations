# RWCLL secure evaluation workflow — local test plan

> **Status:** The original tests below were written for a division-based evaluation model. The 2026-11-03 confirmed workflow is age-based and allows one age group to span eventual divisions. Do not treat the old division-specific setup as the final regression suite. Use the migration/design review documents to update the fixtures and foreign-key expectations before executing this plan.

## Status after 2026-11-03 age-based workflow decisions
- No migration for age-based evaluation groups, primary/makeup events, registration status, per-player attendance, or exemptions has been implemented by this documentation update.
- Do not run this legacy test plan as the sole acceptance test for the revised workflow.
- Do not apply migrations to hosted Supabase during this phase.
- Preserve existing migrations; add reviewed migrations rather than editing already-applied files.

## Required additional regression coverage
1. One player-season registration can exist without a division/team assignment.
2. One age-based group can contain players later assigned to different divisions.
3. A group supports primary and makeup events; each player's attendance is stored separately per event.
4. Pending and completed registrations are importable and evaluation-eligible; payment status is not exposed by evaluation reads.
5. Registration status appears in authorized player lists/details/reports.
6. Duplicate Player IDs within a batch block unsafe commit and never auto-merge players.
7. Same external ID across seasons is allowed; matching remains admin-confirmed; different IDs do not block candidate review.
8. Out-of-scope source programs are imported with a review flag and excluded from active evaluation by default.
9. Registration numbers may remain null; assigned values are unique in the agreed season scope.
10. Injured present players can have no/partial ratings without fabricated scores; attendance and evaluation completeness remain distinct.
11. Exemptions require admin authorization, explicit scope, reason, approver, timestamp, and audit record.
12. Final team/division assignment occurs after evaluation; no player has more than one team assignment per season; age-placement rules and exceptions are explicit.
13. Existing RLS guarantees remain intact for admin, coach, and independent evaluator roles; coach-safe aggregate and private-note protections are tested at database level.

## Legacy division-based tests (retain as reference, update before execution)


**Do not run this migration against hosted Supabase.** These checks are for a local database only.

## Files
- `20261103180646_secure_evaluation_workflows_replacement.sql` — replacement migration.
- `secure_workflow_regression_checks.sql` — read-only catalog/seed assertions.

## 1. Apply on a fresh local database
From the repository root in VS Code PowerShell:

```powershell
npx supabase db reset --local
```

This resets the local database and applies migrations tracked in `supabase/migrations`. Copy the replacement migration into that folder using a new timestamped filename, replacing the unfinished `20261103180646_secure_evaluation_workflows.sql` rather than keeping both. Do not rename or edit the already-applied baseline migrations.

Then run:

```powershell
npx supabase db reset --local
```

If PostgreSQL reports an error, stop and save the full error. Do not try the hosted database.

## 2. Run the static regression checks
In the local Supabase SQL editor or local `psql`, run `secure_workflow_regression_checks.sql`. It should finish with `Secure workflow catalog checks passed.`

## 3. Required authorization tests with two test evaluators
Use throwaway local auth users only. Set up one test season, one division/session, two evaluator users with assignments in that session, and two players in that division.

1. **Assigned evaluator can create their own draft.** As evaluator A, create an evaluation for player A in the open session with evaluator_type matching A's assignment. It should succeed.
2. **Cannot impersonate another evaluator.** As evaluator A, attempt to insert an evaluation with evaluator_user_id set to evaluator B. It must fail.
3. **Cannot evaluate another division/session.** As evaluator A, attempt an evaluation for a player outside the assigned session/division. It must fail.
4. **Can write only their own evaluation.** A can add/edit ratings and experience answers for A's evaluation, but cannot edit B's evaluation's child rows.
5. **Submission validation remains active.** Submitting fewer than five core ratings must fail. Submitting with all five core ratings should succeed.
6. **Not-evaluated validation remains active.** A `not_evaluated` evaluation cannot have ratings.
7. **Session lock blocks evaluator edits.** Lock the session as admin. As evaluator A, attempt to edit the evaluation and its ratings/answers/notes; each must fail.
8. **Locked sessions cannot be reopened.** Attempt `UPDATE public.evaluation_sessions SET status='open' ...` on a locked session. It must fail.
9. **Closed season blocks evaluator edits.** In a separate open session, set the season's `is_closed=true`; evaluator edits must fail.
10. **Admin correction requires a reason and leaves an audit record.** As admin, call `admin_correct_evaluation` against a locked evaluation with a reason of at least 8 characters and a valid rating/answer change. It should succeed without reopening the session and append one `audit_log` record with before/after snapshots.
11. **Admin correction denied to non-admin.** Call the same function as evaluator A; it must fail.
12. **Correction validation still applies.** Try to mark an evaluation `not_evaluated` while it has ratings, or submit it without all five core ratings. It must fail and leave no audit row because the transaction rolls back.
13. **Historical data stays read-only.** Confirm no policy or grant added by this migration permits writes to `historical_evaluations` or `historical_ratings`.
14. **Independent evaluator identity remains hidden.** Test actual coach-facing API/view queries. This migration does not add a coach-safe aggregate or notes projection; do not expose raw `evaluations` joins to coaches as the final UI.

## Important review caveats before use
- The current baseline has broad `admins_manage_all` policies. This migration's trigger blocks non-`postgres` writes to locked/closed workflow data, while the audited SECURITY DEFINER correction function is intended to make locked corrections. Review function ownership on the actual local database before relying on the `current_user = 'postgres'` bypass.
- Coach-safe aggregate summaries, coach access to evaluator notes without identity leakage, and separate coach-private/shared notes are not implemented by this migration. They require dedicated views/RPCs and policy tests before production.
- The trigger guards workflow rows and session reopening; they are not a substitute for testing every API operation using real authenticated roles.
- This migration has not been executed against a database in this artifact-generation environment. Treat it as a candidate for local validation, not as tested or production-ready.
