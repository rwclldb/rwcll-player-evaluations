-- Runtime check: deleting accounts from the People page. Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000de001', 'del-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000de002', 'del-admin2@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000de003', 'del-unused@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000de004', 'del-scorer@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000de005', 'del-evalnote@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Delete check season', '2099-01-01', '2099-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT (SELECT id FROM public.seasons WHERE name = 'Delete check season') AS season_id;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000de001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000de002', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000de003', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000de004', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000de005', 'independent_evaluator', (SELECT season_id FROM ctx));
INSERT INTO public.user_profiles (user_id, display_name) VALUES ('00000000-0000-4000-8000-0000000de003', 'Unused Coach');
INSERT INTO public.coach_divisions (season_id, user_id, division_id)
  SELECT season_id, '00000000-0000-4000-8000-0000000de003', (SELECT id FROM public.divisions ORDER BY id LIMIT 1) FROM ctx;
INSERT INTO public.evaluation_sessions (season_id, league_age, status) SELECT season_id, 9, 'open' FROM ctx;
ALTER TABLE ctx ADD COLUMN session_id bigint;
UPDATE ctx SET session_id = (SELECT id FROM public.evaluation_sessions WHERE season_id = ctx.season_id);
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type, assigned_by)
  SELECT session_id, u, t, '00000000-0000-4000-8000-0000000de003' FROM ctx,
  (VALUES ('00000000-0000-4000-8000-0000000de003'::uuid, 'coach'), ('00000000-0000-4000-8000-0000000de004'::uuid, 'coach'),
          ('00000000-0000-4000-8000-0000000de005'::uuid, 'independent_evaluator')) v(u, t);
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Del', 'Player', '2017-01-01');
INSERT INTO public.player_seasons (player_id, season_id, league_age)
  SELECT (SELECT id FROM public.players WHERE last_name = 'Player' AND first_name = 'Del'), season_id, 9 FROM ctx;
ALTER TABLE ctx ADD COLUMN ps_id bigint;
UPDATE ctx SET ps_id = (SELECT id FROM public.player_seasons WHERE season_id = ctx.season_id);
INSERT INTO public.private_notes (player_season_id, author_user_id, note_text) SELECT ps_id, '00000000-0000-4000-8000-0000000de003', 'mine' FROM ctx;
INSERT INTO public.player_stars (user_id, player_season_id) SELECT '00000000-0000-4000-8000-0000000de003', ps_id FROM ctx;
SET LOCAL session_replication_role = replica;
INSERT INTO public.evaluations (evaluation_session_id, player_season_id, evaluator_user_id, evaluator_type, status, submitted_at)
  SELECT session_id, ps_id, u, t, 'submitted', now() FROM ctx,
  (VALUES ('00000000-0000-4000-8000-0000000de004'::uuid, 'coach'), ('00000000-0000-4000-8000-0000000de005'::uuid, 'independent_evaluator')) v(u, t);
INSERT INTO public.evaluator_notes (evaluation_id, author_user_id, note_text)
  SELECT id, evaluator_user_id, 'shared' FROM public.evaluations WHERE evaluator_user_id = '00000000-0000-4000-8000-0000000de005';
SET LOCAL session_replication_role = origin;
INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id) VALUES ('00000000-0000-4000-8000-0000000de003', 'account_name_changed', 'auth.users', 'x');

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text) TO authenticated;
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_fragment text, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_fragment IN SQLERRM) > 0 THEN RAISE NOTICE 'PASS: %', p_label; RETURN; END IF;
    RAISE EXCEPTION 'FAIL: % (wrong error: %)', p_label, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL: % (no error raised)', p_label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect_error(text, text, text) TO authenticated;
CREATE FUNCTION pg_temp.blockers(p uuid) RETURNS text LANGUAGE sql AS $$
  SELECT array_to_string(blockers, '; ') FROM public.admin_account_delete_blockers() WHERE user_id = p;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.blockers(uuid) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000de003","role":"authenticated"}', true);
SELECT pg_temp.expect_error('SELECT public.admin_delete_account(''00000000-0000-4000-8000-0000000de004'')', 'Administrator access required', 'a coach cannot delete accounts');
SELECT pg_temp.check((SELECT count(*) FROM public.admin_account_delete_blockers()) = 0, 'a coach sees no delete information');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000de001","role":"authenticated"}', true);
SELECT pg_temp.check(pg_temp.blockers('00000000-0000-4000-8000-0000000de003') = '', 'an unused coach account can be deleted');
SELECT pg_temp.check(pg_temp.blockers('00000000-0000-4000-8000-0000000de004') LIKE '%scored players%', 'a coach who scored cannot');
SELECT pg_temp.check(pg_temp.blockers('00000000-0000-4000-8000-0000000de005') LIKE '%scored players%evaluator notes%', 'an evaluator with notes cannot');
SELECT pg_temp.check(pg_temp.blockers('00000000-0000-4000-8000-0000000de002') LIKE '%league admin%', 'another admin cannot');
SELECT pg_temp.check(pg_temp.blockers('00000000-0000-4000-8000-0000000de001') LIKE '%your own account%', 'you cannot delete yourself');
SELECT pg_temp.expect_error('SELECT public.admin_delete_account(''00000000-0000-4000-8000-0000000de004'')', 'Disable it instead', 'deleting a scorer is refused');

SELECT pg_temp.check(public.admin_delete_account('00000000-0000-4000-8000-0000000de003') = 'del-unused@example.test', 'deleting returns the email');
RESET ROLE;
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-4000-8000-0000000de003'), 'the sign-in account is gone');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = '00000000-0000-4000-8000-0000000de003')
  AND NOT EXISTS (SELECT 1 FROM public.coach_divisions WHERE user_id = '00000000-0000-4000-8000-0000000de003')
  AND NOT EXISTS (SELECT 1 FROM public.evaluator_assignments WHERE evaluator_user_id = '00000000-0000-4000-8000-0000000de003')
  AND NOT EXISTS (SELECT 1 FROM public.private_notes WHERE author_user_id = '00000000-0000-4000-8000-0000000de003')
  AND NOT EXISTS (SELECT 1 FROM public.player_stars WHERE user_id = '00000000-0000-4000-8000-0000000de003')
  AND NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = '00000000-0000-4000-8000-0000000de003'),
  'roles, divisions, assignments, private notes, stars and profile are removed');
SELECT pg_temp.check((SELECT count(*) FROM public.evaluator_assignments WHERE assigned_by IS NULL AND evaluation_session_id = (SELECT session_id FROM ctx)) = 2,
  'other people''s assignments stay, with "assigned by" cleared');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.audit_log WHERE actor_user_id = '00000000-0000-4000-8000-0000000de003' AND action = 'account_name_changed'),
  'the person''s past audit entries are kept');
SELECT pg_temp.check((SELECT before_data->>'email' FROM public.audit_log WHERE action = 'account_deleted' AND target_id = '00000000-0000-4000-8000-0000000de003') = 'del-unused@example.test'
  AND (SELECT (before_data->>'private_notes_deleted')::int FROM public.audit_log WHERE action = 'account_deleted' AND target_id = '00000000-0000-4000-8000-0000000de003') = 1,
  'the deletion is audited with the email and what was removed');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM auth.users WHERE id = '00000000-0000-4000-8000-0000000de004'), 'the scorer''s account is untouched');

ROLLBACK;
