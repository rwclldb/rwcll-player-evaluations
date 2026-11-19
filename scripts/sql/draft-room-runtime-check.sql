-- Runtime check: the draft room. A small Majors draft is played from start to finish, plus an oldest-first case.
-- Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000c0001', 'dr-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c0002', 'dr-registrar@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c0003', 'dr-mgr-a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c0004', 'dr-mgr-b@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c0005', 'dr-other@example.test', 'authenticated', 'authenticated');
INSERT INTO public.user_profiles (user_id, display_name) VALUES
  ('00000000-0000-4000-8000-0000000c0003', 'Ann Manager'), ('00000000-0000-4000-8000-0000000c0004', 'Bo Manager');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Room 2087', '2087-01-01', '2087-06-30') RETURNING id AS s \gset
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000c0001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000c0002', 'registrar', :s),
  ('00000000-0000-4000-8000-0000000c0003', 'coach', :s),
  ('00000000-0000-4000-8000-0000000c0004', 'coach', :s),
  ('00000000-0000-4000-8000-0000000c0005', 'coach', :s);
UPDATE public.season_divisions sd SET min_age = x.lo, max_age = x.hi
FROM public.divisions d, (VALUES ('AA', 7, 9), ('AAA', 8, 11), ('Majors', 10, 12), ('Juniors', 13, 14), ('Seniors', 15, 16)) x(n, lo, hi)
WHERE d.id = sd.division_id AND d.name = x.n AND sd.season_id = :s;
SELECT max(sd.id) FILTER (WHERE d.name = 'Majors') AS majors, max(sd.id) FILTER (WHERE d.name = 'Juniors') AS juniors,
       max(sd.id) FILTER (WHERE d.name = 'AAA') AS aaa
FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id WHERE sd.season_id = :s \gset
-- Age groups 10-14, released (set up directly; the lock/release workflow is tested elsewhere).
SET LOCAL session_replication_role = replica;
INSERT INTO public.evaluation_sessions (season_id, league_age, status, published_at, published_by)
  SELECT :s, a, 'locked', CASE WHEN a = 13 THEN NULL ELSE now() END, CASE WHEN a = 13 THEN NULL ELSE '00000000-0000-4000-8000-0000000c0001'::uuid END FROM generate_series(10, 14) a;
SET LOCAL session_replication_role = origin;

-- Majors players: K12 = manager A's kid; S12 and S10 are siblings; S10, P11, P10 asked for Majors.
INSERT INTO public.players (first_name, last_name) VALUES
  ('K12', 'Drtest'), ('S12', 'Drtest'), ('P12a', 'Drtest'), ('P12b', 'Drtest'), ('P11', 'Drtest'), ('S10', 'Drtest'), ('P10', 'Drtest'),
  ('J14a', 'Drtest'), ('J14b', 'Drtest'), ('J13a', 'Drtest'), ('J13b', 'Drtest');
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number)
SELECT p.id, :s, substring(p.first_name from 2 for 2)::int, 600 + row_number() OVER (ORDER BY p.first_name)
FROM public.players p WHERE p.last_name = 'Drtest';
SELECT max(ps.id) FILTER (WHERE p.first_name = 'K12') AS k12, max(ps.id) FILTER (WHERE p.first_name = 'S12') AS s12,
       max(ps.id) FILTER (WHERE p.first_name = 'P12a') AS p12a, max(ps.id) FILTER (WHERE p.first_name = 'P12b') AS p12b,
       max(ps.id) FILTER (WHERE p.first_name = 'P11') AS p11, max(ps.id) FILTER (WHERE p.first_name = 'S10') AS s10,
       max(ps.id) FILTER (WHERE p.first_name = 'P10') AS p10, max(ps.id) FILTER (WHERE p.first_name = 'J14a') AS j14a,
       max(ps.id) FILTER (WHERE p.first_name = 'J13a') AS j13a
FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Drtest' \gset
INSERT INTO public.import_batches (import_type, source_file_name, season_id, created_by)
  VALUES ('players', 'dr.csv', :s, '00000000-0000-4000-8000-0000000c0001') RETURNING id AS b \gset
INSERT INTO public.sports_connect_import_rows (import_batch_id, source_row_number, first_name, last_name, source_division, review_state, committed_player_season_id)
VALUES (:b, 2, 'S10', 'Drtest', 'Majors', 'committed', :s10), (:b, 3, 'P11', 'Drtest', 'Majors', 'committed', :p11), (:b, 4, 'P10', 'Drtest', 'Majors', 'committed', :p10);

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
-- The board as "overall:player(kind)" for the picks made.
CREATE FUNCTION pg_temp.picks(p_draft bigint) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT string_agg(dp.overall || ':' || pl.first_name || CASE dp.kind WHEN 'pick' THEN '' ELSE '(' || dp.kind || ')' END, ',' ORDER BY dp.overall)
  FROM public.draft_picks dp JOIN public.player_seasons ps ON ps.id = dp.player_season_id JOIN public.players pl ON pl.id = ps.player_id
  WHERE dp.draft_id = p_draft;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.picks(bigint) TO authenticated;

-- Setup: two teams, roster 3 (6 picks, 7 players), snake; manager A's kid in round 2; siblings S12 + S10.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0002');
SELECT public.admin_save_team(NULL, :majors, 'Aces') AS ta \gset
SELECT public.admin_save_team(NULL, :majors, 'Bats') AS tb \gset
SELECT public.admin_set_team_staff(:ta, '00000000-0000-4000-8000-0000000c0003', NULL, NULL);
SELECT public.admin_set_team_staff(:tb, '00000000-0000-4000-8000-0000000c0004', NULL, NULL);
SELECT public.admin_link_coach_kid(:k12, '00000000-0000-4000-8000-0000000c0003');
SELECT public.admin_group_siblings(ARRAY[:s12, :s10]);
SELECT public.admin_create_draft(:majors) AS d \gset
SELECT public.admin_save_draft_settings(:d, '{"roster_size": 3, "coach_kid_rule": "fixed_rounds", "coach_kid_rounds": [2], "sibling_optional": "ask"}');

-- ---------- starting ----------
SELECT pg_temp.expect_error(format('SELECT public.admin_start_draft(%s)', :d), 'first-round order', 'a draft can''t start without the order');
SELECT public.admin_set_draft_order(:d, ARRAY[:ta, :tb]);
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0003');
SELECT pg_temp.expect_error(format('SELECT public.admin_start_draft(%s)', :d), 'Only admins and registrars', 'a manager can''t start the draft');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0002');
SELECT public.admin_start_draft(:d);
SELECT pg_temp.check(pg_temp.sys(format('SELECT status || ''/'' || round FROM public.drafts JOIN public.draft_kid_rounds k ON k.draft_id = drafts.id WHERE drafts.id = %s', :d)) = 'live/2',
  'the draft goes live with the coach''s kid''s round frozen');
SELECT pg_temp.check((SELECT string_agg(x::text, ',') FROM jsonb_array_elements(public.draft_board(:d)->'slots') s, LATERAL (SELECT (s->>'overall')::int AS x) y WHERE (s->>'marked')::boolean) = '3,5,6',
  'must-draft marks: the last 3 open picks (the kid''s round-2 pick for Aces is left out)');
SELECT pg_temp.expect_error(format('SELECT public.admin_delete_team(%s)', :ta), 'started', 'a team in a started draft can''t be deleted');

-- ---------- picking ----------
SELECT public.admin_draft_pick(:d, :p11, NULL);
SELECT pg_temp.expect_error(format('SELECT public.admin_draft_pick(%s, %s, NULL)', :d, :k12), 'coach''s kid of Aces', 'another team can''t take a coach''s kid');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0004');
SELECT pg_temp.expect_error(format('SELECT public.admin_draft_pick(%s, %s, NULL)', :d, :s12), 'Only admins and registrars', 'a manager watches but can''t pick');
SELECT pg_temp.check(jsonb_array_length(public.draft_board(:d)->'slots') = 6 AND public.draft_board(:d)->'my_team_ids' = format('[%s]', :tb)::jsonb,
  'a manager sees the board and knows their team');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0005');
SELECT pg_temp.expect_error(format('SELECT public.draft_board(%s)', :d), 'can watch', 'a coach not in this division can''t watch');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0002');
SELECT public.admin_draft_pick(:d, :s12, NULL);
SELECT pg_temp.check(jsonb_array_length(public.draft_board(:d)->'asks') = 1, 'picking S12 asks about sibling S10 (not must-draft)');
SELECT pg_temp.expect_error(format('SELECT public.admin_draft_pick(%s, %s, NULL)', :d, :p12a), 'waiting sibling', 'no pick while a sibling decision waits');
SELECT public.admin_draft_sibling_decision(:d, :s10, true);
SELECT pg_temp.check(pg_temp.picks(:d) = '1:P11,2:S12,3:S10(sibling),4:K12(coach_kid)',
  'take: S10 goes with Bats'' next pick, then Aces'' round-2 pick is their coach''s kid, automatically');
SELECT pg_temp.check(pg_temp.sys(format('SELECT team_id FROM public.player_seasons WHERE id = %s', :s10)) = :'tb'
  AND pg_temp.sys(format('SELECT season_division_id FROM public.player_seasons WHERE id = %s', :k12)) = :'majors',
  'drafted players are on their team, in Majors');
SELECT pg_temp.expect_error(format('SELECT public.admin_draft_pick(%s, %s, NULL)', :d, :p10), 'Only must-draft', 'on a marked pick only must-draft players can be picked');
SELECT public.admin_pause_draft(:d, true);
SELECT pg_temp.expect_error(format('SELECT public.admin_draft_pick(%s, %s, NULL)', :d, :p12a), 'paused', 'no picks while paused');
SELECT public.admin_pause_draft(:d, false);
SELECT public.admin_draft_pick(:d, :p10, 'Board agreed: P12b moving away');
SELECT pg_temp.check(pg_temp.sys(format('SELECT override_note FROM public.draft_picks WHERE draft_id = %s AND overall = 5', :d)) = 'Board agreed: P12b moving away',
  'a note overrides the must-draft rule and is kept with the pick');
SELECT public.admin_draft_pick(:d, :p12a, NULL);
SELECT pg_temp.expect_error(format('SELECT public.admin_draft_pick(%s, %s, NULL)', :d, :p12b), 'Every pick', 'no picks after the last slot');
SELECT pg_temp.check(public.admin_finish_draft(:d) = 1
  AND pg_temp.sys(format('SELECT player_season_id FROM public.draft_leftovers WHERE draft_id = %s', :d)) = :'p12b',
  'finishing lists the undrafted player as left over');
SELECT pg_temp.check(pg_temp.sys(format('SELECT count(*) FROM public.audit_log WHERE action = ''draft_pick'' AND (after_data->>''draft_id'')::bigint = %s', :d)) = '6'
  AND pg_temp.sys(format('SELECT count(*) FROM public.audit_log WHERE action IN (''draft_started'', ''draft_sibling_decision'', ''draft_paused'', ''draft_resumed'', ''draft_finished'') AND target_id IN (''%s'', ''%s'')', :d, :s10)) = '5',
  'every pick, decision, pause and the start and finish are audited');

-- ---------- the player list ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0003');
SELECT pg_temp.check((SELECT count(*) FROM jsonb_array_elements(public.draft_players(:d)) p WHERE p ? 'my_overall' AND p ? 'coach_trimmed_overall' AND p ? 'starred') = 7,
  'the player list has every pool player with averages, the viewer''s own scores and stars');

-- ---------- sibling sent down; oldest first ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c0002');
SELECT public.admin_save_team(NULL, :juniors, 'Jays') AS tj1 \gset
SELECT public.admin_save_team(NULL, :juniors, 'Owls') AS tj2 \gset
SELECT public.admin_create_draft(:juniors) AS dj \gset
SELECT public.admin_save_draft_settings(:dj, '{"roster_size": 2, "age_order": "oldest_first"}');
SELECT public.admin_draw_draft_order(:dj);
SELECT pg_temp.expect_error(format('SELECT public.admin_start_draft(%s)', :dj), 'Release age group(s) 13', 'a draft can''t start until its age groups are released');
RESET ROLE;
SET LOCAL session_replication_role = replica;
UPDATE public.evaluation_sessions SET published_at = now(), published_by = '00000000-0000-4000-8000-0000000c0001' WHERE season_id = :s AND league_age = 13;
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT public.admin_start_draft(:dj);
SELECT pg_temp.check((public.draft_board(:dj)->>'tier_age')::int = 14, 'oldest first: the 14s are up first');
SELECT pg_temp.expect_error(format('SELECT public.admin_draft_pick(%s, %s, NULL)', :dj, :j13a), 'takes the 14-year-olds first', 'a 13 can''t be taken while 14s are left');
SELECT public.admin_draft_pick(:dj, :j14a, NULL);
SELECT pg_temp.check(public.admin_draft_pick(:dj, :j13a, 'Coach''s request, board approved')->>'overall' = '2', 'a note overrides oldest first');

-- ---------- "always send down" ----------
RESET ROLE;
SET LOCAL session_replication_role = replica;
INSERT INTO public.evaluation_sessions (season_id, league_age, status, published_at, published_by)
  SELECT :s, a, 'locked', now(), '00000000-0000-4000-8000-0000000c0001'::uuid FROM generate_series(8, 9) a;
SET LOCAL session_replication_role = origin;
INSERT INTO public.players (first_name, last_name) VALUES ('A11', 'Drtest2'), ('A9', 'Drtest2');
INSERT INTO public.player_seasons (player_id, season_id, league_age) SELECT p.id, :s, substring(p.first_name from 2)::int FROM public.players p WHERE p.last_name = 'Drtest2';
SELECT max(ps.id) FILTER (WHERE p.first_name = 'A11') AS a11, max(ps.id) FILTER (WHERE p.first_name = 'A9') AS a9
FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Drtest2' \gset
INSERT INTO public.sports_connect_import_rows (import_batch_id, source_row_number, first_name, last_name, source_division, review_state, committed_player_season_id)
VALUES (:b, 9, 'A9', 'Drtest2', 'AAA', 'committed', :a9);
SET LOCAL ROLE authenticated;
SELECT public.admin_group_siblings(ARRAY[:a11, :a9]);
SELECT public.admin_save_team(NULL, :aaa, 'Hawks') AS th \gset
SELECT public.admin_create_draft(:aaa) AS da \gset
SELECT public.admin_save_draft_settings(:da, '{"sibling_optional": "send_down"}');
SELECT public.admin_draw_draft_order(:da);
SELECT public.admin_start_draft(:da);
SELECT public.admin_draft_pick(:da, :a11, NULL);
SELECT pg_temp.check(pg_temp.sys(format('SELECT count(*) FROM public.draft_leftovers WHERE draft_id = %s AND player_season_id = %s', :da, :a9)) = '1'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.draft_board(:da)->'available') x WHERE x::bigint = :a9),
  '"always send down": the younger sibling leaves the AAA pool and is left over for the next division');
RESET ROLE;

ROLLBACK;
