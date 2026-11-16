-- Runtime check: admin_season_backup (the season backup download). Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000b4001', 'bk-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b4002', 'bk-coach@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b4003', 'bk-registrar@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b4004', 'bk-eval@example.test', 'authenticated', 'authenticated');
INSERT INTO public.user_profiles (user_id, display_name) VALUES ('00000000-0000-4000-8000-0000000b4002', 'Backup Coach');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Backup Check 2086', '2086-01-01', '2086-06-30'), ('Other Check 2086', '2086-01-01', '2086-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT
  (SELECT id FROM public.seasons WHERE name = 'Backup Check 2086') AS season_id,
  (SELECT id FROM public.seasons WHERE name = 'Other Check 2086') AS other_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000b4001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000b4002', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000b4003', 'registrar', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000b4004', 'independent_evaluator', (SELECT other_id FROM ctx));
INSERT INTO public.evaluation_sessions (season_id, league_age, status) SELECT season_id, 9, 'setup' FROM ctx;
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT id, '00000000-0000-4000-8000-0000000b4002'::uuid, 'coach' FROM public.evaluation_sessions WHERE season_id = (SELECT season_id FROM ctx);
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location)
  SELECT id, 'primary', '2086-01-20', '09:00', '10:00', 'Field 1' FROM public.evaluation_sessions WHERE season_id = (SELECT season_id FROM ctx);
UPDATE public.evaluation_sessions SET status = 'open' WHERE season_id = (SELECT season_id FROM ctx);
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Bea', 'Bktest', '2077-03-04'), ('Otto', 'Bkother', '2077-05-06');
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number)
  SELECT p.id, (SELECT season_id FROM ctx), 9, 777 FROM public.players p WHERE p.last_name = 'Bktest';
INSERT INTO public.player_seasons (player_id, season_id, league_age)
  SELECT p.id, (SELECT other_id FROM ctx), 9 FROM public.players p WHERE p.last_name = 'Bkother';
SELECT ps.id AS bea FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Bktest' \gset

-- One coach evaluation with a rating, a shared note, a check-in, a call, an exemption; a private note and a star.
INSERT INTO public.evaluations (evaluation_session_id, season_division_id, player_season_id, evaluator_user_id, evaluator_type, status, submitted_at)
  SELECT es.id, ps.season_division_id, ps.id, '00000000-0000-4000-8000-0000000b4002', 'coach', 'draft', NULL
  FROM public.evaluation_sessions es, public.player_seasons ps WHERE es.season_id = (SELECT season_id FROM ctx) AND ps.id = :bea;
INSERT INTO public.ratings (evaluation_id, rating_category_id, score)
  SELECT e.id, rc.id, 4 FROM public.evaluations e, public.rating_categories rc WHERE e.player_season_id = :bea AND rc.code = 'hitting';
UPDATE public.evaluations SET status = 'submitted', submitted_at = now() WHERE player_season_id = :bea;
INSERT INTO public.evaluator_notes (evaluation_id, author_user_id, note_text)
  SELECT e.id, e.evaluator_user_id, 'Shared note BKSHARED' FROM public.evaluations e WHERE e.player_season_id = :bea;
INSERT INTO public.private_notes (player_season_id, author_user_id, note_text) VALUES (:bea, '00000000-0000-4000-8000-0000000b4002', 'Secret BKPRIVATE');
INSERT INTO public.player_stars (user_id, player_season_id) VALUES ('00000000-0000-4000-8000-0000000b4002', :bea);
INSERT INTO public.player_checkins (player_season_id, event_id)
  SELECT :bea, ev.id FROM public.evaluation_session_events ev JOIN public.evaluation_sessions es ON es.id = ev.evaluation_session_id WHERE es.season_id = (SELECT season_id FROM ctx);
INSERT INTO public.player_calls (player_season_id, event_id)
  SELECT :bea, ev.id FROM public.evaluation_session_events ev JOIN public.evaluation_sessions es ON es.id = ev.evaluation_session_id WHERE es.season_id = (SELECT season_id FROM ctx);
INSERT INTO public.player_exemptions (player_season_id, scope, reason, recorded_by) VALUES (:bea, 'evaluation', 'Broken wrist', '00000000-0000-4000-8000-0000000b4001');

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

-- Only admins.
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b4002');
SELECT pg_temp.expect_error(format('SELECT public.admin_season_backup(%s)', (SELECT season_id FROM ctx)), 'Administrator access required', 'a coach cannot download a season backup');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b4003');
SELECT pg_temp.expect_error(format('SELECT public.admin_season_backup(%s)', (SELECT season_id FROM ctx)), 'Administrator access required', 'a registrar cannot download a season backup');

SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b4001');
SELECT pg_temp.expect_error('SELECT public.admin_season_backup(-1)', 'Season not found', 'an unknown season is refused');
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT public.admin_season_backup((SELECT season_id FROM ctx)) AS j;

SELECT pg_temp.check((SELECT jsonb_array_length(j->'tables'->'player_seasons') = 1 AND jsonb_array_length(j->'tables'->'players') = 1 FROM b),
  'only this season''s registration and player are included');
SELECT pg_temp.check((SELECT j->'tables'->'players'->0->>'last_name' = 'Bktest' AND (j->'tables'->'players'->0->>'has_birth_date')::boolean FROM b),
  'the player is included with has_birth_date');
SELECT pg_temp.check((SELECT NOT (j::text LIKE '%2077-03-04%') AND NOT (j::text LIKE '%date_of_birth%') FROM b),
  'no birthdate anywhere in the backup');
SELECT pg_temp.check((SELECT NOT (j::text LIKE '%BKPRIVATE%') AND NOT (j->'tables' ? 'private_notes') AND NOT (j->'tables' ? 'player_stars') FROM b),
  'coaches'' private notes and stars are left out');
SELECT pg_temp.check((SELECT jsonb_array_length(j->'tables'->'evaluations') = 1 AND jsonb_array_length(j->'tables'->'ratings') = 1
  AND j->'tables'->'evaluator_notes'->0->>'note_text' = 'Shared note BKSHARED' FROM b),
  'the evaluation, its rating and the shared evaluator note are included');
SELECT pg_temp.check((SELECT jsonb_array_length(j->'tables'->'player_checkins') = 1 AND jsonb_array_length(j->'tables'->'player_calls') = 1
  AND j->'tables'->'player_exemptions'->0->>'reason' = 'Broken wrist' FROM b),
  'check-ins, calls and exemptions are included');
SELECT pg_temp.check((SELECT jsonb_array_length(j->'tables'->'evaluation_sessions') = 1 AND jsonb_array_length(j->'tables'->'evaluation_session_events') = 1
  AND jsonb_array_length(j->'tables'->'evaluator_assignments') = 1 FROM b),
  'the age group, its event and assignment are included');
SELECT pg_temp.check((SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'tables'->'accounts') a WHERE a->>'email' = 'bk-coach@example.test' AND a->>'display_name' = 'Backup Coach')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(j->'tables'->'accounts') a WHERE a->>'email' = 'bk-registrar@example.test')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'tables'->'accounts') a WHERE a->>'email' = 'bk-eval@example.test') FROM b),
  'accounts with a role this season are included, other seasons'' are not');
SELECT pg_temp.check((SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'tables'->'user_roles') r WHERE r->>'season_id' = (SELECT other_id FROM ctx)::text) FROM b),
  'roles from another season are left out');

RESET ROLE;
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.audit_log WHERE action = 'season_backup_downloaded' AND target_id = (SELECT season_id FROM ctx)::text
  AND actor_user_id = '00000000-0000-4000-8000-0000000b4001' AND (after_data->'rows'->>'evaluations')::int = 1),
  'the download is audited with row counts');
SELECT pg_temp.check((SELECT count(*) = 0 FROM pg_class WHERE relname IN ('backup_registrations', 'backup_evaluations') AND relpersistence = 't'),
  'working tables are dropped after the call');

ROLLBACK;
