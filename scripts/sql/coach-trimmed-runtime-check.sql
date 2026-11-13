-- Runtime check: coach trimmed mean in the draft report (high and low coach score dropped per skill). Rolled back.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000ba001', 'tm-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000bc001', 'tm-coach1@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000bc002', 'tm-coach2@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000bc003', 'tm-coach3@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000bc004', 'tm-coach4@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000be001', 'tm-eval@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('TM check season', '2099-01-01', '2099-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT (SELECT id FROM public.seasons WHERE name = 'TM check season') AS season_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id)
  SELECT '00000000-0000-4000-8000-0000000ba001'::uuid, 'administrator', NULL
  UNION ALL SELECT u::uuid, 'coach', (SELECT season_id FROM ctx) FROM unnest(ARRAY[
    '00000000-0000-4000-8000-0000000bc001', '00000000-0000-4000-8000-0000000bc002',
    '00000000-0000-4000-8000-0000000bc003', '00000000-0000-4000-8000-0000000bc004']) u
  UNION ALL SELECT '00000000-0000-4000-8000-0000000be001'::uuid, 'independent_evaluator', (SELECT season_id FROM ctx);
INSERT INTO public.players (first_name, last_name) VALUES ('Tm', 'Alpha'), ('Tm', 'Beta');
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number)
  SELECT id, (SELECT season_id FROM ctx), 10, CASE last_name WHEN 'Alpha' THEN 801 ELSE 802 END FROM public.players WHERE first_name = 'Tm';
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES ((SELECT season_id FROM ctx), 10, 'setup');
ALTER TABLE ctx ADD COLUMN session_id bigint, ADD COLUMN alpha bigint, ADD COLUMN beta bigint;
UPDATE ctx SET session_id = (SELECT id FROM public.evaluation_sessions WHERE season_id = ctx.season_id),
  alpha = (SELECT ps.id FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Alpha' AND ps.season_id = ctx.season_id),
  beta = (SELECT ps.id FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Beta' AND ps.season_id = ctx.season_id);
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location)
  SELECT session_id, 'primary', '2099-01-23', '09:00', '10:30', 'Check Field' FROM ctx;
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT (SELECT session_id FROM ctx), u::uuid, 'coach' FROM unnest(ARRAY[
    '00000000-0000-4000-8000-0000000bc001', '00000000-0000-4000-8000-0000000bc002',
    '00000000-0000-4000-8000-0000000bc003', '00000000-0000-4000-8000-0000000bc004']) u
  UNION ALL SELECT (SELECT session_id FROM ctx), '00000000-0000-4000-8000-0000000be001'::uuid, 'independent_evaluator';
UPDATE public.evaluation_sessions SET status = 'open' WHERE id = (SELECT session_id FROM ctx);

CREATE FUNCTION pg_temp.as_user(p_uuid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uuid, 'role', 'authenticated')::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO authenticated;
CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF; RAISE NOTICE 'PASS: %', p_label; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text) TO authenticated;
CREATE FUNCTION pg_temp.rate(p_user text, p_player bigint, p_ratings jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(p_user);
  PERFORM public.save_evaluation((SELECT session_id FROM ctx), p_player, p_ratings, '{}'::jsonb, 'submitted');
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.rate(text, bigint, jsonb) TO authenticated;

SET LOCAL ROLE authenticated;
-- Alpha: hitting 1,3,4,5 | throwing 2,2,2,5 | grounders 4,5 (only two coaches) | pitching mechanics 1,2,5
SELECT pg_temp.rate('00000000-0000-4000-8000-0000000bc001', (SELECT alpha FROM ctx), '{"hitting":1,"throwing":2,"grounders":4,"pitching_mechanics":1}');
SELECT pg_temp.rate('00000000-0000-4000-8000-0000000bc002', (SELECT alpha FROM ctx), '{"hitting":3,"throwing":2,"grounders":5,"pitching_mechanics":2}');
SELECT pg_temp.rate('00000000-0000-4000-8000-0000000bc003', (SELECT alpha FROM ctx), '{"hitting":4,"throwing":2,"pitching_mechanics":5}');
SELECT pg_temp.rate('00000000-0000-4000-8000-0000000bc004', (SELECT alpha FROM ctx), '{"hitting":5,"throwing":5}');
SELECT pg_temp.rate('00000000-0000-4000-8000-0000000be001', (SELECT alpha FROM ctx), '{"hitting":5}');
-- Beta: two coaches only.
SELECT pg_temp.rate('00000000-0000-4000-8000-0000000bc001', (SELECT beta FROM ctx), '{"hitting":3}');
SELECT pg_temp.rate('00000000-0000-4000-8000-0000000bc002', (SELECT beta FROM ctx), '{"hitting":5}');

SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ba001');
CREATE TEMP TABLE rep ON COMMIT DROP AS SELECT * FROM public.draft_report((SELECT session_id FROM ctx));
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT * FROM rep WHERE player_season_id = (SELECT alpha FROM ctx);
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT * FROM rep WHERE player_season_id = (SELECT beta FROM ctx);

SELECT pg_temp.check((SELECT coach_overall = 3.5 AND coach_evaluations = 4 FROM a),
  'normal coach overall is unchanged: (3.25 + 2.75 + 4.50) / 3 = 3.50');
SELECT pg_temp.check((SELECT (skill_averages -> 'coach_trimmed' ->> 'hitting')::numeric = 3.5 FROM a),
  'hitting 1,3,4,5: drop 1 and 5, trimmed 3.50');
SELECT pg_temp.check((SELECT (skill_averages -> 'coach_trimmed' ->> 'throwing')::numeric = 2.0 FROM a),
  'throwing 2,2,2,5: drop one 2 and the 5 (a tie is dropped once), trimmed 2.00');
SELECT pg_temp.check((SELECT NOT ((skill_averages -> 'coach_trimmed') ? 'grounders') FROM a),
  'grounders scored by only 2 coaches: no trimmed value');
SELECT pg_temp.check((SELECT round((skill_averages ->> 'coach_trimmed_overall')::numeric, 2) = 3.33 FROM a),
  'trimmed overall: (3.50 + 2.00 + 4.50) / 3 = 3.33 (grounders uses its normal mean)');
SELECT pg_temp.check((SELECT (skill_averages -> 'coach_trimmed' ->> 'pitching')::numeric = 2.0
                         AND (skill_averages -> 'coach' ->> 'pitching')::numeric = 2.67 FROM a),
  'pitching 1,2,5: trimmed 2.00 next to mean 2.67');
SELECT pg_temp.check((SELECT evaluator_overall = 5 AND NOT (skill_averages ? 'evaluator_trimmed') FROM a),
  'evaluator scores are not trimmed and do not change the coach numbers');
SELECT pg_temp.check((SELECT NOT (skill_averages ? 'coach_trimmed_overall') AND skill_averages -> 'coach_trimmed' = '{}'::jsonb AND coach_overall = 4 FROM b),
  'only 2 coaches: no trimmed values, normal mean 4.00');
RESET ROLE;
ROLLBACK;
