-- Runtime check: admin correction of individual scores (open, locked, released; not in a closed season). Rolled back.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000ca001', 'ac-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000cc001', 'ac-coach@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('AC check season', '2099-01-01', '2099-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT (SELECT id FROM public.seasons WHERE name = 'AC check season') AS season_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000ca001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000cc001', 'coach', (SELECT season_id FROM ctx));
INSERT INTO public.players (first_name, last_name) VALUES ('Ac', 'Alpha');
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number)
  SELECT id, (SELECT season_id FROM ctx), 10, 701 FROM public.players WHERE first_name = 'Ac';
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES ((SELECT season_id FROM ctx), 10, 'setup');
ALTER TABLE ctx ADD COLUMN session_id bigint, ADD COLUMN alpha bigint, ADD COLUMN eval_id bigint;
UPDATE ctx SET session_id = (SELECT id FROM public.evaluation_sessions WHERE season_id = ctx.season_id),
  alpha = (SELECT ps.id FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.first_name = 'Ac' AND ps.season_id = ctx.season_id);
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location)
  SELECT session_id, 'primary', '2099-01-23', '09:00', '10:30', 'Check Field' FROM ctx;
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT session_id, '00000000-0000-4000-8000-0000000cc001'::uuid, 'coach' FROM ctx;
UPDATE public.evaluation_sessions SET status = 'open' WHERE id = (SELECT session_id FROM ctx);

CREATE FUNCTION pg_temp.as_user(p_uuid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uuid, 'role', 'authenticated')::text, true);
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
CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF; RAISE NOTICE 'PASS: %', p_label; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text) TO authenticated;
-- The coach's scores as {code: score}, read with the owner's rights.
CREATE FUNCTION pg_temp.scores() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(jsonb_object_agg(rc.code, r.score), '{}'::jsonb) FROM public.ratings r
  JOIN public.rating_categories rc ON rc.id = r.rating_category_id WHERE r.evaluation_id = (SELECT eval_id FROM ctx);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.scores() TO authenticated;
CREATE FUNCTION pg_temp.coach_overall() RETURNS numeric LANGUAGE sql AS $$
  SELECT coach_overall FROM public.draft_report((SELECT session_id FROM ctx)) WHERE player_season_id = (SELECT alpha FROM ctx);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.coach_overall() TO authenticated;
CREATE FUNCTION pg_temp.correct(p_ratings text, p_status text, p_reason text) RETURNS boolean LANGUAGE sql AS $$
  SELECT public.admin_save_evaluation_correction((SELECT eval_id FROM ctx), p_ratings::jsonb, '{"pitched_before":"yes"}'::jsonb, p_status, p_reason);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.correct(text, text, text) TO authenticated;

-- The coach scores: hitting 2, throwing 3.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000cc001');
SELECT public.save_evaluation((SELECT session_id FROM ctx), (SELECT alpha FROM ctx), '{"hitting":2,"throwing":3}', '{"pitched_before":"yes"}', 'submitted');
RESET ROLE;
UPDATE ctx SET eval_id = (SELECT id FROM public.evaluations WHERE player_season_id = ctx.alpha);
CREATE TEMP TABLE first_submit ON COMMIT DROP AS SELECT submitted_at FROM public.evaluations WHERE id = (SELECT eval_id FROM ctx);
GRANT SELECT ON first_submit TO authenticated;
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_error($$SELECT pg_temp.correct('{"hitting":5}', 'submitted', 'Coach trying')$$, 'Administrator access required', 'a coach cannot use the admin correction');

SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ca001');
SELECT pg_temp.expect_error($$SELECT pg_temp.correct('{"hitting":5}', 'submitted', '')$$, 'Give a reason', 'a correction needs a reason');

-- Open session: hitting 2 -> 4, throwing cleared, grounders added.
SELECT pg_temp.check(pg_temp.correct('{"hitting":4,"throwing":null,"grounders":5}', 'submitted', 'Scorer tapped the wrong column'),
  'admin corrects an open session');
SELECT pg_temp.check(pg_temp.scores() = '{"hitting":4,"grounders":5}'::jsonb, 'scores are replaced: hitting 4, throwing cleared, grounders 5');
SELECT pg_temp.check(pg_temp.coach_overall() = 4.5, 'the draft report uses the corrected scores (4.50)');
SELECT pg_temp.check((SELECT before_data -> 'ratings' = '{"hitting":2,"throwing":3}'::jsonb AND after_data -> 'ratings' = '{"hitting":4,"grounders":5}'::jsonb
                        AND reason = 'Scorer tapped the wrong column' AND actor_user_id = '00000000-0000-4000-8000-0000000ca001'
                      FROM public.audit_log WHERE action = 'evaluation_admin_corrected' AND target_id = (SELECT eval_id FROM ctx)::text),
  'the correction is audited with the reason, before and after');
SELECT pg_temp.check((SELECT e.submitted_at = f.submitted_at FROM public.evaluations e, first_submit f WHERE e.id = (SELECT eval_id FROM ctx)),
  'the original submitted time is kept');
SELECT pg_temp.check(NOT pg_temp.correct('{"hitting":4,"grounders":5}', 'submitted', 'Saving again, nothing changed'),
  'saving without changes returns false');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.audit_log WHERE action = 'evaluation_admin_corrected' AND target_id = (SELECT eval_id FROM ctx)::text),
  'and writes no audit entry');

-- Locked: the coach can't change scores, the admin can, including clearing one.
SELECT public.change_evaluation_session_stage((SELECT session_id FROM ctx), 'lock');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000cc001');
SELECT pg_temp.expect_error(format('SELECT public.save_evaluation(%s, %s, %L, %L, %L)', (SELECT session_id FROM ctx), (SELECT alpha FROM ctx), '{"hitting":1}', '{}', 'submitted'),
  'not open', 'after lock the coach cannot change scores');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ca001');
SELECT pg_temp.check(pg_temp.correct('{"hitting":4}', 'submitted', 'Grounders was for another player'), 'admin corrects a locked session, clearing a score');
SELECT pg_temp.check(pg_temp.scores() = '{"hitting":4}'::jsonb AND pg_temp.coach_overall() = 4, 'locked: grounders removed, overall 4.00');

-- Released: still allowed.
SELECT public.change_evaluation_session_stage((SELECT session_id FROM ctx), 'release');
SELECT pg_temp.check(pg_temp.correct('{"hitting":3}', 'submitted', 'Late fix after release'), 'admin corrects a released session');
SELECT pg_temp.expect_error($$SELECT pg_temp.correct('{"hitting":3}', 'not_evaluated', 'Mark not evaluated')$$, 'Clear all scores', 'not evaluated cannot keep scores');
SELECT pg_temp.correct('{}', 'not_evaluated', 'Player was injured');
SELECT pg_temp.check(pg_temp.scores() = '{}'::jsonb AND (SELECT status = 'not_evaluated' FROM public.evaluations WHERE id = (SELECT eval_id FROM ctx)),
  'admin marks the player Not Evaluated');
SELECT pg_temp.expect_error($$SELECT pg_temp.correct('{}', 'submitted', 'Submit with nothing')$$, 'at least one core skill', 'a submitted evaluation still needs a core score');

-- The guard still blocks deleting scores in a locked session without a correction.
SELECT pg_temp.check(pg_temp.correct('{"hitting":2}', 'submitted', 'Back to a score'), 'admin restores a score');
RESET ROLE;
SELECT pg_temp.expect_error(format('DELETE FROM public.ratings WHERE evaluation_id = %s', (SELECT eval_id FROM ctx)),
  'cannot be deleted from a locked session', 'without a correction, scores still cannot be deleted after lock');

-- Closed season: refused.
UPDATE public.seasons SET is_closed = true WHERE id = (SELECT season_id FROM ctx);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ca001');
SELECT pg_temp.expect_error($$SELECT pg_temp.correct('{"hitting":5}', 'submitted', 'After the season closed')$$, 'season is closed', 'no corrections in a closed season');
RESET ROLE;
ROLLBACK;
