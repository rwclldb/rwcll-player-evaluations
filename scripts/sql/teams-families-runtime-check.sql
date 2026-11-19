-- Runtime check: teams, team staff, coach's-kid links, sibling groups and suggestions. Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000f0001', 'tf-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f0002', 'tf-registrar@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f0003', 'tf-mgr@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f0004', 'TF-Coach@Example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f0005', 'tf-asst@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f0006', 'tf-eval@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000f0007', 'tf-other-reg@example.test', 'authenticated', 'authenticated');
INSERT INTO public.user_profiles (user_id, display_name) VALUES
  ('00000000-0000-4000-8000-0000000f0003', 'Mia Manager'), ('00000000-0000-4000-8000-0000000f0004', 'Cole Coach'),
  ('00000000-0000-4000-8000-0000000f0005', 'Ari Assistant'), ('00000000-0000-4000-8000-0000000f0006', 'Eve Evaluator');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Teams 2083', '2020-01-01', '2020-06-30') RETURNING id AS s \gset
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Teams 2084', '2021-01-01', '2021-06-30') RETURNING id AS s2 \gset
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000f0001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000f0002', 'registrar', :s),
  ('00000000-0000-4000-8000-0000000f0003', 'coach', :s),
  ('00000000-0000-4000-8000-0000000f0004', 'coach', :s),
  ('00000000-0000-4000-8000-0000000f0005', 'coach', :s),
  ('00000000-0000-4000-8000-0000000f0006', 'independent_evaluator', :s),
  ('00000000-0000-4000-8000-0000000f0007', 'registrar', :s2);
SELECT max(sd.id) FILTER (WHERE d.name = 'Majors') AS majors, max(sd.id) FILTER (WHERE d.name = 'AAA') AS aaa
FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id WHERE sd.season_id = :s \gset
INSERT INTO public.players (first_name, last_name) VALUES ('Kit', 'Tftest'), ('Lou', 'Tftest'), ('Max', 'Tftest'), ('Ned', 'Tftest'), ('Oz', 'Tftest');
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number)
  SELECT p.id, :s, 9 + (row_number() OVER (ORDER BY p.first_name))::int % 3, 800 + row_number() OVER (ORDER BY p.first_name)
  FROM public.players p WHERE p.last_name = 'Tftest';
SELECT max(ps.id) FILTER (WHERE p.first_name = 'Kit') AS kit, max(ps.id) FILTER (WHERE p.first_name = 'Lou') AS lou,
       max(ps.id) FILTER (WHERE p.first_name = 'Max') AS max, max(ps.id) FILTER (WHERE p.first_name = 'Ned') AS ned,
       max(ps.id) FILTER (WHERE p.first_name = 'Oz') AS oz
FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Tftest' \gset

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
-- Test lookups read tables the signed-in user can't, so they run as the owner.
CREATE FUNCTION pg_temp.sys(p_sql text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v text; BEGIN EXECUTE p_sql INTO v; RETURN v; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.sys(text) TO authenticated;

\set mgr '\'00000000-0000-4000-8000-0000000f0003\''
\set coach '\'00000000-0000-4000-8000-0000000f0004\''
\set asst '\'00000000-0000-4000-8000-0000000f0005\''
\set evl '\'00000000-0000-4000-8000-0000000f0006\''

-- ---------- teams ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000f0002');
SELECT public.admin_save_team(NULL, :majors, '') AS t1 \gset
SELECT public.admin_save_team(NULL, :majors, 'Giants') AS t2 \gset
SELECT pg_temp.check(pg_temp.sys(format('SELECT name FROM public.teams WHERE id = %s', :t1)) = 'Team 1', 'a registrar adds a team; a blank name becomes "Team 1"');
SELECT pg_temp.expect_error(format('SELECT public.admin_save_team(%s, %s, ''Giants'')', :t1, :majors), 'already a team called', 'two teams in a division can''t share a name');
SELECT public.admin_save_team(:t1, :majors, 'Dodgers');
SELECT pg_temp.check(pg_temp.sys(format('SELECT name FROM public.teams WHERE id = %s', :t1)) = 'Dodgers', 'renaming a team');
SELECT pg_temp.expect_error('INSERT INTO public.teams (season_id, season_division_id, name) VALUES (1, 1, ''x'')', 'permission denied', 'nobody writes the teams table directly');

SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000f0007');
SELECT pg_temp.expect_error(format('SELECT public.admin_save_team(NULL, %s, ''X'')', :majors), 'Only admins and registrars', 'a registrar of another season can''t add teams here');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000f0003');
SELECT pg_temp.expect_error(format('SELECT public.team_setup(%s)', :s), 'Only admins and registrars', 'a coach can''t open team setup');

-- ---------- staff ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000f0002');
SELECT public.admin_set_team_staff(:t1, :mgr, :coach, ARRAY[:asst]::uuid[]);
SELECT pg_temp.check(pg_temp.sys(format('SELECT string_agg(assignment_role, '','' ORDER BY assignment_role) FROM public.team_coach_assignments WHERE team_id = %s', :t1)) = 'assistant_coach,coach,manager',
  'a team gets a manager, a coach and an assistant');
SELECT pg_temp.check(NOT public.admin_set_team_staff(:t1, :mgr, :coach, ARRAY[:asst]::uuid[]), 'saving the same staff changes nothing');
SELECT pg_temp.expect_error(format('SELECT public.admin_set_team_staff(%s, %L, NULL, NULL)', :t2, :evl), 'needs the coach role', 'staff must be coaches this season');
SELECT pg_temp.expect_error(format('SELECT public.admin_set_team_staff(%s, %L, %L, NULL)', :t2, :mgr, :mgr), 'only one job', 'one person, one job on a team');
SELECT pg_temp.expect_error(format('SELECT public.admin_set_team_staff(%s, %L, NULL, NULL)', :t2, :coach), 'already on another team in this division',
  'a person can be on only one team per division');
SELECT public.admin_save_team(NULL, :aaa, 'Rays') AS t3 \gset
SELECT pg_temp.check(public.admin_set_team_staff(:t3, :coach, NULL, NULL), 'the same person can manage a team in another division');

-- ---------- teams CSV ----------
SELECT pg_temp.check((SELECT string_agg(r->>'status', ',' ORDER BY (r->>'line')::int) FROM jsonb_array_elements(public.admin_import_teams(:s, jsonb_build_array(
    jsonb_build_object('line', 2, 'division', 'majors', 'team', 'Cubs', 'manager', 'tf-asst@example.test'),
    jsonb_build_object('line', 3, 'division', 'Majors', 'team', 'Dodgers', 'coach', 'tf-coach@example.test'),
    jsonb_build_object('line', 4, 'division', 'Tee Ball', 'team', 'X'),
    jsonb_build_object('line', 5, 'division', 'AAA', 'team', 'Owls', 'manager', 'nobody@example.test'),
    jsonb_build_object('line', 6, 'division', 'AAA', 'team', 'Hawks', 'coach', 'tf-eval@example.test'),
    jsonb_build_object('line', 7, 'division', 'Majors', 'team', 'cubs')), false)) r)
  = 'error,same,error,error,error,error',
  'CSV preview: the assistant already on Dodgers can''t manage Cubs, unchanged team, unknown division, no account, not a coach, listed twice');
SELECT pg_temp.check(pg_temp.sys(format('SELECT count(*) FROM public.teams WHERE season_id = %s', :s)) = '3', 'the preview changed nothing');
SELECT pg_temp.check((SELECT string_agg(r->>'status', ',') FROM jsonb_array_elements(public.admin_import_teams(:s, jsonb_build_array(
    jsonb_build_object('line', 2, 'division', 'AAA', 'team', 'Owls', 'manager', 'tf-mgr@example.test', 'assistants', jsonb_build_array('tf-asst@example.test'))), true)) r) = 'new'
  AND pg_temp.sys('SELECT count(*) FROM public.team_coach_assignments a JOIN public.teams t ON t.id = a.team_id WHERE t.name = ''Owls''') = '2',
  'CSV apply creates a team with its staff (emails match without regard to case)');
SELECT pg_temp.check((SELECT r->>'status' FROM jsonb_array_elements(public.admin_import_teams(:s, jsonb_build_array(
    jsonb_build_object('line', 2, 'division', 'AAA', 'team', 'owls', 'manager', 'tf-mgr@example.test')), true)) r) = 'same',
  'uploading the same file again changes nothing');

-- ---------- delete ----------
SELECT public.admin_delete_team(:t2);
SELECT pg_temp.check(pg_temp.sys(format('SELECT count(*) FROM public.teams WHERE id = %s', :t2)) = '0', 'an empty team can be deleted');
RESET ROLE;
UPDATE public.player_seasons SET team_id = :t3, season_division_id = :aaa WHERE id = :oz;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.admin_delete_team(%s)', :t3), 'has players', 'a team with players can''t be deleted');
RESET ROLE;
UPDATE public.player_seasons SET team_id = NULL, season_division_id = NULL WHERE id = :oz;
SELECT pg_temp.check((SELECT count(*) FROM public.audit_log WHERE action IN ('team_created', 'team_renamed', 'team_staff_set', 'team_imported', 'team_deleted')
  AND target_id IN (SELECT id::text FROM public.teams WHERE season_id = :s UNION SELECT :'t2')) >= 7, 'team changes are audited');
SET LOCAL ROLE authenticated;

-- ---------- coach's kids ----------
SELECT public.admin_link_coach_kid(:kit, :mgr);
SELECT public.admin_link_coach_kid(:lou, :mgr);
RESET ROLE;
SELECT pg_temp.check((SELECT bool_and(is_coach_kid) FROM public.player_seasons WHERE id IN (:kit, :lou)), 'linking twins to a parent marks both as coach''s kids');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.admin_link_coach_kid(%s, %L)', :max, :evl), 'must be a coach', 'the parent must be a coach this season');
SELECT pg_temp.check((SELECT jsonb_array_length(t->'kids') FROM jsonb_array_elements(public.team_setup(:s)->'divisions') d, jsonb_array_elements(d->'teams') t
  WHERE t->>'name' = 'Dodgers') = 2, 'the team shows its manager''s two kids');
SELECT pg_temp.check((SELECT bool_and(c->>'email' IS NULL) FROM jsonb_array_elements(public.team_setup(:s)->'coaches') c), 'registrars see coach names, not emails');
SELECT public.admin_unlink_coach_kid(:lou, :mgr);
RESET ROLE;
SELECT pg_temp.check((SELECT is_coach_kid FROM public.player_seasons WHERE id = :lou) AND NOT EXISTS (SELECT 1 FROM public.coach_kid_links WHERE player_season_id = :lou),
  'unlinking keeps the "Coach''s kid" label');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT count(*) FROM public.coach_kid_links', 'permission denied', 'nobody reads the link table directly');

-- ---------- siblings ----------
SELECT public.admin_group_siblings(ARRAY[:kit, :lou]) AS g1 \gset
SELECT public.admin_group_siblings(ARRAY[:max, :ned]) AS g2 \gset
SELECT public.admin_group_siblings(ARRAY[:lou, :ned]);
RESET ROLE;
SELECT pg_temp.check((SELECT count(DISTINCT group_id) FROM public.sibling_group_members WHERE player_season_id IN (:kit, :lou, :max, :ned)) = 1
  AND (SELECT count(*) FROM public.sibling_groups WHERE season_id = :s) = 1, 'grouping across two groups joins them into one');
SET LOCAL ROLE authenticated;
SELECT public.admin_remove_sibling(:kit); SELECT public.admin_remove_sibling(:lou); SELECT public.admin_remove_sibling(:max);
RESET ROLE;
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.sibling_groups WHERE season_id = :s), 'a group left with one player goes away');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.admin_group_siblings(ARRAY[%s])', :kit), 'at least two', 'a group needs two players');

-- ---------- suggestions from account fingerprints ----------
RESET ROLE;
INSERT INTO public.import_batches (import_type, source_file_name, season_id, created_by)
  VALUES ('players', 'tf.csv', :s, '00000000-0000-4000-8000-0000000f0001') RETURNING id AS b \gset
INSERT INTO public.sports_connect_import_rows (import_batch_id, source_row_number, first_name, last_name, review_state, committed_player_season_id)
SELECT :b, 1 + row_number() OVER (ORDER BY ps.id), p.first_name, p.last_name, 'committed', ps.id
FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Tftest';
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(public.set_import_account_keys(:b, jsonb_build_array(
  jsonb_build_object('line', 2, 'key', encode(sha256(convert_to('family.one@example.test', 'UTF8')), 'hex')),
  jsonb_build_object('line', 3, 'key', encode(sha256(convert_to('family.one@example.test', 'UTF8')), 'hex')),
  jsonb_build_object('line', 4, 'key', encode(sha256(convert_to('tf-coach@example.test', 'UTF8')), 'hex')),
  jsonb_build_object('line', 5, 'key', 'not-a-hash'))) = 3, 'fingerprints are stored for staged rows (bad values ignored)');
SELECT pg_temp.expect_error('SELECT account_key FROM public.sports_connect_import_rows', 'permission denied', 'fingerprints can''t be read directly');
SELECT pg_temp.check((SELECT string_agg(s->>'kind', ',' ORDER BY s->>'kind') FROM jsonb_array_elements(public.family_overview(:s)->'suggestions') s) = 'coach_kid,siblings',
  'suggested: Kit and Lou (same account) as siblings, Max as Cole Coach''s kid (his sign-in email)');
SELECT (SELECT s->>'key' FROM jsonb_array_elements(public.family_overview(:s)->'suggestions') s WHERE s->>'kind' = 'coach_kid') AS kidkey \gset
SELECT public.admin_group_siblings(ARRAY[:kit, :lou]);
SELECT public.admin_dismiss_family_suggestion(:s, 'coach_kid', :'kidkey');
SELECT pg_temp.check(jsonb_array_length(public.family_overview(:s)->'suggestions') = 0, 'grouping or dismissing clears a suggestion');
SELECT pg_temp.check(jsonb_array_length(public.family_overview(:s)->'coach_kids') = 2 AND jsonb_array_length(public.family_overview(:s)->'sibling_groups') = 1,
  'the page lists coach''s kids (linked or labelled) and sibling groups');
RESET ROLE;

ROLLBACK;
