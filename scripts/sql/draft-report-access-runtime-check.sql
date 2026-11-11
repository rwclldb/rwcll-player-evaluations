-- Runtime check: draft report access, values, prior-year switch, and season-wide bibs. Rolled back.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000da001', 'dr-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000dc001', 'dr-coach@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000de001', 'dr-eval@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000dc002', 'dr-other-season-coach@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000de002', 'dr-unassigned-eval@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('DR check season', '2099-01-01', '2099-06-30'), ('DR other season', '2098-01-01', '2098-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS
  SELECT (SELECT id FROM public.seasons WHERE name = 'DR check season') AS season_id, (SELECT id FROM public.seasons WHERE name = 'DR other season') AS other_season_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000da001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000dc001', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000de001', 'independent_evaluator', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000dc002', 'coach', (SELECT other_season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000de002', 'independent_evaluator', (SELECT season_id FROM ctx));
INSERT INTO public.players (first_name, last_name) VALUES ('Dr', 'Alpha'), ('Dr', 'Beta');
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number)
  SELECT id, (SELECT season_id FROM ctx), 10, CASE last_name WHEN 'Alpha' THEN 501 ELSE 502 END FROM public.players WHERE first_name = 'Dr';
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES ((SELECT season_id FROM ctx), 10, 'setup');
ALTER TABLE ctx ADD COLUMN session_id bigint, ADD COLUMN alpha bigint, ADD COLUMN alpha_player bigint;
UPDATE ctx SET session_id = (SELECT id FROM public.evaluation_sessions WHERE season_id = ctx.season_id),
  alpha = (SELECT ps.id FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Alpha' AND ps.season_id = ctx.season_id),
  alpha_player = (SELECT id FROM public.players WHERE first_name = 'Dr' AND last_name = 'Alpha');
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location)
  SELECT session_id, 'primary', '2099-01-23', '09:00', '10:30', 'Check Field' FROM ctx;
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT session_id, '00000000-0000-4000-8000-0000000dc001'::uuid, 'coach' FROM ctx
  UNION ALL SELECT session_id, '00000000-0000-4000-8000-0000000de001'::uuid, 'independent_evaluator' FROM ctx;
UPDATE public.evaluation_sessions SET status = 'open' WHERE id = (SELECT session_id FROM ctx);
-- Prior-year rating for Alpha: hitting 2, throwing 4 -> prior overall 3.00
INSERT INTO public.historical_evaluations (player_id, source_season_label, source_division_name) SELECT alpha_player, 'Spring 2098', 'AAA' FROM ctx;
INSERT INTO public.historical_ratings (historical_evaluation_id, category_name, score, rating_category_id)
  SELECT he.id, rc.name, CASE rc.code WHEN 'hitting' THEN 2 ELSE 4 END, rc.id
  FROM public.historical_evaluations he, public.rating_categories rc
  WHERE he.player_id = (SELECT alpha_player FROM ctx) AND rc.code IN ('hitting', 'throwing');

CREATE FUNCTION pg_temp.as_user(p_uuid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uuid, 'role', 'authenticated')::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO authenticated;
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
CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF; RAISE NOTICE 'PASS: %', p_label; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text) TO authenticated;

-- Scores for Alpha: coach full 4s; evaluator hitting 2 only (partial).
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000dc001');
SELECT public.save_evaluation((SELECT session_id FROM ctx), (SELECT alpha FROM ctx), '{"hitting":4,"throwing":4,"grounders":4,"fly_balls":4,"running_awareness":4,"pitching_mechanics":3}', '{}', 'submitted');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000de001');
SELECT public.save_evaluation((SELECT session_id FROM ctx), (SELECT alpha FROM ctx), '{"hitting":2}', '{}', 'submitted');

-- Before release
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000dc001');
SELECT pg_temp.expect_error(format('SELECT * FROM public.draft_report(%s)', (SELECT session_id FROM ctx)), 'not been released', 'coach cannot open the report before release');
SELECT pg_temp.check((SELECT count(*) FROM public.draft_report_sessions() WHERE session_id = (SELECT session_id FROM ctx)) = 0, 'unreleased age group is not listed for coaches');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000de001');
SELECT pg_temp.expect_error(format('SELECT * FROM public.draft_report(%s)', (SELECT session_id FROM ctx)), 'not been released', 'independent evaluator cannot open the report before release');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000da001');
SELECT pg_temp.check((SELECT count(*) FROM public.draft_report((SELECT session_id FROM ctx))) = 2, 'admin can open the report before release (2 players)');
SELECT pg_temp.check((SELECT coach_overall = 4 AND evaluator_overall = 2 AND evaluator_skills_rated = 1 AND blank_core_skills = 4 AND prior_overall = 3 AND prior_ratings = 1
                      FROM public.draft_report((SELECT session_id FROM ctx)) WHERE player_season_id = (SELECT alpha FROM ctx)),
  'averages: coach 4.00, evaluator 2.00 from 1 of 5 skills, 4 blanks flagged, prior-year 3.00');
SELECT pg_temp.check((SELECT (skill_averages -> 'coach' ->> 'pitching')::numeric = 3 FROM public.draft_report((SELECT session_id FROM ctx)) WHERE player_season_id = (SELECT alpha FROM ctx)),
  'pitching shown separately and not in the overall');
SELECT pg_temp.check((SELECT coach_evaluations = 0 AND evaluator_evaluations = 0 AND coach_overall IS NULL FROM public.draft_report((SELECT session_id FROM ctx)) WHERE last_name = 'Beta'),
  'unrated player has blank averages, not zero');

-- Release
SELECT public.change_evaluation_session_stage((SELECT session_id FROM ctx), 'lock');
SELECT public.change_evaluation_session_stage((SELECT session_id FROM ctx), 'release');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000dc001');
SELECT pg_temp.check((SELECT count(*) FROM public.draft_report_sessions() WHERE session_id = (SELECT session_id FROM ctx)) = 1, 'released age group is listed for coaches');
SELECT pg_temp.check((SELECT (my_evaluation -> 'ratings' ->> 'hitting')::int = 4 FROM public.draft_report((SELECT session_id FROM ctx)) WHERE player_season_id = (SELECT alpha FROM ctx)),
  'coach sees their own ratings in the report');
SELECT pg_temp.check((SELECT bool_and(position('0000000de001' IN row_to_json(r)::text) = 0) FROM public.draft_report((SELECT session_id FROM ctx)) r),
  'report never contains the evaluator''s identity');
SELECT pg_temp.check((SELECT bool_and(position('"hitting": 2' IN COALESCE(my_evaluation::text, '')) = 0) FROM public.draft_report((SELECT session_id FROM ctx)) r),
  'coach does not see another rater''s individual ratings');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000de001');
SELECT pg_temp.check((SELECT count(*) = 2 FROM public.draft_report((SELECT session_id FROM ctx))), 'after release: independent evaluator can open the report');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000dc002');
SELECT pg_temp.expect_error(format('SELECT * FROM public.draft_report(%s)', (SELECT session_id FROM ctx)), 'administrators only', 'coach from another season cannot open the report');

-- Prior-year switch for the evaluation screen
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000de001');
SELECT pg_temp.check((SELECT count(*) FROM public.prior_year_for_session((SELECT session_id FROM ctx))) = 0, 'switch off: evaluator sees no prior-year ratings while evaluating');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000dc001');
SELECT pg_temp.expect_error(format('SELECT public.set_prior_year_visibility(%s, true)', (SELECT season_id FROM ctx)), 'Administrator access required', 'coach cannot change the prior-year switch');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000da001');
SELECT public.set_prior_year_visibility((SELECT season_id FROM ctx), true);
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000de001');
SELECT pg_temp.check((SELECT prior_overall = 3 FROM public.prior_year_for_session((SELECT session_id FROM ctx))), 'switch on: evaluator sees prior-year ratings');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000dc001');
SELECT pg_temp.check((SELECT count(*) FROM public.prior_year_for_session((SELECT session_id FROM ctx))) = 1, 'switch on: coach sees prior-year ratings');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000de002');
SELECT pg_temp.expect_error(format('SELECT * FROM public.prior_year_for_session(%s)', (SELECT session_id FROM ctx)), 'not assigned', 'unassigned evaluator cannot read prior-year ratings');
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.audit_log WHERE action = 'season_prior_year_visibility' AND target_id = (SELECT season_id FROM ctx)::text), 'switch change is audited');

-- Bibs are unique across the season
SELECT pg_temp.expect_error(format('UPDATE public.player_seasons SET evaluation_number = 501 WHERE id <> %s AND season_id = %s', (SELECT alpha FROM ctx), (SELECT season_id FROM ctx)),
  'player_seasons_unique_season_evaluation_number', 'two players in one season cannot share a bib');

ROLLBACK;
