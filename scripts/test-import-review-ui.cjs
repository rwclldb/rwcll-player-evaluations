const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = [
  'app/protected/import-batches/review-actions.ts',
  'app/protected/import-batches/[batchId]/review/page.tsx',
  'app/protected/import-batches/[batchId]/review/review-decision-form.tsx',
];
for (const file of files) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing Phase 5.4 file: ${file}`);
}
const action = fs.readFileSync(path.join(root, files[0]), 'utf8');
const page = fs.readFileSync(path.join(root, files[1]), 'utf8');
const form = fs.readFileSync(path.join(root, files[2]), 'utf8');
for (const [label, condition] of [
  ['server-side authentication', action.includes('supabase.auth.getClaims()')],
  ['server-side administrator check', action.includes('supabase.rpc("is_admin")')],
  ['batch/row relationship validation', action.includes('Number(row.import_batch_id) !== batchId')],
  ['audited review RPC', action.includes('review_sports_connect_import_row')],
  ['review reason length validation', action.includes('reason.length < 5') && action.includes('reason.length > 1000')],
  ['no import commit or player creation in action', !/\.from\("players"\)\s*\.insert|\.from\("players"\)\s*\.update|commit_sports_connect_import/i.test(action)],
  ['administrator-gated page', page.includes('supabase.rpc("is_admin")')],
  ['explicit read-only boundary', page.includes('does not create or update players or registrations')],
  ['reason-required UI', form.includes('required') && form.includes('minLength={5}')],
  ['approved match requires player selection', form.includes('(match && !matchedPlayerId)')],
]) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
}
console.log('PASS: Phase 5.4 static checks. These do not replace npm build/lint or local database/browser tests.');
