-- Runtime check: two-step, reversible lock and release. Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000ba001', 'stage-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000bc001', 'stage-coach@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Stage check season', '2099-01-01', '2099-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT (SELECT id FROM public.seasons WHERE name = 'Stage check season') AS season_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000ba001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000bc001', 'coach', (SELECT season_id FROM ctx));
INSERT INTO public.players (first_name, last_name) VALUES ('Stage', 'Fixture');
INSERT INTO public.player_seasons (player_id, season_id, league_age)
  SELECT id, (SELECT season_id FROM ctx), 9 FROM public.players WHERE first_name = 'Stage' AND last_name = 'Fixture';
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES ((SELECT season_id FROM ctx), 9, 'setup');
ALTER TABLE ctx ADD COLUMN session_id bigint, ADD COLUMN ps_id bigint;
UPDATE ctx SET session_id = (SELECT id FROM public.evaluation_sessions WHERE season_id = ctx.season_id),
               ps_id = (SELECT id FROM public.player_seasons WHERE season_id = ctx.season_id);
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location)
  SELECT session_id, 'primary', '2099-01-23', '09:00', '10:30', 'Check Field' FROM ctx;
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT session_id, '00000000-0000-4000-8000-0000000bc001'::uuid, 'coach' FROM ctx;
UPDATE public.evaluation_sessions SET status = 'open' WHERE id = (SELECT session_id FROM ctx);

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

CREATE FUNCTION pg_temp.expect_stage(p_status text, p_released boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s text; r boolean;
BEGIN
  SELECT status, published_at IS NOT NULL INTO s, r FROM public.evaluation_sessions WHERE id = (SELECT session_id FROM ctx);
  IF s <> p_status OR r <> p_released THEN RAISE EXCEPTION 'FAIL: % (status %, released %)', p_label, s, r; END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;

CREATE FUNCTION pg_temp.stage(p_action text, p_reason text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT public.change_evaluation_session_stage((SELECT session_id FROM ctx), p_action, p_reason);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.stage(text, text) TO authenticated;

-- Coach scores while open.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000bc001","role":"authenticated"}', true);
SELECT public.save_evaluation((SELECT session_id FROM ctx), (SELECT ps_id FROM ctx), '{"hitting":3}', '{}', 'submitted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.stage('lock')$q$, 'Administrator access required', 'a coach cannot lock a session');
RESET ROLE;

-- Admin walks forward and backward.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000ba001","role":"authenticated"}', true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.stage('release')$q$, 'Lock the session', 'cannot release an Open session');
SELECT pg_temp.stage('lock');
RESET ROLE;
SELECT pg_temp.expect_stage('locked', false, 'admin locks the session');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000bc001","role":"authenticated"}', true);
SELECT pg_temp.expect_error(format('SELECT public.save_evaluation(%s, %s, %L, %L, %L)', (SELECT session_id FROM ctx), (SELECT ps_id FROM ctx), '{"hitting":5}', '{}', 'submitted'),
  'not open', 'coach cannot change scores after lock');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000ba001","role":"authenticated"}', true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.stage('lock')$q$, 'Only an Open session', 'cannot lock twice');
SELECT pg_temp.stage('release');
RESET ROLE;
SELECT pg_temp.expect_stage('locked', true, 'admin releases reports');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000ba001","role":"authenticated"}', true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.stage('unlock', 'Fix a score')$q$, 'Unrelease the reports', 'cannot unlock while released');
SELECT pg_temp.expect_error($q$SELECT pg_temp.stage('unrelease')$q$, 'Give a reason', 'unrelease requires a reason');
SELECT pg_temp.stage('unrelease', 'Coach reported a wrong bib');
RESET ROLE;
SELECT pg_temp.expect_stage('locked', false, 'admin unreleases with a reason');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000ba001","role":"authenticated"}', true);
SELECT pg_temp.expect_error($q$SELECT pg_temp.stage('unlock', 'no')$q$, 'Give a reason', 'unlock requires a real reason');
SELECT pg_temp.stage('unlock', 'Evaluator needs to fix a score');
RESET ROLE;
SELECT pg_temp.expect_stage('open', false, 'admin unlocks with a reason');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000bc001","role":"authenticated"}', true);
SELECT public.save_evaluation((SELECT session_id FROM ctx), (SELECT ps_id FROM ctx), '{"hitting":5}', '{}', 'submitted');
RESET ROLE;
DO $$ BEGIN
  IF (SELECT r.score FROM public.ratings r JOIN public.evaluations e ON e.id = r.evaluation_id WHERE e.evaluation_session_id = (SELECT session_id FROM ctx)) <> 5 THEN
    RAISE EXCEPTION 'FAIL: coach could not fix the score after unlock'; END IF;
  RAISE NOTICE 'PASS: coach can change scores again after unlock';
END $$;

DO $$
DECLARE n int; r text;
BEGIN
  SELECT count(*) INTO n FROM public.audit_log WHERE target_table = 'evaluation_sessions' AND target_id = (SELECT session_id FROM ctx)::text;
  SELECT reason INTO r FROM public.audit_log WHERE action = 'evaluation_session_unrelease' AND target_id = (SELECT session_id FROM ctx)::text;
  IF n <> 4 OR r <> 'Coach reported a wrong bib' THEN RAISE EXCEPTION 'FAIL: expected 4 audit rows with the unrelease reason (got %, %)', n, r; END IF;
  RAISE NOTICE 'PASS: every stage change is audited with its reason';
END $$;

-- Direct table writes cannot skip the rules.
UPDATE public.evaluation_sessions SET status = 'locked' WHERE id = (SELECT session_id FROM ctx);
SELECT pg_temp.expect_error($q$UPDATE public.evaluation_sessions SET status = 'setup' WHERE id = (SELECT session_id FROM ctx)$q$, 'cannot return to setup', 'locked session cannot jump back to setup');

ROLLBACK;
