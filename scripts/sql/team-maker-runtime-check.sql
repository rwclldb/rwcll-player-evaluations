-- Runtime check: the team maker's data and saving. Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000a0001', 'tm-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000a0002', 'tm-registrar@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000a0003', 'tm-mgr@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000a0004', 'tm-coach@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Maker 2090', '2090-01-01', '2090-06-30') RETURNING id AS s \gset
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000a0001', 'administrator', NULL), ('00000000-0000-4000-8000-0000000a0002', 'registrar', :s),
  ('00000000-0000-4000-8000-0000000a0003', 'coach', :s), ('00000000-0000-4000-8000-0000000a0004', 'coach', :s);
UPDATE public.season_divisions sd SET min_age = x.lo, max_age = x.hi
FROM public.divisions d, (VALUES ('AA', 7, 9), ('AAA', 8, 11), ('Majors', 10, 12), ('Juniors', 13, 14), ('Seniors', 15, 16)) x(n, lo, hi)
WHERE d.id = sd.division_id AND d.name = x.n AND sd.season_id = :s;
SELECT max(sd.id) FILTER (WHERE d.name = 'AA') AS aa, max(sd.id) FILTER (WHERE d.name = 'AAA') AS aaa
FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id WHERE sd.season_id = :s \gset
INSERT INTO public.players (first_name, last_name) SELECT 'K' || g, 'Tmtest' FROM generate_series(1, 6) g;
INSERT INTO public.player_seasons (player_id, season_id, league_age) SELECT p.id, :s, 7 + (right(p.first_name, 1)::int % 3) FROM public.players p WHERE p.last_name = 'Tmtest';
SELECT max(ps.id) FILTER (WHERE p.first_name = 'K1') AS k1, max(ps.id) FILTER (WHERE p.first_name = 'K2') AS k2, max(ps.id) FILTER (WHERE p.first_name = 'K3') AS k3,
       max(ps.id) FILTER (WHERE p.first_name = 'K4') AS k4
FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Tmtest' \gset
INSERT INTO public.import_batches (import_type, source_file_name, season_id, created_by) VALUES ('players', 'tm.csv', :s, '00000000-0000-4000-8000-0000000a0001') RETURNING id AS b \gset
INSERT INTO public.sports_connect_import_rows (import_batch_id, source_row_number, first_name, last_name, source_division, review_state, committed_player_season_id)
SELECT :b, 1 + row_number() OVER (ORDER BY ps.id), 'x', 'y', 'AA', 'committed', ps.id FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Tmtest';

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

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000a0002');
SELECT public.admin_save_team(NULL, :aa, 'Owls') AS t1 \gset
SELECT public.admin_save_team(NULL, :aa, 'Hawks') AS t2 \gset
SELECT public.admin_save_team(NULL, :aaa, 'Other') AS t3 \gset
SELECT public.admin_set_team_staff(:t1, '00000000-0000-4000-8000-0000000a0003', NULL, NULL);
SELECT public.admin_link_coach_kid(:k1, '00000000-0000-4000-8000-0000000a0003');
SELECT public.admin_group_siblings(ARRAY[:k2, :k3]);

-- ---------- the data ----------
SELECT pg_temp.check(jsonb_array_length(public.team_maker_data(:aa)->'players') = 6 AND jsonb_array_length(public.team_maker_data(:aa)->'teams') = 2,
  'the team maker gets the division''s pool and teams');
SELECT pg_temp.check((SELECT (p->>'kid_team_id')::bigint FROM jsonb_array_elements(public.team_maker_data(:aa)->'players') p WHERE (p->>'player_season_id')::bigint = :k1) = :t1
  AND (SELECT count(DISTINCT p->>'sibling_group') FROM jsonb_array_elements(public.team_maker_data(:aa)->'players') p WHERE (p->>'player_season_id')::bigint IN (:k2, :k3)) = 1,
  'it knows the coach''s kid''s team and the sibling group');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000a0004');
SELECT pg_temp.expect_error(format('SELECT public.team_maker_data(%s)', :aa), 'Only admins and registrars', 'a coach can''t use the team maker');
SELECT pg_temp.expect_error(format('SELECT public.admin_place_players(%s, ''[]'', ''{}'')', :aa), 'Only admins and registrars', 'a coach can''t save teams');

-- ---------- saving ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000a0002');
SELECT pg_temp.expect_error(format('SELECT public.admin_place_players(%s, ''[{"player_season_id": %s, "team_id": %s}]'', ''{}'')', :aa, :k4, :t3), 'isn''t in this division',
  'a player can only go on one of the division''s teams');
SELECT pg_temp.check(public.admin_place_players(:aa, format('[{"player_season_id": %s, "team_id": %s}, {"player_season_id": %s, "team_id": %s}, {"player_season_id": %s, "team_id": %s}]',
  :k1, :t1, :k2, :t2, :k3, :t2)::jsonb, '{"sources": ["evaluator", "coach"], "balance_ages": true}') = 3
  AND pg_temp.sys(format('SELECT team_id FROM public.player_seasons WHERE id = %s', :k2)) = :'t2', 'saving places the players');
SELECT pg_temp.check(pg_temp.sys(format('SELECT after_data->''settings''->>''balance_ages'' FROM public.audit_log WHERE action = ''teams_generated'' AND target_id = ''%s''', :aa)) = 'true',
  'the save is audited with the settings used');
SELECT pg_temp.expect_error(format('SELECT public.admin_place_players(%s, ''[{"player_season_id": %s, "team_id": %s}]'', ''{}'')', :aa, :k2, :t1), 'already on a team',
  'a player already on a team isn''t placed again');
SELECT pg_temp.check((SELECT p->'placement'->>'how' FROM jsonb_array_elements(public.season_rosters(:s)->'divisions') d, jsonb_array_elements(d->'teams') t,
  jsonb_array_elements(t->'players') p WHERE (p->>'player_season_id')::bigint = :k2) = 'team_maker'
  AND (SELECT placed_by FROM public.season_roster_rows(:s) WHERE player_first_name = 'K2') = 'Team maker', 'rosters and the CSV say "Team maker"');
SELECT pg_temp.check((SELECT count(*) FROM jsonb_array_elements(public.team_maker_data(:aa)->'players') p WHERE p->>'team_id' IS NOT NULL) = 3,
  'players already placed come back as fixed on their team');
-- A running draft blocks it.
SELECT public.admin_create_draft(:aa) AS d \gset
RESET ROLE;
UPDATE public.drafts SET status = 'live' WHERE id = :d;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.admin_place_players(%s, ''[{"player_season_id": %s, "team_id": %s}]'', ''{}'')', :aa, :k4, :t1), 'draft is running',
  'not while the division''s draft is running');
RESET ROLE;

ROLLBACK;
