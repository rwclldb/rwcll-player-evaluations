-- Runtime check: player exemptions (who records them, who sees what, and their effects). Rolled back.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000ef001', 'ex-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ef002', 'ex-registrar@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ef003', 'ex-coach@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ef004', 'ex-coach2@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ef005', 'ex-other-registrar@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Exemption check season', '2088-01-01', '2088-06-30'), ('Exemption other season', '2087-01-01', '2087-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS
  SELECT (SELECT id FROM public.seasons WHERE name = 'Exemption check season') AS season_id,
         (SELECT id FROM public.seasons WHERE name = 'Exemption other season') AS other_season,
         (now() AT TIME ZONE 'America/Los_Angeles')::date AS d1;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_profiles (user_id, display_name) VALUES ('00000000-0000-4000-8000-0000000ef002', 'Rita Registrar');
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000ef001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000ef002', 'registrar', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000ef003', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000ef004', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000ef005', 'registrar', (SELECT other_season FROM ctx));
INSERT INTO public.evaluation_sessions (season_id, league_age, status) SELECT season_id, 9, 'setup' FROM ctx;
ALTER TABLE ctx ADD COLUMN s9 bigint;
UPDATE ctx SET s9 = (SELECT id FROM public.evaluation_sessions WHERE season_id = ctx.season_id);
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location)
  SELECT s9, 'primary', d1, '09:00'::time, '10:30'::time, 'Field 1' FROM ctx UNION ALL
  SELECT s9, 'makeup', d1 + 7, '10:00'::time, '12:00'::time, 'Field 2' FROM ctx;
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT s9, '00000000-0000-4000-8000-0000000ef003'::uuid, 'coach' FROM ctx;
UPDATE public.evaluation_sessions SET status = 'open' WHERE id = (SELECT s9 FROM ctx);
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Abe', 'Extest', '2016-01-01'), ('Bea', 'Extest', '2016-01-02'), ('Cy', 'Extest', '2016-01-03');
INSERT INTO public.player_seasons (player_id, season_id, league_age)
  SELECT p.id, (SELECT season_id FROM ctx), 9 FROM public.players p WHERE p.last_name = 'Extest';
CREATE FUNCTION pg_temp.reg(p_first text) RETURNS bigint LANGUAGE sql AS $$
  SELECT ps.id FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Extest' AND p.first_name = p_first;
$$;
SELECT pg_temp.reg('Abe') AS abe, pg_temp.reg('Bea') AS bea, pg_temp.reg('Cy') AS cy \gset

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
-- ---------- who can record ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ef003');
SELECT pg_temp.expect_error(format('SELECT public.set_player_exemption(%s, %L, %L)', :abe, 'attendance', 'Broken arm, excused'), 'Only league admins and registrars', 'a coach cannot record exemptions');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ef005');
SELECT pg_temp.expect_error(format('SELECT public.set_player_exemption(%s, %L, %L)', :abe, 'attendance', 'Broken arm, excused'), 'Only league admins and registrars', 'nor a registrar for another season');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ef002');
SELECT pg_temp.expect_error(format('SELECT public.set_player_exemption(%s, %L, %L)', :abe, 'attendance', 'no'), 'reason', 'a reason is required');
SELECT pg_temp.expect_error(format('SELECT public.set_player_exemption(%s, %L, %L)', :abe, 'everything', 'Broken arm, excused'), 'covers', 'the scope must be attendance, evaluation or both');
SELECT public.set_player_exemption(:abe, 'attendance', 'Out of town for the main day', 'League President');
SELECT pg_temp.check((SELECT scope = 'attendance' AND approved_by_name = 'League President' AND recorded_by_name = 'Rita Registrar'
  FROM public.registration_exemption(:abe)), 'a registrar records an exemption with an approver; the recorder is saved');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ef001');
SELECT public.set_player_exemption(:bea, 'evaluation', 'Returning all-star, board decision');

-- ---------- who sees what ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ef003');
SELECT pg_temp.check((SELECT count(*) FROM public.registration_exemption(:abe)) = 0, 'a coach cannot read the reason or approver');
SELECT pg_temp.check((SELECT array_agg(scope ORDER BY scope) FROM public.session_exemptions((SELECT s9 FROM ctx))) = ARRAY['attendance', 'evaluation'],
  'the coach scoring the age group sees who is exempt and from what');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ef004');
SELECT pg_temp.check((SELECT count(*) FROM public.session_exemptions((SELECT s9 FROM ctx))) = 0, 'a coach not scoring it sees nothing before release');
RESET ROLE;
UPDATE public.evaluation_sessions SET status = 'locked', published_at = now(), published_by = '00000000-0000-4000-8000-0000000ef001' WHERE id = (SELECT s9 FROM ctx);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ef004');
SELECT pg_temp.check((SELECT count(*) FROM public.session_exemptions((SELECT s9 FROM ctx))) = 2, 'every coach sees them once the draft report is released');
RESET ROLE;
UPDATE public.evaluation_sessions SET status = 'open', published_at = NULL, published_by = NULL WHERE id = (SELECT s9 FROM ctx);

-- ---------- replace and remove keep history ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ef002');
SELECT public.set_player_exemption(:abe, 'both', 'Out of town for both days', NULL);
SELECT public.revoke_player_exemption(:bea, 'Board changed its mind');
SELECT pg_temp.expect_error(format('SELECT public.revoke_player_exemption(%s, %L)', :cy, 'Nothing to remove'), 'no exemption', 'removing a missing exemption is refused');
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) FROM public.player_exemptions WHERE player_season_id = :abe) = 2
  AND (SELECT scope FROM public.player_exemptions WHERE player_season_id = :abe AND revoked_at IS NULL) = 'both',
  'replacing keeps the old exemption and makes the new one active');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.player_exemptions WHERE player_season_id = :bea AND revoked_at IS NULL)
  AND (SELECT revoke_reason FROM public.player_exemptions WHERE player_season_id = :bea) = 'Board changed its mind', 'removing keeps the record with its reason');
SELECT pg_temp.check((SELECT count(*) FROM public.audit_log WHERE target_id IN (:'abe', :'bea') AND action IN ('player_exemption_set', 'player_exemption_revoked')) = 4,
  'every change is audited');

-- ---------- effects ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ef002');
SELECT pg_temp.check((SELECT exempt_scope FROM public.checkin_list((SELECT season_id FROM ctx), (SELECT d1 FROM ctx)) WHERE first_name = 'Abe') = 'both',
  'check-in shows the exemption');
SELECT pg_temp.check((SELECT array_agg(first_name ORDER BY first_name) FROM public.checkin_list((SELECT season_id FROM ctx), (SELECT d1 + 7 FROM ctx))) = ARRAY['Bea', 'Cy'],
  'a player exempt from attendance is not on the makeup-day list');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ef001');
SELECT pg_temp.check((SELECT players FROM public.admin_scoring_progress((SELECT season_id FROM ctx)) LIMIT 1) = 2,
  'Scoring Progress leaves a player exempt from evaluation out of the count');
RESET ROLE;

ROLLBACK;
