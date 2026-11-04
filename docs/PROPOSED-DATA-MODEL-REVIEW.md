# RWCLL — Proposed Data Model Review

**Status:** Design review only. Not a migration and not approved for execution. Existing Spring 2027 data/record must be preserved. No hosted database was changed while preparing this document.

## Existing schema constraints that conflict with the confirmed workflow

Static inspection of `supabase/migrations/20261103170921_initial_schema_baseline.sql` found:

- `player_seasons.season_division_id` is `NOT NULL`, so registration currently requires a division before the draft.
- `evaluation_sessions.season_division_id` is `NOT NULL` and unique, enforcing at most one session per season division.
- `evaluations` and the authorization helpers/policies use division-scoped foreign keys and access checks.
- A partial unique index currently scopes `evaluation_number` by `season_division_id`; the proposed workflow needs the uniqueness scope to be reviewed and likely changed to season-wide, since age groups can span divisions.
- `player_seasons` already enforces `UNIQUE(player_id, season_id)`, and the external registration ID index is season-scoped. These are useful foundations, but the external ID should not be treated as permanent player identity.
- `import_batches` exists, but there is no demonstrated row-level staging/decision model in the reviewed schema sufficient for the proposed preview workflow.

## Proposed target relationships

```text
seasons
  ├── season_divisions ── teams ── team assignments (after draft)
  ├── player_seasons / season registrations ── players
  │      ├── evaluation_attendance ── evaluation_sessions ── evaluation_groups (age-based)
  │      ├── evaluations ── ratings / answers / notes
  │      └── evaluation_exemptions (admin-approved)
  └── import_batches ── import_rows (staging, errors, matching decisions)
```

## Candidate changes to review before writing SQL

1. **Registration decoupling:** allow `player_seasons`/`season_registrations` to exist without `season_division_id` or `team_id`. Preserve one player-season row per internal player and season. Store `registration_status`, `source_program_name`, `source_division_name`, `import_review_status`, and `league_age`.
2. **Age groups and events:** add `evaluation_groups` with season and Little League age/group label; change `evaluation_sessions` to reference a group and store event date/type (`primary` or `makeup`). Multiple sessions per group are allowed. Rework dependent evaluator assignments and foreign keys.
3. **Attendance independent from scores:** add `evaluation_attendance` with a unique key on `(player_season_id, evaluation_session_id)`, attendance status, injury/limited-participation metadata where approved, and audit fields as needed.
4. **Evaluations independent from division:** rework `evaluations` so each evaluator's performance submission references a player-season and age-group event, not a mandatory season division. Keep session locking, submission validation, evaluator self-authorization, independent/coach separation, and audited admin corrections.
5. **Exemptions:** add an admin-only record with explicit scope (`attendance`, `evaluation`, `both`), reason, approver, timestamp, and audit trail. A mere absent/injured state is not an exemption.
6. **Evaluation number:** nullable; use imported value if present; no automatic assignment on import. Review season-wide uniqueness. Must not be an FK or permanent player identifier.
7. **Division/draft configuration:** keep active season divisions separate from age-based sessions. Add explicit per-season eligibility/top-age placement rules and approved exceptions only after league thresholds are verified. Draft outcomes are entered after the real draft; one final team assignment per player per season.
8. **Import staging:** add row-level staging and matching decisions. Preview has no side effects; commit is admin-only, transaction-safe, and idempotent. Audit all identity-linking decisions.
9. **RLS and safe views:** redesign RLS/helpers/secure views as part of the schema change, not as an afterthought. Registration status must be available to authorized player lists/details/reports but excluded from evaluator screen payloads. Coach-safe aggregates, private notes, and evaluator identity protection must remain enforced at the database layer.
10. **Age/rubric dependency:** existing optional pitching/catching rules refer to AAA and above, while the final division is unknown during age-based evaluation. The implementation should use a reviewed rule based on the age-group's configured potential division/rubric, or make those categories available without division-dependent assumptions. This is a product/rubric configuration point to resolve before coding the evaluator form; do not silently infer a final division.

## Migration safety sequence

1. Confirm local working tree and migration history against the ZIP; do not assume ZIP proves current hosted schema.
2. Preserve every migration already applied. Create a new reviewed migration sequence; do not edit applied baseline migrations.
3. Build an additive/backward-compatible transition where possible; identify every FK, index, trigger, function, policy, view, and server action that references `season_division_id` before dropping or changing it.
4. Use a disposable local Supabase instance and a fresh migration chain. If baseline reconciliation is not reliable, stop and resolve baseline/history first—do not use `db pull`, `db push`, or `db reset` against hosted Supabase as a shortcut.
5. Seed synthetic admin/coach/independent evaluator accounts and sample records locally. Run SQL catalog assertions plus behavioral RLS tests.
6. Run `npm run lint` and `npm run build`; capture outputs. They were not run as part of this document update.
7. Test preservation of Spring 2027 and verify no existing record is deleted/recreated. Review a backup/restore plan before any hosted schema change.
8. Only after written review/approval, plan a hosted migration with a known migration-history state and a rollback/recovery strategy.

## Approval gate

No migration SQL is included here intentionally. Approve the target model and settle the optional pitching/catching rubric rule before implementing DDL.
