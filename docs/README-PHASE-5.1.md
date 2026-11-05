# Phase 5.1 — Staged import batch review (read-only)

## What changed
- Adds `/protected/import-batches`, an administrator-only list of the 100 most recent player-import batches.
- Adds `/protected/import-batches/[batchId]`, an administrator-only view of staged rows, source fields, review flags, and current review state.
- Adds navigation from the protected home and CSV preview to batch review.
- Uses server-side `getClaims()` and the database-backed `is_admin()` check on both review routes.
- Places request-specific work behind React Suspense boundaries and uses `connection()` for Next.js request-time rendering.
- Bounds the batch list to 100 and staged rows to the staging limit of 5,000.
- Adds `npm run test:import-batch-review` static contract checks.

## Safety boundary
This phase is read-only. It adds no SQL migration and does not insert, update, upsert, or delete any database records. It does not approve rows, match players, merge identities, or commit registrations. The Phase 5.0 migration must already be applied to the **local disposable Supabase database** before the new views can show actual staged batches. If it is not applied, the UI shows a setup/error message.

Hosted Supabase has not been changed. Do not apply the Phase 5.0 migration to hosted Supabase without explicit approval.

## Apply
1. Extract this ZIP to a separate folder.
2. Copy the new `app/protected/import-batches/` directory and `README-PHASE-5.1.md` into the existing project.
3. Replace `app/protected/page.tsx`, `app/protected/import-preview/page.tsx`, and `package.json` with the versions in this bundle. Keep `.env.local` and existing migration files unchanged.
4. Run:
   - `npm run test:import-preview`
   - `npm run test:import-batch-review`
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm run build`

## Validation status
The preview and batch-review static tests pass in the generation workspace. They verify fixture parsing, TSX syntax, administrator gate presence, request-time rendering boundaries, bounded queries, and the read-only UI contract. A full production build, lint, type-check, and database integration test must be run in the user's installed project environment; the generation workspace does not contain the dependency installation. No database commands were run.

## Next stage
After the local staging migration is safely applied and tested with fake CSV data, add human-reviewed candidate matching. Matching suggestions must never automatically link or merge players; uncertain matches require administrator resolution.
