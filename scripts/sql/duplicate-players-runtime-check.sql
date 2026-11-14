-- Runtime check: possible-duplicate players (flag, merge, "Not a duplicate"). Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000d0001', 'dp-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000d0002', 'dp-coach@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Dup Old 2083', '2083-01-01', '2083-06-30') RETURNING id AS s_old \gset
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Dup New 2084', '2084-01-01', '2084-06-30') RETURNING id AS s_new \gset
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000d0001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000d0002', 'coach', :s_new);
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES (:s_new, 9, 'setup') RETURNING id AS sess \gset
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type) VALUES (:sess, '00000000-0000-4000-8000-0000000d0002', 'coach');
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location)
  VALUES (:sess, 'primary', '2084-01-20', '09:00', '10:00', 'Field 1') RETURNING id AS ev \gset
UPDATE public.evaluation_sessions SET status = 'open' WHERE id = :sess;

-- A: same name (different spacing and case) and birthdate, last season and this season, with a prior-year rating.
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Kai', 'Duptest', '2075-01-01') RETURNING id AS a1 \gset
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('kai ', ' DUPTEST', '2075-01-01') RETURNING id AS a2 \gset
INSERT INTO public.player_seasons (player_id, season_id, league_age, external_player_id) VALUES (:a1, :s_old, 8, 'DUP-A-OLD');
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number) VALUES (:a2, :s_new, 9, 9101);
INSERT INTO public.historical_evaluations (player_id, source_season_label, source_division_name, source_season_id) VALUES (:a1, 'Dup Old 2083', 'AA', :s_old);
-- B: same name, one birthdate missing, both registered this season. B1 has scores; B2 has the Player Id, a check-in,
-- a star and a private note, and the coach has a note on B1 too.
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Lu', 'Duptest', NULL) RETURNING id AS b1 \gset
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Lu', 'Duptest', '2075-02-02') RETURNING id AS b2 \gset
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number) VALUES (:b1, :s_new, 9, 9102) RETURNING id AS b1r \gset
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number, external_player_id, registration_source)
  VALUES (:b2, :s_new, 9, 9103, 'DUP-B', 'on_site') RETURNING id AS b2r \gset
INSERT INTO public.player_checkins (player_season_id, event_id) VALUES (:b2r, :ev);
INSERT INTO public.player_stars (user_id, player_season_id) VALUES ('00000000-0000-4000-8000-0000000d0002', :b2r);
INSERT INTO public.private_notes (player_season_id, author_user_id, note_text) VALUES
  (:b1r, '00000000-0000-4000-8000-0000000d0002', 'Strong arm'), (:b2r, '00000000-0000-4000-8000-0000000d0002', 'Fast runner');
-- C: different first names, same Sports Connect Player Id in two seasons.
INSERT INTO public.players (first_name, last_name) VALUES ('Max', 'Duptest') RETURNING id AS c1 \gset
INSERT INTO public.players (first_name, last_name) VALUES ('Maxine', 'Duptest') RETURNING id AS c2 \gset
INSERT INTO public.player_seasons (player_id, season_id, league_age, external_player_id) VALUES (:c1, :s_old, 8, 'DUP-C'), (:c2, :s_new, 9, 'dup-c ');
-- D: same name, different birthdates: not flagged.
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Dee', 'Duptest', '2075-03-03') RETURNING id AS d1 \gset
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Dee', 'Duptest', '2075-04-04') RETURNING id AS d2 \gset
-- E: same name and birthdate, both registered and scored this season.
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Eve', 'Duptest', '2075-05-05') RETURNING id AS e1 \gset
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Eve', 'Duptest', '2075-05-05') RETURNING id AS e2 \gset
INSERT INTO public.player_seasons (player_id, season_id, league_age) VALUES (:e1, :s_new, 9) RETURNING id AS e1r \gset
INSERT INTO public.player_seasons (player_id, season_id, league_age) VALUES (:e2, :s_new, 9) RETURNING id AS e2r \gset
-- F: same name and birthdate, both registered last season, which is closed.
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Fin', 'Duptest', '2075-06-06') RETURNING id AS f1 \gset
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Fin', 'Duptest', '2075-06-06') RETURNING id AS f2 \gset
INSERT INTO public.player_seasons (player_id, season_id, league_age) VALUES (:f1, :s_old, 8), (:f2, :s_old, 8);
UPDATE public.seasons SET is_closed = true WHERE id = :s_old;

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
-- The reasons a pair (by player ids) is flagged for, as seen by the signed-in admin.
CREATE FUNCTION pg_temp.flag(p_a bigint, p_b bigint) RETURNS text LANGUAGE sql AS $$
  SELECT array_to_string(reasons, ',') || CASE WHEN dismissed THEN ' (dismissed)' ELSE '' END
  FROM public.admin_possible_duplicates()
  WHERE (player_a ->> 'id')::bigint = LEAST(p_a, p_b) AND (player_b ->> 'id')::bigint = GREATEST(p_a, p_b);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.flag(bigint, bigint) TO authenticated;

-- ---------- scores: the coach scores B1, E1 and E2 ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
SELECT public.save_evaluation(:sess, ps, '{"hitting":3}', '{}', 'submitted') FROM unnest(ARRAY[:b1r, :e1r, :e2r]::bigint[]) ps;
SELECT pg_temp.check((SELECT count(*) FROM public.admin_possible_duplicates()) = 0 AND public.admin_possible_duplicate_count() IS NULL,
  'a coach sees no duplicate list');
SELECT pg_temp.expect_error(format('SELECT public.admin_merge_players(%s, %s, %L)', :a2, :a1, 'Same child twice'), 'Administrator access required',
  'a coach cannot merge');

-- ---------- what is flagged ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
SELECT pg_temp.check(pg_temp.flag(:a1, :a2) = 'name_birthdate', 'same name (case and spaces ignored) and birthdate is flagged');
SELECT pg_temp.check(pg_temp.flag(:b1, :b2) = 'name_birthdate_missing', 'same name with one birthdate missing is flagged');
SELECT pg_temp.check(pg_temp.flag(:c1, :c2) = 'same_player_id', 'the same Sports Connect Player Id is flagged');
SELECT pg_temp.check(pg_temp.flag(:d1, :d2) IS NULL, 'same name with different birthdates is not flagged');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.admin_possible_duplicates() d WHERE (d.player_a::text || d.player_b::text) ~ '2075-'),
  'the list never contains birthdates');

-- ---------- Not a duplicate ----------
SELECT pg_temp.expect_error(format('SELECT public.admin_dismiss_duplicate(%s, %s, %L)', :c1, :c2, 'no'), 'at least 5 characters', '"Not a duplicate" needs a reason');
SELECT public.admin_dismiss_duplicate(:c2, :c1, 'Siblings who shared an account');
SELECT pg_temp.check(pg_temp.flag(:c1, :c2) = 'same_player_id (dismissed)'
  AND public.admin_possible_duplicate_count() = (SELECT count(*) FROM public.admin_possible_duplicates() WHERE NOT dismissed),
  'a dismissed pair moves to the "Not duplicates" list and leaves the count');
SELECT public.admin_restore_duplicate(:c1, :c2);
SELECT pg_temp.check(pg_temp.flag(:c1, :c2) = 'same_player_id', 'it can be flagged again');
SELECT pg_temp.expect_error(format('SELECT public.admin_merge_players(%s, %s, %L)', :d1, :d2, 'Same child twice'), 'aren''t flagged',
  'players that are not flagged cannot be merged');

-- ---------- merges that are refused ----------
SELECT pg_temp.expect_error(format('SELECT public.admin_merge_players(%s, %s, %L)', :e1, :e2, 'Same child twice'), 'Both registrations in Dup New 2084 have scores',
  'two scored registrations in one season are not merged');
SELECT pg_temp.expect_error(format('SELECT public.admin_merge_players(%s, %s, %L)', :f1, :f2, 'Same child twice'), 'which is closed',
  'two registrations in a closed season are not merged');
SELECT pg_temp.expect_error(format('SELECT public.admin_merge_players(%s, %s, %L)', :a2, :a1, 'dup'), 'at least 10 characters', 'a merge needs a reason');

-- ---------- merge across seasons ----------
SELECT public.admin_merge_players(:a2, :a1, 'Same child, last year and this year');
RESET ROLE;
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.players WHERE id = :a1)
  AND (SELECT count(*) FROM public.player_seasons WHERE player_id = :a2) = 2
  AND (SELECT player_id FROM public.historical_evaluations WHERE source_season_id = :s_old) = :a2,
  'last season''s registration (closed season) and prior-year rating move to the kept player');

-- ---------- merge in one season ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000d0001');
SELECT public.admin_merge_players(:b2, :b1, 'Walk-up was already registered');
RESET ROLE;
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.player_seasons WHERE id = :b2r)
  AND (SELECT player_id = :b2 AND evaluation_number = 9102 AND external_player_id = 'DUP-B' FROM public.player_seasons WHERE id = :b1r),
  'the scored registration survives under the kept player and takes the other''s Player Id');
SELECT pg_temp.check((SELECT count(*) FROM public.player_checkins WHERE player_season_id = :b1r) = 1
  AND (SELECT count(*) FROM public.player_stars WHERE player_season_id = :b1r) = 1
  AND (SELECT note_text FROM public.private_notes WHERE player_season_id = :b1r) = E'Strong arm\n\nFast runner',
  'check-in, star and the coach''s two notes come along (notes joined)');
SELECT pg_temp.check((SELECT date_of_birth FROM public.players WHERE id = :b2) = '2075-02-02', 'the kept player keeps its birthdate');
SELECT pg_temp.check((SELECT after_data -> 'same_season' -> 0 ->> 'removed_bib' = '9103'
                             AND before_data -> 'removed' ->> 'id' = :'b1'
                             AND (before_data::text || after_data::text) !~ '2075-'
                      FROM public.audit_log WHERE action = 'players_merged' AND target_id = :'b2'),
  'the merge is audited with the dropped registration, without birthdates');

ROLLBACK;
