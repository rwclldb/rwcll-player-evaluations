# Stage 1 — Session Administration Test Plan

Run these checks against the **local Supabase project only**. Do not apply these migrations to the hosted project as part of this checklist.

## Automated checks

From the repository root:

```powershell
npm run test:session-administration
npm run test:evaluation-review-ui
npm run lint
npx tsc --noEmit
npm run build
```

After the focused checks pass, run the full suite:

```powershell
npm run test:all
```

The focused session-administration test is a source-level regression check. It does not replace runtime database/UI testing.

## Apply the local migrations

Inspect the local migration status first, then apply pending migrations to the local database:

```powershell
npx supabase migration list --local
npx supabase migration up --local
```

Confirm these new migrations appear as applied locally:

- `20261109090000_allow_all_payment_statuses_in_evaluations.sql`
- `20261109100000_add_evaluation_session_events.sql`

Do not use `supabase db push` for this local-only test plan.

## Manual administrator tests

Use the local app and sign in as the administrator.

1. Open **Evaluation Sessions**.
2. For a season that currently has ages 8–16, create missing sessions. Confirm age 7 is created and age 6 is not offered. Confirm the page reports ten age sessions (ages 7–16).
3. For a setup session, enter a primary event date, start time, end time, and location; save it and confirm the values remain after refresh.
4. Add two makeup events. Confirm both are listed and can be edited or removed while the session remains in Setup.
5. Try to open a session before scheduling a primary event. The UI should prevent opening and explain the missing requirement.
6. Schedule a primary event but leave the session without an evaluator assignment. The UI should prevent opening and explain that an evaluator must be assigned.
7. Assign at least one evaluator using the existing evaluator-assignment workflow. Confirm the session can now be opened.
8. After opening, confirm event fields are read-only and event changes are rejected server-side. Confirm a locked session remains locked.
9. Close a test season if one is available, and confirm events cannot be added or edited in that season.

## Manual evaluator eligibility tests

Use synthetic local registrations only. For one open age session, verify registrations with `Paid`, `Pending`, `Unpaid`, `UNKNOWN`, and a blank payment status where present are selectable when their season and Little League age match the session. Verify an age-6 registration is not selectable in an age-7 session, and a different-age registration is not selectable.

Payment status must not appear on the evaluator rating interface or the administrator evaluation-review screen. Existing payment values must remain unchanged.

## Security/database checks

- Confirm a non-admin cannot create, update, or delete session events.
- Confirm an evaluator assigned to a session can read that session's event details but cannot edit them.
- Confirm an administrator cannot open a session without both a primary event and at least one evaluator assignment, even if attempting a direct database update.
- Confirm events cannot be changed after the session is open or the season is closed.

Use a disposable synthetic session for any direct SQL negative tests. Do not change real season/player records.
