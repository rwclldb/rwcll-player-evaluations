-- Runtime check: end-of-season ratings by team managers, the admin's window, progress, and prior-year averages.
-- Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000c0001', 'trt-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c0002', 'trt-registrar@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c0003', 'trt-mgr-a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c0004', 'trt-coach-a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c0005', 'trt-mgr-b@example.test', 'authenticated', 'authenticated');
INSERT INTO public.user_profiles (user_id, display_name) VALUES
  ('00000000-0000-4000-8000-0000000c0003', 'Amy Manager'), ('00000000-0000-4000-8000-0000000c0005', 'Ben Manager');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Ratings 2086', '2086-01-01', '2086-06-30') RETURNING id AS s \gset
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Ratings 2087', '2087-01-01', '2087-06-30') RETURNING id AS s2 \gset
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000c0001', 'administrator', NULL), ('00000000-0000-4000-8000-0000000c0002', 'registrar', :s),
  ('00000000-0000-4000-8000-0000000c0003', 'coach', :s), ('00000000-0000-4000-8000-0000000c0004', 'coach', :s),
  ('00000000-0000-4000-8000-0000000c0005', 'coach', :s);
SELECT max(sd.id) AS majors FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id
WHERE d.name = 'Majors' AND sd.season_id = :s \gset
INSERT INTO public.teams (season_id, season_division_id, name) VALUES (:s, :majors, 'Ratings A') RETURNING id AS ta \gset
INSERT INTO public.teams (season_id, season_division_id, name) VALUES (:s, :majors, 'Ratings B') RETURNING id AS tb \gset
INSERT INTO public.team_coach_assignments (team_id, season_id, coach_user_id, assignment_role) VALUES
  (:ta, :s, '00000000-0000-4000-8000-0000000c0003', 'manager'), (:ta, :s, '00000000-0000-4000-8000-0000000c0004', 'coach'),
  (:tb, :s, '00000000-0000-4000-8000-0000000c0005', 'manager');
INSERT INTO public.players (first_name, last_name) VALUES ('P1', 'Trttest'), ('P2', 'Trttest'), ('P3', 'Trttest');
INSERT INTO public.player_seasons (player_id, season_id, league_age, season_division_id, team_id)
SELECT p.id, :s, 12, :majors, CASE WHEN p.first_name = 'P3' THEN :tb ELSE :ta END FROM public.players p WHERE p.last_name = 'Trttest';
-- Next season: P1 and P2 are 13.
INSERT INTO public.player_seasons (player_id, season_id, league_age)
SELECT p.id, :s2, 13 FROM public.players p WHERE p.last_name = 'Trttest' AND p.first_name IN ('P1', 'P2');
SELECT max(ps.id) FILTER (WHERE p.first_name = 'P1' AND ps.season_id = :s) AS p1, max(ps.id) FILTER (WHERE p.first_name = 'P2' AND ps.season_id = :s) AS p2,
       max(ps.id) FILTER (WHERE p.first_name = 'P3' AND ps.season_id = :s) AS p3,
       max(ps.id) FILTER (WHERE p.first_name = 'P1' AND ps.season_id = :s2) AS p1next, max(ps.id) FILTER (WHERE p.first_name = 'P2' AND ps.season_id = :s2) AS p2next
FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Trttest' \gset
SET LOCAL session_replication_role = replica;
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES (:s, 12, 'locked') RETURNING id AS sess \gset
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES (:s2, 13, 'setup') RETURNING id AS sess2 \gset
SET LOCAL session_replication_role = origin;

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

SET LOCAL ROLE authenticated;
-- Before the window opens.
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0003');
SELECT pg_temp.expect_error(format('SELECT public.team_rating_sheet(%s)', :ta), 'haven''t been opened', 'a manager can''t open the rating sheet before an admin opens ratings');
SELECT pg_temp.check(jsonb_array_length(public.my_rating_teams()) = 0, 'no rating card before ratings are opened');
SELECT pg_temp.expect_error(format('SELECT public.save_team_rating(%s, %s, ''{"hitting": 3}'', false)', :ta, :p1), 'are closed', 'a manager can''t save before ratings are opened');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0002');
SELECT pg_temp.expect_error(format('SELECT public.admin_open_team_ratings(%s)', :s), 'Only league admins', 'a registrar can''t open ratings');

SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0001');
SELECT public.admin_open_team_ratings(:s);

-- The manager's side.
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0003');
SELECT pg_temp.check((SELECT jsonb_agg(x->>'team') FROM jsonb_array_elements(public.my_rating_teams()) x) = '["Ratings A"]'::jsonb
  AND (public.my_rating_teams()->0->>'is_open')::boolean AND (public.my_rating_teams()->0->>'players')::int = 2,
  'the manager sees only their own team to rate, with 2 players');
SELECT pg_temp.expect_error(format('SELECT public.team_rating_sheet(%s)', :tb), 'Only the team''s manager', 'a manager can''t open another team');
SELECT pg_temp.expect_error(format('SELECT public.save_team_rating(%s, %s, ''{"hitting": 3}'', false)', :ta, :p3), 'isn''t on this team', 'a player on another team can''t be rated');
SELECT pg_temp.expect_error(format('SELECT public.save_team_rating(%s, %s, ''{"pitching_mechanics": 3}'', false)', :ta, :p1), 'Rate at least one', 'a save needs one core skill (pitching alone isn''t enough)');
SELECT pg_temp.expect_error(format('SELECT public.save_team_rating(%s, %s, ''{"hitting": 6}'', false)', :ta, :p1), 'whole numbers from 1 to 5', 'scores are 1 to 5');
SELECT public.save_team_rating(:ta, :p1, '{"hitting": 4, "throwing": 5, "fly_balls": null, "pitching_mechanics": 3}', false);
SELECT public.save_team_rating(:ta, :p1, '{"hitting": 2, "throwing": 5, "pitching_mechanics": 3}', false);
SELECT public.save_team_rating(:ta, :p2, '{"hitting": 4}', true);
SELECT public.team_rating_sheet(:ta) AS sheet \gset
SELECT pg_temp.check((SELECT string_agg((x->>'first_name') || ':' || (x->>'status') || ':' || (x->'ratings')::text, ' ' ORDER BY x->>'first_name')
                      FROM jsonb_array_elements((:'sheet')::jsonb->'players') x)
  = 'P1:rated:{"hitting": 2, "throwing": 5, "pitching_mechanics": 3} P2:not_rated:{}',
  'saving again replaces the scores; blanks are skipped; Not rated keeps no scores');
SELECT pg_temp.check(((:'sheet')::jsonb->>'can_save')::boolean, 'the sheet says the manager can save while ratings are open');
SELECT pg_temp.expect_error(format('SELECT public.admin_team_rating_progress(%s)', :s), 'Only league admins', 'a manager can''t see league-wide progress');

SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0004');
SELECT pg_temp.expect_error(format('SELECT public.team_rating_sheet(%s)', :ta), 'Only the team''s manager', 'the team''s coach (not the manager) can''t rate');
SELECT pg_temp.check(jsonb_array_length(public.my_rating_teams()) = 0, 'the coach gets no rating card');

SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0001');
SELECT public.admin_team_rating_progress(:s) AS prog \gset
SELECT pg_temp.check((SELECT string_agg((x->>'team') || ':' || (x->>'players') || '/' || (x->>'rated') || '/' || (x->>'not_rated') || ':' || (x->>'manager'), ' ' ORDER BY x->>'team')
                      FROM jsonb_array_elements((:'prog')::jsonb->'teams') x) = 'Ratings A:2/1/1:Amy Manager Ratings B:1/0/0:Ben Manager'
  AND ((:'prog')::jsonb->'window'->>'is_open')::boolean,
  'admin progress: per team players / rated / not rated, with the manager');
SELECT public.admin_close_team_ratings(:s);

SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0003');
SELECT pg_temp.expect_error(format('SELECT public.save_team_rating(%s, %s, ''{"hitting": 3}'', false)', :ta, :p1), 'are closed', 'after the admin closes ratings the manager can''t save');
SELECT pg_temp.check(NOT (public.team_rating_sheet(:ta)->>'can_save')::boolean AND jsonb_array_length(public.my_rating_teams()) = 1,
  'after closing, the manager can still look at their ratings (read-only)');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0001');
SELECT public.save_team_rating(:tb, :p3, '{"grounders": 3}', false);
SELECT pg_temp.check((public.admin_season_close_check(:s)->>'team_players_unrated')::int = 0 AND NOT (public.admin_season_close_check(:s)->>'team_ratings_open')::boolean,
  'an admin can still fill in a rating after closing; the close checklist counts players not rated');
RESET ROLE;

SELECT pg_temp.check((SELECT count(*) FROM public.historical_evaluations WHERE source_team_id = :ta) = 2
  AND (SELECT count(*) FROM public.audit_log WHERE action = 'team_rating_saved' AND after_data->>'team_id' = :'ta') = 3
  AND (SELECT count(*) FROM public.audit_log WHERE action = 'team_rating_saved' AND after_data->>'team_id' = :'ta' AND before_data IS NOT NULL) = 1
  AND (SELECT (after_data->>'by_admin')::boolean FROM public.audit_log WHERE action = 'team_rating_saved' AND after_data->>'team_id' = :'tb'),
  'one rating per team and player; every save audited with the old scores, admin saves marked');
SELECT pg_temp.check((SELECT prior_ratings FROM private.session_player_summary(:sess, NULL) WHERE player_season_id = :p1) = 0,
  'a season''s own end-of-season ratings never show as its prior year');
SELECT pg_temp.check((SELECT prior_overall = 3.5 AND prior_ratings = 1 AND skill_averages->'prior'->>'pitching' = '3.00'
                      FROM private.session_player_summary(:sess2, NULL) WHERE player_season_id = :p1next)
  AND (SELECT prior_ratings = 0 AND prior_overall IS NULL FROM private.session_player_summary(:sess2, NULL) WHERE player_season_id = :p2next),
  'next season the ratings are the prior year (3.5 from hitting 2 and throwing 5); Not rated counts as nothing');

UPDATE public.seasons SET is_closed = true WHERE id = :s;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0001');
SELECT pg_temp.expect_error(format('SELECT public.save_team_rating(%s, %s, ''{"hitting": 3}'', false)', :ta, :p1), 'season is closed', 'nobody changes ratings once the season is closed');
SELECT pg_temp.expect_error(format('SELECT public.admin_open_team_ratings(%s)', :s), 'closed', 'ratings can''t be opened in a closed season');
SELECT pg_temp.expect_error('SELECT count(*) FROM public.team_rating_windows', 'permission denied', 'nobody reads the window table directly');
RESET ROLE;

ROLLBACK;
