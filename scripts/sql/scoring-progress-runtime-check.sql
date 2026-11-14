-- Runtime check: admin scoring progress. Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000ec001', 'sp-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ec002', 'sp-coach@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ec003', 'sp-eval@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Progress check season', '2091-01-01', '2091-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT (SELECT id FROM public.seasons WHERE name = 'Progress check season') AS season_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000ec001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000ec002', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000ec003', 'independent_evaluator', (SELECT season_id FROM ctx));
INSERT INTO public.user_profiles (user_id, display_name) VALUES ('00000000-0000-4000-8000-0000000ec002', 'Pat Coach');
INSERT INTO public.evaluation_sessions (season_id, league_age, status) SELECT season_id, a, 'open' FROM ctx, (VALUES (9), (10)) v(a);
ALTER TABLE ctx ADD COLUMN s9 bigint;
UPDATE ctx SET s9 = (SELECT id FROM public.evaluation_sessions WHERE season_id = ctx.season_id AND league_age = 9);
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT s9, '00000000-0000-4000-8000-0000000ec002'::uuid, 'coach' FROM ctx UNION ALL
  SELECT s9, '00000000-0000-4000-8000-0000000ec003', 'independent_evaluator' FROM ctx;
INSERT INTO public.players (first_name, last_name, date_of_birth) SELECT 'P' || g, 'Progtest', '2016-01-01' FROM generate_series(1, 4) g;
INSERT INTO public.player_seasons (player_id, season_id, league_age)
  SELECT p.id, (SELECT season_id FROM ctx), 9 FROM public.players p WHERE p.last_name = 'Progtest';
SET LOCAL session_replication_role = replica;
INSERT INTO public.evaluations (evaluation_session_id, player_season_id, evaluator_user_id, evaluator_type, status, submitted_at)
  SELECT (SELECT s9 FROM ctx), ps.id, '00000000-0000-4000-8000-0000000ec002'::uuid, 'coach', st, CASE WHEN st = 'submitted' THEN now() END
  FROM (SELECT id, row_number() OVER (ORDER BY id) n FROM public.player_seasons WHERE season_id = (SELECT season_id FROM ctx)) ps
  JOIN (VALUES (1, 'submitted'), (2, 'submitted'), (3, 'not_evaluated'), (4, 'draft')) v(n, st) ON v.n = ps.n;
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000ec001","role":"authenticated"}', true);
SELECT pg_temp.check((SELECT saved = 2 AND not_evaluated = 1 AND drafts = 1 AND players = 4 AND last_saved_at IS NOT NULL AND scorer_name = 'Pat Coach'
  FROM public.admin_scoring_progress((SELECT season_id FROM ctx)) WHERE evaluator_type = 'coach'), 'the coach''s counts are right (2 saved, 1 not evaluated, 1 draft of 4)');
SELECT pg_temp.check((SELECT saved = 0 AND last_saved_at IS NULL AND scorer_name = 'sp-eval@example.test'
  FROM public.admin_scoring_progress((SELECT season_id FROM ctx)) WHERE evaluator_type = 'independent_evaluator'), 'an evaluator who hasn''t started shows 0 (email when no name)');
SELECT pg_temp.check((SELECT count(*) FROM public.admin_scoring_progress((SELECT season_id FROM ctx)) WHERE league_age = 10 AND user_id IS NULL) = 1,
  'an age group with nobody assigned still appears');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000ec002","role":"authenticated"}', true);
SELECT pg_temp.check((SELECT count(*) FROM public.admin_scoring_progress((SELECT season_id FROM ctx))) = 0, 'a coach gets nothing');
RESET ROLE;

ROLLBACK;
