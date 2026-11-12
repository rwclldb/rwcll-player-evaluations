-- Runtime check: admin roadmap counts and stage, and the coach/evaluator schedule. Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role, last_sign_in_at) VALUES
  ('00000000-0000-4000-8000-0000000da001', 'roadmap-admin@example.test', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000dc001', 'roadmap-coach@example.test', 'authenticated', 'authenticated', now()),
  ('00000000-0000-4000-8000-0000000de001', 'roadmap-eval@example.test', 'authenticated', 'authenticated', NULL);
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Roadmap check season', '2099-01-01', '2099-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT (SELECT id FROM public.seasons WHERE name = 'Roadmap check season') AS season_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000da001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000dc001', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000de001', 'independent_evaluator', (SELECT season_id FROM ctx));
INSERT INTO public.players (first_name, last_name) VALUES ('Roadmap', 'Nine'), ('Roadmap', 'NineB'), ('Roadmap', 'Ten');
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number)
  SELECT id, (SELECT season_id FROM ctx),
         CASE last_name WHEN 'Ten' THEN 10 ELSE 9 END,
         CASE last_name WHEN 'Nine' THEN 98001 WHEN 'Ten' THEN 98002 ELSE NULL END
  FROM public.players WHERE first_name = 'Roadmap';
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES
  ((SELECT season_id FROM ctx), 9, 'setup'), ((SELECT season_id FROM ctx), 10, 'setup');
ALTER TABLE ctx ADD COLUMN s9 bigint, ADD COLUMN s10 bigint;
UPDATE ctx SET s9 = (SELECT id FROM public.evaluation_sessions WHERE season_id = ctx.season_id AND league_age = 9),
               s10 = (SELECT id FROM public.evaluation_sessions WHERE season_id = ctx.season_id AND league_age = 10);
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location)
  SELECT s10, 'primary', '2099-01-23', '09:00', '10:30', 'Roadmap Field' FROM ctx;
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT s10, '00000000-0000-4000-8000-0000000dc001'::uuid, 'coach' FROM ctx;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text) TO authenticated;

CREATE FUNCTION pg_temp.as_user(p_id text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_id), true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO authenticated;

CREATE FUNCTION pg_temp.rm(p_today date) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.admin_season_roadmap((SELECT season_id FROM ctx), p_today);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.rm(date) TO authenticated;

-- A coach can't read the admin roadmap.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000dc001');
DO $$ BEGIN
  PERFORM pg_temp.rm('2099-01-01');
  RAISE EXCEPTION 'FAIL: coach read the admin roadmap';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: a coach cannot read the admin roadmap';
END $$;

-- Counts, as admin.
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000da001');
SELECT pg_temp.check((pg_temp.rm('2099-01-01')->'registrations') @> '{"total":3,"no_bib":1,"no_age":0}', 'registrations: 3 players, 1 without a bib');
SELECT pg_temp.check((pg_temp.rm('2099-01-01')->'people') @> '{"coaches":1,"evaluators":1,"not_signed_in":1,"unassigned":1}',
  'people: 1 coach, 1 evaluator, evaluator not signed in and not assigned');
SELECT pg_temp.check((pg_temp.rm('2099-01-01')->'sessions'->0) @> '{"league_age":9,"players":2,"no_bib":1,"evaluators":0,"primary_date":null}',
  'age 9: 2 players, 1 without bib, no evaluator, no event');
SELECT pg_temp.check((pg_temp.rm('2099-01-01')->'sessions'->1) @> '{"league_age":10,"coaches":1,"primary_date":"2099-01-23"}',
  'age 10: coach assigned, primary event on 2099-01-23');
SELECT pg_temp.check(pg_temp.rm('2099-01-01')->>'stage' = 'before', 'stage is before when nothing is open and the day is weeks away');
SELECT pg_temp.check(pg_temp.rm('2099-01-17')->>'stage' = 'week', 'stage is week within 7 days of the first event');
RESET ROLE;

UPDATE public.evaluation_sessions SET status = 'open' WHERE id = (SELECT s10 FROM ctx);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000da001');
SELECT pg_temp.check(pg_temp.rm('2099-01-01')->>'stage' = 'week', 'stage is week once any age group is open');
SELECT pg_temp.check(pg_temp.rm('2099-01-23')->>'stage' = 'day', 'stage is day on the evaluation date');
SELECT pg_temp.check(pg_temp.rm('2099-01-24')->>'stage' = 'after', 'stage is after once every event has passed');
RESET ROLE;

-- Coach and evaluator schedules.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000dc001');
SELECT pg_temp.check((SELECT count(*) FROM public.my_evaluation_schedule() WHERE season_id = (SELECT season_id FROM ctx)) = 2,
  'coach schedule lists both age groups of the season');
SELECT pg_temp.check((SELECT assigned AND session_status = 'open' AND events->0->>'location' = 'Roadmap Field' AND events->0->>'date' = '2099-01-23'
                      FROM public.my_evaluation_schedule() WHERE session_id = (SELECT s10 FROM ctx)),
  'coach schedule: age 10 assigned, open, with date and location');
SELECT pg_temp.check((SELECT NOT assigned FROM public.my_evaluation_schedule() WHERE session_id = (SELECT s9 FROM ctx)),
  'coach schedule: age 9 not assigned');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000de001');
SELECT pg_temp.check((SELECT bool_and(NOT assigned AND role_name = 'independent_evaluator') FROM public.my_evaluation_schedule()
                      WHERE season_id = (SELECT season_id FROM ctx)), 'evaluator schedule: role shown, nothing assigned');
RESET ROLE;

-- Lock and release move the stage on.
UPDATE public.evaluation_sessions SET status = 'locked' WHERE id = (SELECT s10 FROM ctx);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000da001');
SELECT pg_temp.check(pg_temp.rm('2099-01-01')->>'stage' = 'after', 'stage is after once any age group is locked');
RESET ROLE;
UPDATE public.evaluation_sessions SET status = 'locked', published_at = now(), published_by = '00000000-0000-4000-8000-0000000da001' WHERE season_id = (SELECT season_id FROM ctx);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000da001');
SELECT pg_temp.check(pg_temp.rm('2099-01-01')->>'stage' = 'end', 'stage is end once every age group is released');
RESET ROLE;

-- Closed seasons drop out of schedules.
UPDATE public.seasons SET is_closed = true WHERE id = (SELECT season_id FROM ctx);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000dc001');
SELECT pg_temp.check((SELECT count(*) FROM public.my_evaluation_schedule() WHERE season_id = (SELECT season_id FROM ctx)) = 0,
  'closed season is not in the coach schedule');
RESET ROLE;

ROLLBACK;
