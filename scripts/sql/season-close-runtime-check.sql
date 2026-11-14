-- Runtime check: closing and reopening a season. Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000c1001', 'sc-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000c1002', 'sc-coach@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Close Check 2085', '2085-01-01', '2085-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT (SELECT id FROM public.seasons WHERE name = 'Close Check 2085') AS season_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000c1001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000c1002', 'coach', (SELECT season_id FROM ctx));
INSERT INTO public.evaluation_sessions (season_id, league_age, status) SELECT season_id, 9, 'setup' FROM ctx;
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT id, '00000000-0000-4000-8000-0000000c1002'::uuid, 'coach' FROM public.evaluation_sessions WHERE season_id = (SELECT season_id FROM ctx);
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location)
  SELECT id, 'primary', '2085-01-20', '09:00', '10:00', 'Field 1' FROM public.evaluation_sessions WHERE season_id = (SELECT season_id FROM ctx);
UPDATE public.evaluation_sessions SET status = 'open' WHERE season_id = (SELECT season_id FROM ctx);
INSERT INTO public.players (first_name, last_name) VALUES ('Gil', 'Sctest');
INSERT INTO public.player_seasons (player_id, season_id, league_age)
  SELECT p.id, (SELECT season_id FROM ctx), 9 FROM public.players p WHERE p.last_name = 'Sctest';
SELECT ps.id AS gil FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Sctest' \gset

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
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c1002');
SELECT pg_temp.expect_error(format('SELECT public.admin_close_season(%s, %L, %L)', (SELECT season_id FROM ctx), 'End of the season', 'Close Check 2085'),
  'Administrator access required', 'a coach cannot close a season');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c1001');
SELECT pg_temp.expect_error(format('UPDATE public.seasons SET is_closed = true WHERE id = %s', (SELECT season_id FROM ctx)),
  'Season page', 'an admin cannot flip the closed flag directly (it would skip the audit)');
SELECT pg_temp.expect_error(format('SELECT public.admin_close_season(%s, %L, %L)', (SELECT season_id FROM ctx), 'End of the season', 'Wrong name'),
  'Type the season', 'the season name must be typed to confirm');
SELECT pg_temp.expect_error(format('SELECT public.admin_close_season(%s, %L, %L)', (SELECT season_id FROM ctx), 'done', 'close check 2085'),
  'at least 10 characters', 'a reason is required');
SELECT pg_temp.check((public.admin_season_close_check((SELECT season_id FROM ctx)) -> 'open_age_groups') = '[9]'::jsonb, 'the checklist lists open age groups');
SELECT pg_temp.expect_error(format('SELECT public.admin_close_season(%s, %L, %L)', (SELECT season_id FROM ctx), 'End of the season', 'close check 2085'),
  'still open for age 9', 'an open age group blocks closing');
RESET ROLE;
UPDATE public.evaluation_sessions SET status = 'locked' WHERE season_id = (SELECT season_id FROM ctx);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c1001');
SELECT pg_temp.check((public.admin_season_close_check((SELECT season_id FROM ctx)) -> 'unreleased_age_groups') = '[9]'::jsonb
  AND (public.admin_season_close_check((SELECT season_id FROM ctx)) ->> 'players_without_bib')::int = 1, 'it warns about unreleased reports and missing bibs');
SELECT public.admin_close_season((SELECT season_id FROM ctx), 'End of the 2085 season', ' close check 2085 ');
RESET ROLE;
SELECT pg_temp.check((SELECT is_closed AND closed_at IS NOT NULL AND closed_by = '00000000-0000-4000-8000-0000000c1001' FROM public.seasons WHERE id = (SELECT season_id FROM ctx)),
  'closing records when and by whom');
SELECT pg_temp.check((SELECT after_data -> 'checklist' -> 'unreleased_age_groups' = '[9]'::jsonb FROM public.audit_log WHERE action = 'season_closed' AND target_id = (SELECT season_id FROM ctx)::text),
  'the audit entry keeps the checklist at that moment');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c1001');
SELECT pg_temp.expect_error(format('SELECT public.set_registration_bib(%s, 77)', :gil), 'closed', 'a closed season refuses changes (a bib)');
SELECT pg_temp.expect_error(format('SELECT public.admin_close_season(%s, %L, %L)', (SELECT season_id FROM ctx), 'End of the season', 'Close Check 2085'),
  'already closed', 'closing twice is refused');

SELECT pg_temp.expect_error(format('SELECT public.admin_reopen_season(%s, %L, %L)', (SELECT season_id FROM ctx), 'oops', 'Close Check 2085'),
  'at least 10 characters', 'reopening needs a reason');
SELECT public.admin_reopen_season((SELECT season_id FROM ctx), 'Need to fix a bib after the draft', 'Close Check 2085');
SELECT public.set_registration_bib(:gil, 77);
RESET ROLE;
SELECT pg_temp.check((SELECT NOT is_closed AND closed_at IS NULL FROM public.seasons WHERE id = (SELECT season_id FROM ctx))
  AND (SELECT evaluation_number FROM public.player_seasons WHERE id = :gil) = 77, 'reopening allows changes again');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c1001');
SELECT pg_temp.check((SELECT array_agg(action) FROM public.admin_season_status_history((SELECT season_id FROM ctx)))
  = ARRAY['season_reopened', 'season_closed'], 'the history lists the reopen, then the close');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000c1002');
SELECT pg_temp.check((SELECT count(*) FROM public.admin_season_status_history((SELECT season_id FROM ctx))) = 0
  AND public.admin_season_close_check((SELECT season_id FROM ctx)) IS NULL, 'a coach sees neither the history nor the checklist');
RESET ROLE;

ROLLBACK;
