# Phase 5.5 — local-only validation

**Safety:** Run these steps against the local Supabase instance only. Do not use `supabase db push`, and do not apply this migration to hosted Supabase without explicit approval.

## 1. Apply the migration locally

From the repository root, first confirm that the local stack is running and inspect migration status:

```powershell
npx supabase status
npx supabase migration list
```

Copy `20261104230000_phase_5_5_sports_connect_commit.sql` into `supabase/migrations/` with that exact filename, then apply pending migrations locally:

```powershell
npx supabase migration up --local
```

If the migration command reports an error, stop and paste the full error. Do not try to apply the SQL a second way until we inspect the cause.

## 2. Read-only schema checks

Run in **local** Supabase Studio SQL Editor:

```sql
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'player_seasons'
  AND column_name IN (
    'season_division_id', 'external_registration_id', 'external_player_id', 'team_id'
  )
ORDER BY ordinal_position;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.player_seasons'::regclass
  AND conname = 'player_seasons_team_requires_division';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'player_seasons'
  AND indexname IN (
    'player_seasons_season_external_player_id_uidx',
    'player_seasons_season_external_registration_id_uidx'
  )
ORDER BY indexname;

SELECT routine_name, security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'commit_sports_connect_import_row';
```

Expected: `season_division_id` is nullable; `external_player_id` exists; the team-requires-division check and both partial unique indexes exist; the commit function is `DEFINER` security.

## 3. Inspect test rows before any commit

```sql
SELECT
  r.id AS staged_row_id,
  r.import_batch_id,
  b.season_id,
  b.import_type,
  r.source_row_number,
  r.first_name,
  r.last_name,
  r.review_state,
  r.matched_player_id,
  r.registration_number,
  r.external_player_id,
  r.committed_player_season_id
FROM public.sports_connect_import_rows r
JOIN public.import_batches b ON b.id = r.import_batch_id
ORDER BY r.import_batch_id, r.source_row_number;
```

Do not commit a row until the staged row is deliberately approved and the target season is confirmed open. The function requires an authenticated administrator context, so call it through the app's authenticated Supabase client or a logged-in SQL session that genuinely has the correct `auth.uid()` context. A normal Studio SQL editor session may not have that context.

## 4. Required behavioral checks

Use only fake test data, and record the selected row id before testing.

- An unresolved (`needs_review` / `ready_for_match_review`) or ignored row is rejected and creates no player/registration.
- `approved_new` creates one player and one `player_seasons` row with `season_division_id`, `team_id`, and `evaluation_number` all null.
- `approved_match` creates a season registration for the selected existing player without changing that player's name or date of birth.
- Repeating the commit call for an already committed row returns the same `player_seasons.id`; it does not create a second player, registration, or audit entry.
- An invalid/nonexistent matched player, closed season, non-player batch, missing season, missing names, or too-short reason is rejected atomically.
- A duplicate nonblank external player ID or registration ID within the same season is rejected by the unique indexes. A failed `approved_new` attempt must not leave behind its newly inserted player.
- Every successful first commit writes one `sports_connect_import_row_committed` audit entry and increments `rows_processed` once.
- A non-admin or unauthenticated caller cannot execute the function successfully.

## Notes

This migration intentionally does not change the hosted database. It also does not change the Sports Connect review UI; the commit function is a database capability that the next app step will call from an explicit admin commit control.
