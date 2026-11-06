const fs = require('node:fs');
const path = require('node:path');
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261104220000_add_import_row_review_decisions.sql'), 'utf8');
for (const [label, pattern] of [
  ['admin authorization', /v_actor IS NULL OR NOT public\.is_admin\(\)/],
  ['explicit supported decisions', /'needs_review', 'ready_for_match_review', 'approved_new', 'approved_match', 'ignored'/],
  ['reason required', /Provide a review reason between 5 and 1000 characters/],
  ['matched player required for approved match', /p_decision = 'approved_match'\) <> \(p_matched_player_id IS NOT NULL/],
  ['player existence checked', /SELECT 1 FROM public\.players WHERE id = p_matched_player_id/],
  ['committed rows protected', /Committed rows cannot be changed through review/],
  ['audit record written', /sports_connect_import_row_reviewed/],
  ['no player or registration writes', !/INSERT INTO public\.(players|player_seasons)|UPDATE public\.(players|player_seasons)/.test(migration)],
  ['authenticated-only execute grant', /GRANT EXECUTE ON FUNCTION public\.review_sports_connect_import_row\(bigint, text, bigint, text\) TO authenticated/],
]) {
  const ok = typeof pattern === 'boolean' ? pattern : pattern.test(migration);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) process.exitCode = 1;
}


const ignoredMigrationPath = path.join(
  __dirname,
  "../supabase/migrations/20261105170000_enforce_ignored_import_row_terminal_state.sql",
);
const ignoredMigration = fs.readFileSync(ignoredMigrationPath, "utf8");
const reviewActions = fs.readFileSync(
  path.join(__dirname, "../app/protected/import-batches/review-actions.ts"),
  "utf8",
);
const reviewForm = fs.readFileSync(
  path.join(
    __dirname,
    "../app/protected/import-batches/[batchId]/review/review-decision-form.tsx",
  ),
  "utf8",
);

for (const [label, ok] of [
  [
    "ordinary review rejects ignored rows in the database",
    /v_before->>'review_state'\s*=\s*'ignored'/.test(ignoredMigration) &&
      /Ignored rows are terminal/.test(ignoredMigration),
  ],
  [
    "reopen RPC requires an administrator",
    /reopen_ignored_sports_connect_import_row[\s\S]*?v_actor IS NULL OR NOT public\.is_admin\(\)/.test(ignoredMigration),
  ],
  [
    "reopen RPC only accepts ignored rows",
    /v_before->>'review_state'\s*<>\s*'ignored'/.test(ignoredMigration),
  ],
  [
    "reopening records an audit event",
    /sports_connect_import_row_reopened/.test(ignoredMigration),
  ],
  [
    "reopening requires a reason",
    /Provide a reopening reason between 5 and 1000 characters/.test(ignoredMigration),
  ],
  [
    "server action calls the reopen RPC",
    /reopen_ignored_sports_connect_import_row/.test(reviewActions),
  ],
  [
    "UI disables ordinary review for ignored rows",
    /isIgnored/.test(reviewForm) &&
      /Reopen ignored row/.test(reviewForm),
  ],
]) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
}
