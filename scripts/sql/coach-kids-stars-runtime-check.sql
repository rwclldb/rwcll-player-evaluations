-- Runtime check: coach's-kid flag (admin, import, visibility) and private stars. Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000c4a01', 'ck-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c4c01', 'ck-coach@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c4c02', 'ck-coach2@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c4e01', 'ck-eval@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Coach kid check season', '2096-01-01', '2096-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT (SELECT id FROM public.seasons WHERE name = 'Coach kid check season') AS season_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000c4a01', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000c4c01', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000c4c02', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000c4e01', 'independent_evaluator', (SELECT season_id FROM ctx));
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES ((SELECT season_id FROM ctx), 9, 'open');
ALTER TABLE ctx ADD COLUMN session_id bigint;
UPDATE ctx SET session_id = (SELECT id FROM public.evaluation_sessions WHERE season_id = ctx.season_id);
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT session_id, '00000000-0000-4000-8000-0000000c4c01'::uuid, 'coach' FROM ctx;

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

-- ---------- import: a "Coaches Kid" column flows through staging and commit ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c4a01');
SELECT public.stage_sports_connect_import((SELECT season_id FROM ctx), 'ck.csv',
  '[{"line": 2, "playerId": "CK1", "firstName": "Kid", "lastName": "Cktest", "birthDate": "2017-03-01", "program": "Baseball", "division": "AA", "paymentStatus": "Paid", "leagueAge": 9, "coachKid": true, "issues": []},
    {"line": 3, "playerId": "CK2", "firstName": "Other", "lastName": "Cktest", "birthDate": "2017-03-02", "program": "Baseball", "division": "AA", "paymentStatus": "Paid", "leagueAge": 9, "coachKid": false, "issues": []},
    {"line": 4, "playerId": "CK3", "firstName": "Plain", "lastName": "Cktest", "birthDate": "2017-03-03", "program": "Baseball", "division": "AA", "paymentStatus": "Paid", "leagueAge": 9, "issues": []}]'::jsonb) AS batch \gset
RESET ROLE;
SELECT pg_temp.check((SELECT array_agg(coach_kid::text ORDER BY source_row_number) FROM public.sports_connect_import_rows WHERE import_batch_id = :batch)
  = ARRAY['true', 'false', NULL], 'staging keeps the Coaches Kid value (true, false, or blank)');
UPDATE public.sports_connect_import_rows SET review_state = 'approved_new' WHERE import_batch_id = :batch;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c4a01');
SELECT public.commit_sports_connect_import_row(id, 'Coach kid check') FROM public.sports_connect_import_rows WHERE import_batch_id = :batch;
RESET ROLE;
CREATE FUNCTION pg_temp.reg(p_first text) RETURNS bigint LANGUAGE sql AS $$
  SELECT ps.id FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id
  WHERE p.last_name = 'Cktest' AND p.first_name = p_first AND ps.season_id = (SELECT season_id FROM ctx);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.reg(text) TO authenticated;
SELECT pg_temp.check((SELECT is_coach_kid FROM public.player_seasons WHERE id = pg_temp.reg('Kid'))
  AND NOT (SELECT is_coach_kid FROM public.player_seasons WHERE id = pg_temp.reg('Other'))
  AND NOT (SELECT is_coach_kid FROM public.player_seasons WHERE id = pg_temp.reg('Plain')),
  'committing sets the flag from the file (blank means no)');

-- ---------- admin sets the flag; coaches can't ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c4c01');
SELECT pg_temp.expect_error(format('SELECT public.admin_set_coach_kid(%s, true)', pg_temp.reg('Plain')), 'Administrator access required', 'a coach cannot set the flag');
SELECT pg_temp.check((SELECT is_coach_kid FROM public.player_seasons WHERE id = pg_temp.reg('Kid')), 'a coach scoring the age group can see the flag');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c4a01');
SELECT public.admin_set_coach_kid(pg_temp.reg('Plain'), true);
SELECT public.admin_set_coach_kid(pg_temp.reg('Kid'), false);
RESET ROLE;
SELECT pg_temp.check((SELECT is_coach_kid FROM public.player_seasons WHERE id = pg_temp.reg('Plain'))
  AND NOT (SELECT is_coach_kid FROM public.player_seasons WHERE id = pg_temp.reg('Kid')), 'admin turns the flag on and off');
SELECT pg_temp.check((SELECT count(*) FROM public.audit_log WHERE action = 'coach_kid_set'
                      AND target_id IN (pg_temp.reg('Plain')::text, pg_temp.reg('Kid')::text)) = 2, 'each change is audited');

-- ---------- stars ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c4c01');
SELECT pg_temp.check(public.toggle_player_star(pg_temp.reg('Kid')) = true, 'a coach stars a player');
SELECT pg_temp.check((SELECT count(*) FROM public.player_stars) = 1, 'the coach sees their own star');
SELECT pg_temp.check(public.toggle_player_star(pg_temp.reg('Other')) = true AND public.toggle_player_star(pg_temp.reg('Other')) = false,
  'starring again removes the star');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c4c02');
SELECT pg_temp.check((SELECT count(*) FROM public.player_stars) = 0, 'another coach cannot see those stars');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c4a01');
SELECT pg_temp.check((SELECT count(*) FROM public.player_stars) = 0, 'an admin cannot see other people''s stars');
RESET ROLE;
SELECT pg_temp.reg('Kid') AS kid_id \gset
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c4e01');
SELECT pg_temp.expect_error(format('SELECT public.toggle_player_star(%s)', :kid_id), 'age groups you can see',
  'an evaluator cannot star in an unassigned, unreleased age group');
RESET ROLE;
UPDATE public.evaluation_sessions SET status = 'locked', published_at = now(), published_by = '00000000-0000-4000-8000-0000000c4a01'
  WHERE id = (SELECT session_id FROM ctx);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c4e01');
SELECT pg_temp.check(public.toggle_player_star(:kid_id) = true, 'an evaluator can star once the age group is released');
RESET ROLE;

ROLLBACK;
