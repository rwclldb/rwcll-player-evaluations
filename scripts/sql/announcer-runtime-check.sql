-- Runtime check: the announcer role and player calls. Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000e0001', 'an-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e0002', 'an-announcer@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e0003', 'an-coach1@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e0004', 'an-coach2@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e0005', 'an-coach3@example.test', 'authenticated', 'authenticated');
INSERT INTO public.user_profiles (user_id, display_name) VALUES
  ('00000000-0000-4000-8000-0000000e0003', 'Cora One'), ('00000000-0000-4000-8000-0000000e0004', 'Cal Two');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Announce 2082', '2020-01-01', '2020-06-30') RETURNING id AS s \gset
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000e0001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000e0003', 'coach', :s),
  ('00000000-0000-4000-8000-0000000e0004', 'coach', :s),
  ('00000000-0000-4000-8000-0000000e0005', 'coach', :s);
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES (:s, 9, 'setup') RETURNING id AS sess \gset
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type) VALUES
  (:sess, '00000000-0000-4000-8000-0000000e0003', 'coach'), (:sess, '00000000-0000-4000-8000-0000000e0004', 'coach');
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location)
  VALUES (:sess, 'primary', '2020-01-11', '09:00', '10:00', 'Field 1') RETURNING id AS ev \gset
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location)
  VALUES (:sess, 'makeup', '2020-01-18', '09:00', '10:00', 'Field 2') RETURNING id AS mk \gset
UPDATE public.evaluation_sessions SET status = 'open' WHERE id = :sess;
-- A: here, called, scored by coach 1 only. B: here, never called. C: never came. D: excused from attending.
INSERT INTO public.players (first_name, last_name) VALUES ('Ava', 'Antest'), ('Ben', 'Antest'), ('Cy', 'Antest'), ('Di', 'Antest');
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number)
  SELECT p.id, :s, 9, 900 + row_number() OVER (ORDER BY p.first_name) FROM public.players p WHERE p.last_name = 'Antest';
SELECT max(ps.id) FILTER (WHERE p.first_name = 'Ava') AS a, max(ps.id) FILTER (WHERE p.first_name = 'Ben') AS b,
       max(ps.id) FILTER (WHERE p.first_name = 'Cy') AS c, max(ps.id) FILTER (WHERE p.first_name = 'Di') AS d
FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Antest' \gset
INSERT INTO public.player_checkins (player_season_id, event_id) VALUES (:a, :ev), (:b, :ev);
INSERT INTO public.player_exemptions (player_season_id, scope, reason, recorded_by) VALUES (:d, 'attendance', 'Broken arm', '00000000-0000-4000-8000-0000000e0001');

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

-- ---------- the role ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e0001');
SELECT public.admin_grant_role('00000000-0000-4000-8000-0000000e0002', 'announcer', :s);
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e0002');
SELECT pg_temp.check(public.is_announcer(:s) AND public.can_announce(:s) AND NOT public.can_register(:s),
  'an admin makes someone announcer for the season (they can call, not register)');

-- ---------- what an announcer sees ----------
SELECT pg_temp.check((SELECT count(*) FROM public.announce_days(:s)) = 2, 'the announcer sees the evaluation days');
SELECT pg_temp.check((SELECT string_agg(evaluation_number::text, ',' ORDER BY evaluation_number) FROM public.announce_list(:s, '2020-01-11')) = '901,902,903,904'
  AND (SELECT count(*) FILTER (WHERE checked_in_at IS NOT NULL) FROM public.announce_list(:s, '2020-01-11')) = 2
  AND (SELECT exempt_scope FROM public.announce_list(:s, '2020-01-11') WHERE player_season_id = :d) = 'attendance',
  'main day: every player in bib order, with Here and Exempt');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proargnames) a WHERE p.proname = 'announce_list' AND a ~ 'birth'),
  'the list has no birthdates');
SELECT pg_temp.check((SELECT count(*) FROM public.players WHERE last_name = 'Antest') = 0
  AND (SELECT count(*) FROM public.player_seasons WHERE season_id = :s) = 0, 'an announcer reads no player tables directly');
SELECT pg_temp.expect_error('SELECT count(*) FROM public.player_calls', 'permission denied', 'nobody reads the calls table directly');
SELECT pg_temp.check((SELECT count(*) FROM public.registrar_timetable(:s)) = 1, 'the announcer can open Who scores when');

-- ---------- calling ----------
SELECT pg_temp.check(public.toggle_call(:a, :ev) AND NOT public.toggle_call(:a, :ev) AND public.toggle_call(:a, :ev),
  'a tap calls a player; tapping again undoes it');
SELECT pg_temp.expect_error(format('SELECT public.toggle_call(%s, %s)', :a, :mk + 100000),
  'not for this player', 'a call must be for the player''s own age group');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e0003');
SELECT pg_temp.expect_error(format('SELECT public.toggle_call(%s, %s)', :b, :ev), 'Only announcers', 'a coach cannot call players');
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) FROM public.audit_log WHERE target_id = :'a' AND action IN ('player_called', 'player_call_undone')) = 3,
  'every call and undo is logged');

-- ---------- scoring screen and draft report ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e0003');
SELECT public.save_evaluation(:sess, :a, '{"hitting":3}', '{}', 'submitted');
SELECT pg_temp.check((SELECT array_agg(player_season_id) FROM public.session_calls(:sess)) = ARRAY[:a]::bigint[],
  'an assigned coach sees who was called');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e0005');
SELECT pg_temp.check((SELECT count(*) FROM public.session_calls(:sess)) = 0, 'a coach not scoring this age group doesn''t, before release');

-- ---------- scoring progress and the end-of-day check ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e0001');
SELECT pg_temp.check((SELECT bool_and(called = 1) FROM public.admin_scoring_progress(:s))
  AND (SELECT called_not_done FROM public.admin_scoring_progress(:s) WHERE scorer_name = 'Cora One') = 0
  AND (SELECT called_not_done FROM public.admin_scoring_progress(:s) WHERE scorer_name = 'Cal Two') = 1,
  'Scoring progress: 1 called; Cal Two has a called player still to score');
SELECT pg_temp.check((SELECT string_agg(evaluation_number || ':' || gap, ',' ORDER BY evaluation_number) FROM public.admin_call_gaps(:s))
  = '901:called_not_scored,902:here_not_called,903:not_here', 'the end-of-day check lists each kind of gap (not the excused player)');
SELECT pg_temp.check((SELECT missing_scorers FROM public.admin_call_gaps(:s) WHERE player_season_id = :a) = ARRAY['Cal Two (coach)'],
  'it names the scorer who hasn''t scored a called player');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e0002');
SELECT pg_temp.check((SELECT count(*) FROM public.admin_call_gaps(:s)) = 0, 'the end-of-day check is for admins only');

-- ---------- makeup day ----------
SELECT pg_temp.check((SELECT string_agg(evaluation_number::text, ',' ORDER BY evaluation_number) FROM public.announce_list(:s, '2020-01-18')) = '902,903',
  'makeup calling list: here-but-not-called and absent players; not the called or the excused');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e0001');
SELECT pg_temp.check((SELECT string_agg(evaluation_number::text, ',' ORDER BY evaluation_number) FROM public.checkin_list(:s, '2020-01-18')) = '902,903',
  'makeup check-in now includes a player who came but was never called');
RESET ROLE;

ROLLBACK;
