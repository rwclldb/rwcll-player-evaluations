-- Runtime check: test dates (moving a season's event dates to today and back). Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000d0001', 'td-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000d0002', 'td-coach@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Dates 2090', '2090-01-01', '2090-06-30') RETURNING id AS s \gset
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Dates 2091', '2091-01-01', '2091-06-30') RETURNING id AS empty \gset
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Dates 2092', '2092-01-01', '2092-06-30') RETURNING id AS closed \gset
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000d0001', 'administrator', NULL), ('00000000-0000-4000-8000-0000000d0002', 'coach', :s);
-- Age 9 is still in setup, age 10 is locked; main days March 1 and 2, one makeup March 8.
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES (:s, 9, 'setup') RETURNING id AS a9 \gset
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES (:s, 10, 'setup') RETURNING id AS a10 \gset
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES (:closed, 9, 'setup') RETURNING id AS c9 \gset
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location) VALUES
  (:a9, 'primary', '2090-03-01', '09:00', '10:00', 'Field 1'), (:a10, 'primary', '2090-03-02', '09:00', '10:00', 'Field 1'),
  (:a9, 'makeup', '2090-03-08', '10:00', '11:00', 'Field 2'), (:c9, 'primary', '2092-03-01', '09:00', '10:00', 'Field 1');
SET LOCAL session_replication_role = replica;
UPDATE public.evaluation_sessions SET status = 'locked' WHERE id = :a10;
SET LOCAL session_replication_role = origin;
UPDATE public.seasons SET is_closed = true WHERE id = :closed;
-- A season still before evaluations (its age group in Setup): the roadmap stage follows the dates.
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Dates 2093', '2093-01-01', '2093-06-30') RETURNING id AS fresh \gset
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES (:fresh, 9, 'setup') RETURNING id AS f9 \gset
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location) VALUES
  (:f9, 'primary', '2093-03-01', '09:00', '10:00', 'Field 1'), (:f9, 'makeup', '2093-03-08', '10:00', '11:00', 'Field 2');
SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date AS today \gset

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
-- The season's dates as "age/type/days from today", in order.
CREATE FUNCTION pg_temp.dates(p_season bigint) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT string_agg(es.league_age || e.event_type || ':' || (e.event_date - (now() AT TIME ZONE 'America/Los_Angeles')::date), ' ' ORDER BY e.event_date, es.league_age)
  FROM public.evaluation_session_events e JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id WHERE es.season_id = p_season;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.dates(bigint) TO authenticated;
CREATE FUNCTION pg_temp.real_dates(p_season bigint) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT string_agg(es.league_age || e.event_type || ':' || e.event_date, ' ' ORDER BY e.event_date, es.league_age)
  FROM public.evaluation_session_events e JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id WHERE es.season_id = p_season;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.real_dates(bigint) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
SELECT pg_temp.expect_error(format('SELECT public.admin_test_set_dates(%s, ''evaluation_day'')', :s), 'Only league admins', 'a coach can''t move dates');
SELECT pg_temp.expect_error(format('SELECT public.admin_test_dates_status(%s)', :s), 'Only league admins', 'a coach can''t see test dates');

SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
SELECT pg_temp.expect_error(format('SELECT public.admin_test_set_dates(%s, ''evaluation_day'')', :empty), 'no evaluation dates', 'a season without dates is refused');
SELECT pg_temp.expect_error(format('SELECT public.admin_test_set_dates(%s, ''evaluation_day'')', :closed), 'closed', 'a closed season is refused');
SELECT pg_temp.expect_error(format('SELECT public.admin_test_set_dates(%s, ''tomorrow'')', :s), 'Unknown test date', 'only the four test dates exist');
SELECT pg_temp.expect_error(format('SELECT public.admin_test_restore_dates(%s)', :s), 'haven''t been moved', 'nothing to put back before a move');

SELECT public.admin_test_set_dates(:s, 'evaluation_day') AS d1 \gset
SELECT pg_temp.check(pg_temp.dates(:s) = '9primary:0 10primary:1 9makeup:7',
  'Make today evaluation day: the first main day is today, the rest keep their spacing (a locked age group moves too)');
SELECT public.admin_test_set_dates(:s, 'evaluation_day') AS d2 \gset
SELECT pg_temp.check(:d1 = :d2 AND pg_temp.dates(:s) = '9primary:0 10primary:1 9makeup:7', 'pressing it again changes nothing (counted from the real dates)');
SELECT public.admin_test_set_dates(:s, 'makeup_day');
SELECT pg_temp.check(pg_temp.dates(:s) = '9primary:-7 10primary:-6 9makeup:0', 'Make today a makeup day: the makeup is today, the main days a week ago');
SELECT public.admin_test_set_dates(:s, 'week_before');
SELECT pg_temp.check(pg_temp.dates(:s) = '9primary:7 10primary:8 9makeup:14', 'Make today the week before: the first main day is a week away');
SELECT public.admin_test_set_dates(:s, 'after');
SELECT pg_temp.check(pg_temp.dates(:s) = '9primary:-8 10primary:-7 9makeup:-1', 'After evaluations: the last event was yesterday');
SELECT public.admin_test_dates_status(:s) AS st \gset
SELECT pg_temp.check(((:'st')::jsonb->>'moved')::boolean AND (:'st')::jsonb->>'mode' = 'after'
  AND (SELECT bool_and(x->>'real_date' LIKE '2090-03-%') FROM jsonb_array_elements((:'st')::jsonb->'events') x)
  AND (:'st')::jsonb->>'today' = :'today', 'the status shows each event''s real and current date');
SELECT pg_temp.expect_error(format('UPDATE public.evaluation_session_events SET event_date = event_date + 1 WHERE evaluation_session_id = %s', :a10),
  'only be changed while the session is in setup', 'outside the tool, a locked age group''s dates still can''t change');

CREATE FUNCTION pg_temp.stage_after(p_season bigint, p_mode text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_days integer;
BEGIN
  v_days := public.admin_test_set_dates(p_season, p_mode);  -- its own statement, so the roadmap below sees the new dates
  RETURN v_days || ':' || (public.admin_season_roadmap(p_season, (now() AT TIME ZONE 'America/Los_Angeles')::date)->>'stage');
END $$;
SELECT pg_temp.check(public.admin_season_roadmap(:fresh, :'today')->>'stage' = 'before'
  AND split_part(pg_temp.stage_after(:fresh, 'week_before'), ':', 2) = 'week' AND split_part(pg_temp.stage_after(:fresh, 'evaluation_day'), ':', 2) = 'day'
  AND split_part(pg_temp.stage_after(:fresh, 'makeup_day'), ':', 2) = 'day' AND split_part(pg_temp.stage_after(:fresh, 'after'), ':', 2) = 'after',
  'before evaluations, the roadmap stage follows the test dates: week, day, day (makeup), after');
SELECT public.admin_test_restore_dates(:s);
SELECT pg_temp.check(pg_temp.real_dates(:s) = '9primary:2090-03-01 10primary:2090-03-02 9makeup:2090-03-08'
  AND NOT (public.admin_test_dates_status(:s)->>'moved')::boolean, 'Put the dates back restores the real schedule and forgets the copy');
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) FROM public.audit_log WHERE target_id = :'s' AND action = 'test_dates_set') = 5
  AND (SELECT count(*) FROM public.audit_log WHERE target_id = :'s' AND action = 'test_dates_restored') = 1, 'every move and the restore are audited');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT count(*) FROM public.test_date_backups', 'permission denied', 'nobody reads the saved dates directly');
RESET ROLE;

ROLLBACK;
