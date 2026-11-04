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
