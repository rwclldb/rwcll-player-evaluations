-- Runtime check: evaluator submit, partial submissions, not-evaluated, and lock behavior.
-- Self-contained fixture inside one transaction that is ALWAYS rolled back.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-00000000a001', 'sub-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000e001', 'sub-eval@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000c001', 'sub-coach@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000e002', 'sub-unassigned@example.test', 'authenticated', 'authenticated');

INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Submit check season', '2099-01-01', '2099-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS
  SELECT (SELECT id FROM public.seasons WHERE name = 'Submit check season') AS season_id;
GRANT SELECT ON ctx TO authenticated;

INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-00000000a001', 'administrator', NULL),
  ('00000000-0000-4000-8000-00000000e001', 'independent_evaluator', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-00000000c001', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-00000000e002', 'independent_evaluator', (SELECT season_id FROM ctx));

INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Submit', 'Fixture', '2020-03-01');
INSERT INTO public.player_seasons (player_id, season_id, league_age)
  SELECT id, (SELECT season_id FROM ctx), 7 FROM public.players WHERE last_name = 'Fixture' AND first_name = 'Submit';
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES ((SELECT season_id FROM ctx), 7, 'setup');
ALTER TABLE ctx ADD COLUMN session_id bigint, ADD COLUMN ps_id bigint;
UPDATE ctx SET session_id = (SELECT id FROM public.evaluation_sessions WHERE season_id = ctx.season_id),
               ps_id = (SELECT id FROM public.player_seasons WHERE season_id = ctx.season_id);
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location)
  SELECT session_id, 'primary', '2099-01-23', '09:00', '10:30', 'Check Field' FROM ctx;
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT session_id, '00000000-0000-4000-8000-00000000e001'::uuid, 'independent_evaluator' FROM ctx
  UNION ALL SELECT session_id, '00000000-0000-4000-8000-00000000c001'::uuid, 'coach' FROM ctx;
UPDATE public.evaluation_sessions SET status = 'open' WHERE id = (SELECT session_id FROM ctx);

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_fragment text, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_fragment IN SQLERRM) > 0 THEN
      RAISE NOTICE 'PASS: %', p_label;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL: % (wrong error: %)', p_label, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL: % (no error raised)', p_label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect_error(text, text, text) TO authenticated;

CREATE FUNCTION pg_temp.expect_status(p_user uuid, p_status text, p_ratings int, p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s text; n int; sub timestamptz;
BEGIN
  SELECT e.status, e.submitted_at, (SELECT count(*) FROM public.ratings r WHERE r.evaluation_id = e.id)
    INTO s, sub, n
  FROM public.evaluations e JOIN ctx ON e.evaluation_session_id = ctx.session_id
  WHERE e.evaluator_user_id = p_user;
  IF s IS DISTINCT FROM p_status OR n <> p_ratings THEN
    RAISE EXCEPTION 'FAIL: % (status %, % ratings; expected %, %)', p_label, s, n, p_status, p_ratings;
  END IF;
  IF (s = 'submitted') <> (sub IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: % (submitted_at % does not match status %)', p_label, sub, s;
  END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;

-- ===== As the assigned independent evaluator =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e001","role":"authenticated"}', true);
SELECT public.save_evaluation((SELECT session_id FROM ctx), (SELECT ps_id FROM ctx), '{"hitting":4,"throwing":3}', '{}', 'draft');
RESET ROLE;
SELECT pg_temp.expect_status('00000000-0000-4000-8000-00000000e001', 'draft', 2, 'evaluator saves a partial draft');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e001","role":"authenticated"}', true);
SELECT public.save_evaluation((SELECT session_id FROM ctx), (SELECT ps_id FROM ctx), '{"hitting":4}', '{}', 'submitted');
RESET ROLE;
SELECT pg_temp.expect_status('00000000-0000-4000-8000-00000000e001', 'submitted', 1, 'evaluator submits with 4 of 5 core skills blank');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e001","role":"authenticated"}', true);
SELECT pg_temp.expect_error(format('SELECT public.save_evaluation(%s, %s, %L, %L, %L)', (SELECT session_id FROM ctx), (SELECT ps_id FROM ctx), '{"pitching_mechanics":3}', '{}', 'submitted'),
  'at least one core skill', 'submit with no core skills is refused');
SELECT pg_temp.expect_error(format('SELECT public.save_evaluation(%s, %s, %L, %L, %L)', (SELECT session_id FROM ctx), (SELECT ps_id FROM ctx), '{"hitting":3}', '{}', 'not_evaluated'),
  'Clear all ratings', 'not evaluated with ratings is refused');
SELECT pg_temp.expect_error(format('SELECT public.save_evaluation(%s, %s, %L, %L, %L)', (SELECT session_id FROM ctx), (SELECT ps_id FROM ctx), '{"hitting":3}', '{}', 'final'),
  'Status must be', 'unknown status is refused');
RESET ROLE;
SELECT pg_temp.expect_status('00000000-0000-4000-8000-00000000e001', 'submitted', 1, 'refused saves leave the submission unchanged');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e001","role":"authenticated"}', true);
SELECT public.save_evaluation((SELECT session_id FROM ctx), (SELECT ps_id FROM ctx), '{}', '{}', 'not_evaluated');
RESET ROLE;
SELECT pg_temp.expect_status('00000000-0000-4000-8000-00000000e001', 'not_evaluated', 0, 'evaluator marks player not evaluated');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e001","role":"authenticated"}', true);
SELECT public.save_evaluation((SELECT session_id FROM ctx), (SELECT ps_id FROM ctx), '{"hitting":5,"throwing":4,"grounders":4,"fly_balls":3,"running_awareness":4,"catching_receiving":2}', '{"caught_before":"yes"}', 'submitted');
RESET ROLE;
SELECT pg_temp.expect_status('00000000-0000-4000-8000-00000000e001', 'submitted', 6, 'evaluator changes own record back to a full submission while open');

-- ===== Old draft entry point still works (coach) =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}', true);
SELECT public.save_evaluation_draft((SELECT session_id FROM ctx), (SELECT ps_id FROM ctx), '{"hitting":3}', '{}');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.evaluations) <> 1 THEN RAISE EXCEPTION 'FAIL: coach can see evaluations other than their own'; END IF;
  RAISE NOTICE 'PASS: coach sees only their own evaluation';
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT evaluator_type FROM public.evaluations WHERE evaluator_user_id = '00000000-0000-4000-8000-00000000c001') <> 'coach' THEN
    RAISE EXCEPTION 'FAIL: coach evaluation not typed as coach'; END IF;
  RAISE NOTICE 'PASS: save_evaluation_draft still saves a coach draft';
END $$;

-- ===== Unassigned evaluator =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e002","role":"authenticated"}', true);
SELECT pg_temp.expect_error(format('SELECT public.save_evaluation(%s, %s, %L, %L, %L)', (SELECT session_id FROM ctx), (SELECT ps_id FROM ctx), '{"hitting":3}', '{}', 'submitted'),
  'not assigned', 'unassigned evaluator cannot save');
RESET ROLE;

-- ===== Lock stops evaluator edits =====
UPDATE public.evaluation_sessions SET status = 'locked' WHERE id = (SELECT session_id FROM ctx);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000e001","role":"authenticated"}', true);
SELECT pg_temp.expect_error(format('SELECT public.save_evaluation(%s, %s, %L, %L, %L)', (SELECT session_id FROM ctx), (SELECT ps_id FROM ctx), '{"hitting":1}', '{}', 'submitted'),
  'not open', 'evaluator cannot change a submission after lock');
RESET ROLE;
SELECT pg_temp.expect_status('00000000-0000-4000-8000-00000000e001', 'submitted', 6, 'locked submission is unchanged');

ROLLBACK;
