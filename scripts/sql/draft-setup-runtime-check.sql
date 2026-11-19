-- Runtime check: draft setup (pools, overrides, settings copied forward, the order, roster sizes, kid rounds).
-- Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000d0001', 'ds-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000d0002', 'ds-registrar@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000d0003', 'ds-mgr@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000d0004', 'ds-coach@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000d0005', 'ds-coach2@example.test', 'authenticated', 'authenticated');
INSERT INTO public.user_profiles (user_id, display_name) VALUES
  ('00000000-0000-4000-8000-0000000d0003', 'Mo Manager'), ('00000000-0000-4000-8000-0000000d0004', 'Cy Coach');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Draft 2085', '2085-01-01', '2085-06-30') RETURNING id AS old \gset
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Draft 2086', '2086-01-01', '2086-06-30') RETURNING id AS s \gset
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000d0001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000d0002', 'registrar', :s),
  ('00000000-0000-4000-8000-0000000d0003', 'coach', :s),
  ('00000000-0000-4000-8000-0000000d0004', 'coach', :s),
  ('00000000-0000-4000-8000-0000000d0005', 'coach', :s);
UPDATE public.season_divisions sd SET min_age = x.lo, max_age = x.hi
FROM public.divisions d, (VALUES ('AA', 7, 9), ('AAA', 8, 11), ('Majors', 10, 12), ('Juniors', 13, 14), ('Seniors', 15, 16)) x(n, lo, hi)
WHERE d.id = sd.division_id AND d.name = x.n AND sd.season_id IN (:old, :s);
SELECT max(sd.id) FILTER (WHERE d.name = 'Majors' AND sd.season_id = :s) AS majors, max(sd.id) FILTER (WHERE d.name = 'AAA' AND sd.season_id = :s) AS aaa,
       max(sd.id) FILTER (WHERE d.name = 'Majors' AND sd.season_id = :old) AS oldmajors
FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id \gset

-- Players: name tells age and request. Rows in the Sports Connect staging table give the requested division.
INSERT INTO public.players (first_name, last_name) VALUES
  ('Twelve', 'Dstest'), ('ElevenMaj', 'Dstest'), ('ElevenAaa', 'Dstest'), ('TenMaj', 'Dstest'), ('TenNone', 'Dstest'),
  ('TenKid', 'Dstest'), ('TenSoft', 'Dstest'), ('Placed', 'Dstest'), ('Nine', 'Dstest');
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number)
SELECT p.id, :s, CASE WHEN p.first_name = 'Twelve' OR p.first_name = 'Placed' THEN 12 WHEN p.first_name LIKE 'Eleven%' THEN 11
                      WHEN p.first_name = 'Nine' THEN 9 ELSE 10 END, 700 + row_number() OVER (ORDER BY p.first_name)
FROM public.players p WHERE p.last_name = 'Dstest';
SELECT max(ps.id) FILTER (WHERE p.first_name = 'Twelve') AS twelve, max(ps.id) FILTER (WHERE p.first_name = 'ElevenMaj') AS elevenmaj,
       max(ps.id) FILTER (WHERE p.first_name = 'ElevenAaa') AS elevenaaa, max(ps.id) FILTER (WHERE p.first_name = 'TenMaj') AS tenmaj,
       max(ps.id) FILTER (WHERE p.first_name = 'TenNone') AS tennone, max(ps.id) FILTER (WHERE p.first_name = 'TenKid') AS tenkid,
       max(ps.id) FILTER (WHERE p.first_name = 'TenSoft') AS tensoft, max(ps.id) FILTER (WHERE p.first_name = 'Placed') AS placed,
       max(ps.id) FILTER (WHERE p.first_name = 'Nine') AS nine
FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Dstest' \gset
INSERT INTO public.import_batches (import_type, source_file_name, season_id, created_by)
  VALUES ('players', 'ds.csv', :s, '00000000-0000-4000-8000-0000000d0001') RETURNING id AS b \gset
INSERT INTO public.sports_connect_import_rows (import_batch_id, source_row_number, first_name, last_name, source_division, review_state, committed_player_season_id)
VALUES (:b, 2, 'Twelve', 'Dstest', 'AAA', 'committed', :twelve), (:b, 3, 'ElevenMaj', 'Dstest', 'Majors', 'committed', :elevenmaj),
       (:b, 4, 'ElevenAaa', 'Dstest', 'AAA', 'committed', :elevenaaa), (:b, 5, 'TenMaj', 'Dstest', 'majors', 'committed', :tenmaj),
       (:b, 6, 'TenKid', 'Dstest', 'AAA', 'committed', :tenkid), (:b, 7, 'TenSoft', 'Dstest', 'Softball Majors', 'committed', :tensoft),
       (:b, 8, 'Nine', 'Dstest', 'AAA', 'committed', :nine);

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
-- The pool as "name:reason" (owner view), for compact checks.
CREATE FUNCTION pg_temp.pool(p_sd bigint) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT string_agg(pl.first_name || ':' || p.reason || CASE WHEN p.must_draft THEN '!' ELSE '' END, ',' ORDER BY pl.first_name)
  FROM private.division_pool(p_sd) p JOIN public.player_seasons ps ON ps.id = p.player_season_id JOIN public.players pl ON pl.id = ps.player_id;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.pool(bigint) TO authenticated;
CREATE FUNCTION pg_temp.sys(p_sql text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v text; BEGIN EXECUTE p_sql INTO v; RETURN v; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.sys(text) TO authenticated;

-- A team in Majors whose manager has a kid (TenKid, age 10, asked for AAA). Placed is already on a team.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
SELECT public.admin_save_team(NULL, :majors, 'Giants') AS t1 \gset
SELECT public.admin_save_team(NULL, :majors, 'Cubs') AS t2 \gset
SELECT public.admin_save_team(NULL, :majors, 'Mets') AS t3 \gset
SELECT public.admin_set_team_staff(:t1, '00000000-0000-4000-8000-0000000d0003', '00000000-0000-4000-8000-0000000d0004', NULL);
SELECT public.admin_link_coach_kid(:tenkid, '00000000-0000-4000-8000-0000000d0003');
RESET ROLE;
UPDATE public.player_seasons SET team_id = :t1, season_division_id = :majors WHERE id = :placed;
SET LOCAL ROLE authenticated;

-- ---------- the pool ----------
SELECT pg_temp.check(pg_temp.pool(:majors) = 'ElevenMaj:requested,TenKid:coach_kid!,TenMaj:requested,Twelve:must_draft_age!',
  'Majors pool: every 12 (must draft), 10-11s who asked for Majors, the manager''s kid (must draft); not "Softball Majors", not players already on a team');
SELECT pg_temp.check(pg_temp.pool(:aaa) = 'ElevenAaa:must_draft_age!,ElevenMaj:must_draft_age!,Nine:requested,TenKid:requested',
  'AAA pool: every 11 (must draft) and younger players who asked for AAA (the Majors manager''s kid too, until Majors takes him)');

-- ---------- creating a draft ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000d0005');
SELECT pg_temp.expect_error(format('SELECT public.admin_create_draft(%s)', :majors), 'Only admins and registrars', 'a coach can''t set up a draft');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000d0002');
SELECT public.admin_create_draft(:majors) AS d \gset
SELECT pg_temp.check(pg_temp.sys(format('SELECT must_draft_ages::text || roster_size || order_type || coach_kid_rule FROM public.drafts WHERE id = %s', :d))
  = '{12}12snakefixed_rounds', 'a new draft: must-draft age is the top age, roster 12, snake, coach''s kids in fixed rounds');
SELECT pg_temp.expect_error(format('SELECT public.admin_create_draft(%s)', :majors), 'already has a draft', 'one draft per division');

-- ---------- settings ----------
SELECT pg_temp.expect_error(format('SELECT public.admin_save_draft_settings(%s, ''{"must_draft_ages":[9]}'')', :d), 'within the division', 'must-draft ages stay within the division''s ages');
SELECT pg_temp.check(public.admin_save_draft_settings(:d, '{"pool_by_age_only": true, "roster_size": 11, "age_order": "oldest_first", "coach_kid_rule": "round_per_kid", "pick_timer_seconds": 120}'),
  'settings are saved');
SELECT pg_temp.check(NOT public.admin_save_draft_settings(:d, '{"roster_size": 11}'), 'saving the same settings changes nothing');
SELECT pg_temp.check(pg_temp.pool(:majors) = 'ElevenAaa:by_age,ElevenMaj:by_age,TenKid:coach_kid!,TenMaj:by_age,TenNone:by_age,TenSoft:by_age,Twelve:must_draft_age!',
  '"Pool by age only" brings in everyone in the age range');
SELECT public.admin_save_draft_settings(:d, '{"pool_by_age_only": false}');

-- ---------- overrides ----------
SELECT pg_temp.expect_error(format('SELECT public.admin_set_pool_override(%s, %s, ''in'', '''')', :majors, :nine), 'short note', 'an override needs a note');
SELECT public.admin_set_pool_override(:majors, :nine, 'in', 'Plays up, board approved');
SELECT public.admin_set_pool_override(:majors, :twelve, 'out', 'Medical: sitting out the season');
SELECT pg_temp.check(pg_temp.pool(:majors) = 'ElevenMaj:requested,Nine:override_in,TenKid:coach_kid!,TenMaj:requested',
  'an admin can put a 9-year-old in and take a 12 out');
SELECT pg_temp.check(pg_temp.pool(:aaa) = 'ElevenAaa:must_draft_age!,ElevenMaj:must_draft_age!,TenKid:requested', 'a player put into Majors leaves AAA');
SELECT public.admin_move_pool(:elevenaaa, :aaa, :majors, 'Parents asked; board approved');
SELECT pg_temp.check(pg_temp.pool(:majors) LIKE '%ElevenAaa:override_in%' AND pg_temp.pool(:aaa) = 'ElevenMaj:must_draft_age!,TenKid:requested', 'moving a player from AAA to the Majors pool');
SELECT public.admin_set_pool_override(:majors, :twelve, NULL, 'Cleared: playing after all');
SELECT pg_temp.check(pg_temp.pool(:majors) LIKE '%Twelve:must_draft_age!%', 'clearing an override puts the rule back');
SELECT pg_temp.expect_error(format('SELECT public.admin_set_pool_override(%s, %s, ''in'', ''note'')', :majors, :placed), 'already on a team', 'a player on a team can''t be put in a pool');
SELECT pg_temp.check(pg_temp.sys(format('SELECT count(*) FROM public.audit_log WHERE action = ''draft_pool_override_set'' AND target_id IN (''%s'',''%s'',''%s'')', :nine, :twelve, :elevenaaa)) = '5',
  'every override is audited with its note');

-- ---------- order, roster sizes, kid rounds ----------
SELECT pg_temp.check(jsonb_array_length(public.admin_draw_draft_order(:d)) = 3
  AND pg_temp.sys(format('SELECT string_agg(position::text, '','' ORDER BY position) FROM public.draft_teams WHERE draft_id = %s', :d)) = '1,2,3',
  'a random draw puts every team in the first-round order');
SELECT pg_temp.expect_error(format('SELECT public.admin_set_draft_order(%s, ARRAY[%s, %s])', :d, :t1, :t2), 'every team', 'a hand-set order must list every team once');
SELECT public.admin_set_draft_order(:d, ARRAY[:t3, :t1, :t2]);
SELECT pg_temp.check(pg_temp.sys(format('SELECT string_agg(team_id::text, '','' ORDER BY position) || min(order_source) FROM public.draft_teams JOIN public.drafts ON drafts.id = draft_id WHERE draft_id = %s', :d))
  = format('%s,%s,%smanual', :t3, :t1, :t2), 'the order can be set by hand');
SELECT pg_temp.check(pg_temp.sys(format('SELECT count(*) FROM public.audit_log WHERE target_table = ''drafts'' AND target_id = ''%s'' AND action IN (''draft_order_drawn'', ''draft_order_set'')', :d)) = '2',
  'the draw and the hand-set order are audited');
SELECT public.admin_set_draft_roster_size(:d, :t2, 13);
SELECT pg_temp.check(pg_temp.sys(format('SELECT roster_size FROM public.draft_teams WHERE draft_id = %s AND team_id = %s', :d, :t2)) = '13', 'one team can have a bigger roster');
SELECT pg_temp.expect_error(format('SELECT public.admin_set_kid_round(%s, %s, 2)', :d, :tenmaj), 'isn''t the kid', 'only coach''s kids of this division get a round');
SELECT public.admin_set_kid_round(:d, :tenkid, 3);
SELECT pg_temp.check((SELECT (k->>'round')::int = 3 AND (k->>'suggested_round') IS NOT NULL AND k->>'team' = 'Giants'
  FROM jsonb_array_elements(public.draft_setup(:majors)->'kids') k), 'the setup page shows the kid''s team, round and a suggested round');
SELECT pg_temp.check((SELECT p->'also_in' = '["AAA"]'::jsonb FROM jsonb_array_elements(public.draft_setup(:majors)->'pool') p
  WHERE (p->>'player_season_id')::bigint = :elevenmaj), 'the setup page says an 11 in the Majors pool is also in the AAA pool');
SELECT pg_temp.check((SELECT (d->>'pool')::int = 6 AND (d->>'must_draft')::int = 2 AND (d->'draft'->>'order_set')::boolean
  FROM jsonb_array_elements(public.drafts_overview(:s)) d WHERE d->>'name' = 'Majors'), 'the drafts overview counts the pool and sees the order');

-- ---------- after the draft starts; players left over ----------
RESET ROLE;
UPDATE public.drafts SET status = 'done' WHERE id = :d;
INSERT INTO public.draft_leftovers (draft_id, player_season_id) VALUES (:d, :tenmaj);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.admin_save_draft_settings(%s, ''{"roster_size": 10}'')', :d), 'has started', 'settings are frozen once a draft starts');
SELECT pg_temp.check(pg_temp.pool(:aaa) LIKE '%TenMaj:from_above%', 'a 10-year-old left over from Majors joins the AAA pool');

-- ---------- copied forward ----------
RESET ROLE;
INSERT INTO public.drafts (season_id, season_division_id, must_draft_ages, roster_size, age_order, coach_kid_rule, coach_kid_rounds)
  VALUES (:old, :oldmajors, '{12}', 10, 'oldest_first', 'by_round', '{1}');
DELETE FROM public.drafts WHERE id = :d;
SET LOCAL ROLE authenticated;
SELECT public.admin_create_draft(:majors) AS d2 \gset
SELECT pg_temp.check(pg_temp.sys(format('SELECT roster_size || age_order || coach_kid_rule || (copied_from_draft_id IS NOT NULL)::text FROM public.drafts WHERE id = %s', :d2))
  = '10oldest_firstby_roundtrue', 'a new draft copies last season''s settings for the division');
SELECT pg_temp.check(public.draft_setup(:majors)->'draft'->>'copied_from' = 'Draft 2085', 'the setup page says where the settings came from');
SELECT public.admin_delete_draft(:d2);
SELECT pg_temp.check(pg_temp.sys(format('SELECT count(*) FROM public.drafts WHERE season_id = %s', :s)) = '0', 'a draft still in setup can be removed');
SELECT pg_temp.expect_error('SELECT count(*) FROM public.drafts', 'permission denied', 'nobody reads the drafts table directly');
RESET ROLE;

ROLLBACK;
