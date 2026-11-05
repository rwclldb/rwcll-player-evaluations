# Phase 5.4 — Administrator review UI (additive bundle)

Adds a separate administrator review page for staged Sports Connect rows and a form that records decisions through the Phase 5.3 audited RPC.

## Safety boundary

This phase records review decisions only. It does not create or update players or registrations, merge identities, or commit a batch. `approved_new` means the row was reviewed as a prospective new player; it does **not** create one. A reason (5–1,000 characters) is required. The database RPC remains the write boundary and writes the audit record.

The page's candidate suggestions are intentionally conservative and limited: it loads at most 1,000 players and displays up to 10 name/birth-date matches per row. Suggestions are not identity proof; verify manually. Do not use Sports Connect IDs as permanent identity.

## Install into existing project

1. Confirm you are in `D:\sandbox\GitHubRepos\rwcll-player-evaluations` and make a backup/commit checkpoint (your recent `ace9689` commit is a good checkpoint).
2. Copy these files into the matching paths, preserving existing files:
   - `app/protected/import-batches/review-actions.ts`
   - `app/protected/import-batches/[batchId]/review/page.tsx`
   - `app/protected/import-batches/[batchId]/review/review-decision-form.tsx`
   - `scripts/test-import-review-ui.cjs`
3. Add this script entry to the existing `package.json` `scripts` object; do not replace the whole file:
   `"test:import-review-ui": "node scripts/test-import-review-ui.cjs"`
4. In `app/protected/import-batches/[batchId]/page.tsx`, add a link near the batch heading, using the current `batch.id`:
   `<Link className="text-sm underline" href={`/protected/import-batches/${batch.id}/review`}>Open administrator row review →</Link>`
   Place it inside the component's returned JSX where `batch` is in scope. This is an additive navigation link; don't replace the existing detail page.
5. Run `npm run test:import-review-ui`, then the existing tests, lint, TypeScript check, and build as listed below.

## Local-only validation

```powershell
npm run test:import-review-ui
npm run test:import-review-decisions
npm run test:import-preview
npm run test:import-batch-review
npm run test:import-candidates
npm run lint
npx tsc --noEmit
npm run build
```

No new migration is required if Phase 5.3's `review_sports_connect_import_row` migration is already applied to local Supabase. If the page reports an RPC error, check local migration status first; do not run hosted database commands. Do not run `supabase db reset`, `supabase db push`, or `supabase link` for this phase.

## Browser test with fictional data

1. Start local Supabase and the Next.js app; sign in with the local administrator account.
2. Open `/protected/import-batches`, select a fictional test batch, and use **Open administrator row review**.
3. For one row, try saving with no reason or fewer than 5 characters; the form must prevent submission.
4. Choose `needs_review`, enter a reason of at least 5 characters, and save. Expect a success message.
5. Reload the page and confirm the review state persisted. In local Supabase Studio, verify a matching `audit_log` row with action `sports_connect_import_row_reviewed`, the row ID, and the supplied reason.
6. Try `approved_match` without a player selection; it must be blocked. Then select a suggested existing player only if you can verify the identity, provide a reason, and save.
7. Confirm no `players` or `player_season_registrations` rows were created or modified by these review decisions.
8. Sign in as a non-admin/test user and confirm the page does not permit review actions.

## Limits / test status

The included script is a static source-contract test, not a PostgreSQL integration test. This bundle was generated additively and has not been run against the user's actual working tree or local database. Run the listed checks after installation and share any errors before committing. Hosted Supabase is not changed by this bundle.
