-- Runtime check: team rosters, moving players (and fixing a pick during a live draft), releasing rosters, the CSV rows.
-- Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000b0001', 'tr-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b0002', 'tr-registrar@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b0003', 'tr-mgr-a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b0004', 'tr-mgr-b@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b0005', 'tr-asst-a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b0006', 'tr-other@example.test', 'authenticated', 'authenticated');
INSERT INTO public.user_profiles (user_id, display_name) VALUES
  ('00000000-0000-4000-8000-0000000b0003', 'Amy Manager'), ('00000000-0000-4000-8000-0000000b0004', 'Ben Manager'), ('00000000-0000-4000-8000-0000000b0005', 'Al Assistant');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Rosters 2088', '2088-01-01', '2088-06-30') RETURNING id AS s \gset
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Rosters 2089', '2089-01-01', '2089-06-30') RETURNING id AS s2 \gset
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000b0001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000b0002', 'registrar', :s),
  ('00000000-0000-4000-8000-0000000b0003', 'coach', :s), ('00000000-0000-4000-8000-0000000b0004', 'coach', :s),
  ('00000000-0000-4000-8000-0000000b0005', 'coach', :s), ('00000000-0000-4000-8000-0000000b0006', 'coach', :s);
UPDATE public.season_divisions sd SET min_age = x.lo, max_age = x.hi
FROM public.divisions d, (VALUES ('AA', 7, 9), ('AAA', 8, 11), ('Majors', 10, 12), ('Juniors', 13, 14), ('Seniors', 15, 16)) x(n, lo, hi)
WHERE d.id = sd.division_id AND d.name = x.n AND sd.season_id IN (:s, :s2);
SELECT max(sd.id) FILTER (WHERE d.name = 'Majors' AND sd.season_id = :s) AS majors, max(sd.id) FILTER (WHERE d.name = 'Majors' AND sd.season_id = :s2) AS majors2
FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id \gset
SET LOCAL session_replication_role = replica;
INSERT INTO public.evaluation_sessions (season_id, league_age, status, published_at, published_by)
  SELECT :s, a, 'locked', now(), '00000000-0000-4000-8000-0000000b0001'::uuid FROM generate_series(10, 12) a;
SET LOCAL session_replication_role = origin;
INSERT INTO public.players (first_name, last_name) VALUES ('P1', 'Trtest'), ('P2', 'Trtest'), ('P3', 'Trtest'), ('P4', 'Trtest'), ('P5', 'Trtest');
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number, external_player_id)
SELECT p.id, :s, 12, 500 + right(p.first_name, 1)::int, 'PID-' || p.first_name FROM public.players p WHERE p.last_name = 'Trtest';
SELECT max(ps.id) FILTER (WHERE p.first_name = 'P1') AS p1, max(ps.id) FILTER (WHERE p.first_name = 'P2') AS p2,
       max(ps.id) FILTER (WHERE p.first_name = 'P3') AS p3, max(ps.id) FILTER (WHERE p.first_name = 'P4') AS p4
FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Trtest' \gset

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
CREATE FUNCTION pg_temp.sys(p_sql text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v text; BEGIN EXECUTE p_sql INTO v; RETURN v; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.sys(text) TO authenticated;

-- Two Majors teams, a draft of 2 per team, started; P1 and P2 picked.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0002');
SELECT public.admin_save_team(NULL, :majors, 'Aces') AS ta \gset
SELECT public.admin_save_team(NULL, :majors, 'Bats') AS tb \gset
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0001');
SELECT public.admin_save_team(NULL, :majors2, 'Next year') AS tz \gset
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0002');
SELECT public.admin_set_team_staff(:ta, '00000000-0000-4000-8000-0000000b0003', NULL, ARRAY['00000000-0000-4000-8000-0000000b0005']::uuid[]);
SELECT public.admin_set_team_staff(:tb, '00000000-0000-4000-8000-0000000b0004', NULL, NULL);
SELECT public.admin_create_draft(:majors) AS d \gset
SELECT public.admin_save_draft_settings(:d, '{"roster_size": 2}');
SELECT public.admin_set_draft_order(:d, ARRAY[:ta, :tb]);
SELECT public.admin_start_draft(:d);
SELECT public.admin_draft_pick(:d, :p1, NULL);
SELECT public.admin_draft_pick(:d, :p2, NULL);

-- ---------- moving ----------
SELECT pg_temp.expect_error(format('SELECT public.admin_move_player(%s, %s, '''')', :p1, :tb), 'short note', 'a move needs a note');
SELECT pg_temp.expect_error(format('SELECT public.admin_move_player(%s, %s, ''Wrong season'')', :p1, :tz), 'not found in this season', 'a player can''t move to another season''s team');
SELECT public.admin_move_player(:p1, :tb, 'Trade agreed by both managers');
SELECT pg_temp.check(pg_temp.sys(format('SELECT team_id FROM public.player_seasons WHERE id = %s', :p1)) = :'tb', 'a drafted player moves to another team');
SELECT pg_temp.check((SELECT s->'pick'->>'moved_to' FROM jsonb_array_elements(public.draft_board(:d)->'slots') s WHERE (s->>'overall')::int = 1) = 'Bats',
  'the draft board keeps the pick and says where the player went');
-- A wrong pick during the draft: back to the pool, and the slot comes up again.
SELECT public.admin_move_player(:p2, NULL, 'Wrong player picked; Bats pick again');
SELECT pg_temp.check((public.draft_board(:d)->'next'->>'overall')::int = 2 AND pg_temp.sys(format('SELECT team_id FROM public.player_seasons WHERE id = %s', :p2)) IS NULL,
  'moving a pick back to the pool during the draft reopens that pick');
SELECT pg_temp.check(pg_temp.sys(format('SELECT pick_removed::text FROM public.roster_moves WHERE player_season_id = %s', :p2)) = 'true'
  AND pg_temp.sys(format('SELECT count(*) FROM public.audit_log WHERE action IN (''roster_move'', ''draft_pick_removed'') AND target_id IN (''%s'', ''%s'')', :p1, :p2)) = '3',
  'moves are recorded and audited (with the removed pick)');
SELECT public.admin_draft_pick(:d, :p3, NULL);
SELECT pg_temp.expect_error(format('SELECT public.admin_move_player(%s, NULL, ''note'')', :p4), 'isn''t on a team', 'an unplaced player can''t go back to the pool');
SELECT public.admin_move_player(:p4, :ta, 'Placed by hand after the draft');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0006');
SELECT pg_temp.expect_error(format('SELECT public.admin_move_player(%s, %s, ''note'')', :p4, :tb), 'Only admins and registrars', 'a coach can''t move players');

-- ---------- the page and the CSV ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0002');
SELECT pg_temp.check((SELECT string_agg(t->>'name' || ':' || jsonb_array_length(t->'players'), ',' ORDER BY t->>'name')
  FROM jsonb_array_elements(public.season_rosters(:s)->'divisions') d, jsonb_array_elements(d->'teams') t WHERE d->>'name' = 'Majors') = 'Aces:1,Bats:2',
  'the rosters page lists each team''s players');
SELECT pg_temp.check((SELECT p->'placement'->>'how' FROM jsonb_array_elements(public.season_rosters(:s)->'divisions') d, jsonb_array_elements(d->'teams') t,
  jsonb_array_elements(t->'players') p WHERE (p->>'player_season_id')::bigint = :p1) = 'moved', 'a moved player shows how they got there');
SELECT pg_temp.check((SELECT string_agg(u->>'first_name', ',' ORDER BY u->>'first_name') FROM jsonb_array_elements(public.season_rosters(:s)->'unplaced') u) = 'P2,P5'
  AND (SELECT u->'pools' FROM jsonb_array_elements(public.season_rosters(:s)->'unplaced') u WHERE u->>'first_name' = 'P5') = '["Majors"]'::jsonb,
  'unplaced players are listed with the pools they''re in');
SELECT pg_temp.check((SELECT bool_and(s->>'email' IS NULL) FROM jsonb_array_elements(public.season_rosters(:s)->'divisions') d, jsonb_array_elements(d->'teams') t, jsonb_array_elements(t->'staff') s),
  'registrars see staff names, not emails');
SELECT pg_temp.check((SELECT string_agg(player_first_name || '=' || placed_by, ' | ' ORDER BY player_first_name) FROM public.season_roster_rows(:s))
  = 'P1=Moved by admin: Trade agreed by both managers | P3=Draft round 1, pick 2 | P4=Moved by admin: Placed by hand after the draft',
  'the CSV rows say how each player was placed');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0001');
SELECT pg_temp.check((SELECT manager_email FROM public.season_roster_rows(:s) WHERE player_first_name = 'P3') = 'tr-mgr-b@example.test', 'admins get staff emails in the CSV');

-- ---------- releasing ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0003');
SELECT pg_temp.check(jsonb_array_length(public.my_team_rosters()) = 0, 'before release a manager doesn''t see the roster');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0002');
SELECT public.admin_release_rosters(:majors, true);
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0005');
SELECT pg_temp.check((SELECT t->>'team' || ':' || jsonb_array_length(t->'players') FROM jsonb_array_elements(public.my_team_rosters()) t) = 'Aces:1',
  'after release the assistant coach sees their team');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0006');
SELECT pg_temp.check(jsonb_array_length(public.my_team_rosters()) = 0, 'a coach not on a team sees nothing');
RESET ROLE;

ROLLBACK;
