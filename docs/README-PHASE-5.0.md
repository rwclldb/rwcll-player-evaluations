# Phase 5.0 — Sports Connect database staging foundation

## What changed
- Adds `season_id` to import batch metadata and a protected `sports_connect_import_rows` table.
- Adds `stage_sports_connect_import(...)`, an administrator-only transaction that saves the minimal preview rows for review, records an audit entry, rejects closed/missing seasons, and limits each batch to 5,000 rows.
- Adds a server action that rechecks authentication and administrator status before calling the database function.
- The preview page now requires selection of an existing open season and has an explicit **Save batch for review** action.
- Account names, emails, order numbers, and order dates are not sent to the staging function.

## Safety boundary
**Staging is not importing.** This phase writes only an `import_batches` row, staging rows, and an audit-log row. It does not create/update `players` or `player_seasons`. It does not auto-match players. There is no commit action yet.

## Files added/changed
- `supabase/migrations/20261104210000_add_sports_connect_staging.sql` (new; not applied)
- `app/protected/import-preview/actions.ts` (new)
- `app/protected/import-preview/page.tsx`
- `app/protected/import-preview/registration-import-preview.tsx`
- `scripts/test-import-preview.cjs`

## Validation
Run `npm run test:import-preview`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`. Static tests check the staging authorization and safety contract but do not replace PostgreSQL integration/security tests. Before using staging, apply the migration to the disposable local Supabase instance only, verify the target, then test with fake CSV data. Do not apply this migration to hosted Supabase without explicit approval.

## Known next steps
1. Add an administrator review page for staged batches and row decisions.
2. Add match suggestions that never auto-link.
3. Add an atomic, separately confirmed commit RPC after division mapping and conflict policy tests.
