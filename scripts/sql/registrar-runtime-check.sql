-- Runtime check: registrar role, check-in, bibs, walk-ups, timetable and the "here" marker. Rolled back.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000ea001', 'rg-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ea002', 'rg-registrar@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ea003', 'rg-coach@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ea004', 'rg-other-registrar@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Registrar check season', '2095-01-01', '2095-06-30'), ('Registrar other season', '2094-01-01', '2094-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS
  SELECT (SELECT id FROM public.seasons WHERE name = 'Registrar check season') AS season_id,
         (SELECT id FROM public.seasons WHERE name = 'Registrar other season') AS other_season,
         (now() AT TIME ZONE 'America/Los_Angeles')::date AS d1;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_profiles (user_id, display_name) VALUES ('00000000-0000-4000-8000-0000000ea003', 'Casey Coach');
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000ea001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000ea003', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000ea004', 'registrar', (SELECT other_season FROM ctx));
INSERT INTO public.evaluation_sessions (season_id, league_age, status) SELECT season_id, a, 'setup' FROM ctx, (VALUES (9), (10)) v(a);
ALTER TABLE ctx ADD COLUMN s9 bigint, ADD COLUMN s10 bigint;
UPDATE ctx SET s9 = (SELECT id FROM public.evaluation_sessions WHERE season_id = ctx.season_id AND league_age = 9),
               s10 = (SELECT id FROM public.evaluation_sessions WHERE season_id = ctx.season_id AND league_age = 10);
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location)
  SELECT s9, 'primary', d1, '09:00'::time, '10:30'::time, 'Field 1' FROM ctx UNION ALL
  SELECT s9, 'makeup', d1 + 7, '10:00'::time, '12:00'::time, 'Field 2' FROM ctx UNION ALL
  SELECT s10, 'primary', d1 + 1, '09:00'::time, '10:30'::time, 'Field 1' FROM ctx;
CREATE FUNCTION pg_temp.ev(p_age int, p_type text) RETURNS bigint LANGUAGE sql AS $$
  SELECT e.id FROM public.evaluation_session_events e WHERE e.evaluation_session_id = (SELECT CASE WHEN p_age = 9 THEN s9 ELSE s10 END FROM ctx) AND e.event_type = p_type;
$$;
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT s9, '00000000-0000-4000-8000-0000000ea003', 'coach' FROM ctx;
UPDATE public.evaluation_sessions SET status = 'open' WHERE id = (SELECT s9 FROM ctx);
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES
  ('Pia', 'Regtest', '2016-01-01'), ('Quinn', 'Regtest', '2016-01-02'), ('Rory', 'Regtest', '2016-01-03'), ('Sam', 'Regtest', '2015-01-04');
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number)
  SELECT p.id, (SELECT season_id FROM ctx), CASE WHEN p.first_name = 'Sam' THEN 10 ELSE 9 END, CASE WHEN p.first_name = 'Pia' THEN 9901 END
  FROM public.players p WHERE p.last_name = 'Regtest';
CREATE FUNCTION pg_temp.reg(p_first text) RETURNS bigint LANGUAGE sql AS $$
  SELECT ps.id FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Regtest' AND p.first_name = p_first;
$$;
SELECT pg_temp.reg('Pia') AS pia, pg_temp.reg('Quinn') AS quinn, pg_temp.reg('Rory') AS rory, pg_temp.reg('Sam') AS sam,
       pg_temp.ev(9, 'primary') AS e9, pg_temp.ev(9, 'makeup') AS e9m, pg_temp.ev(10, 'primary') AS e10 \gset

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

-- ---------- the role ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ea001');
SELECT public.admin_grant_role('00000000-0000-4000-8000-0000000ea002', 'registrar', (SELECT season_id FROM ctx));
RESET ROLE;
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = '00000000-0000-4000-8000-0000000ea002' AND role_name = 'registrar'),
  'an admin gives someone the registrar role for a season');

-- ---------- what a registrar can and can't read ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ea002');
SELECT pg_temp.check((SELECT count(*) FROM public.player_seasons WHERE season_id = (SELECT season_id FROM ctx)) = 4
  AND (SELECT count(*) FROM public.players WHERE last_name = 'Regtest') = 4, 'a registrar reads the season''s registrations and names');
SELECT pg_temp.check((SELECT count(*) FROM public.evaluation_sessions WHERE season_id = (SELECT season_id FROM ctx)) = 0
  AND (SELECT count(*) FROM public.evaluator_assignments) = 0, 'a registrar does not read sessions or assignments directly');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ea004');
SELECT pg_temp.check((SELECT count(*) FROM public.player_seasons WHERE season_id = (SELECT season_id FROM ctx)) = 0,
  'a registrar for another season sees none of them');
SELECT pg_temp.expect_error(format('SELECT public.toggle_checkin(%s, %s)', :pia, :e9), 'Only registrars and league admins', 'and cannot check them in');

-- ---------- check-in ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ea002');
SELECT pg_temp.check((SELECT count(*) FROM public.checkin_days((SELECT season_id FROM ctx))) = 3, 'the day picker lists the three event days');
SELECT pg_temp.check((SELECT array_agg(first_name ORDER BY first_name) FROM public.checkin_list((SELECT season_id FROM ctx), (SELECT d1 FROM ctx))) = ARRAY['Pia', 'Quinn', 'Rory'],
  'the main day lists the age groups with an event that day');
SELECT pg_temp.check(public.toggle_checkin(:pia, :e9) AND NOT public.toggle_checkin(:pia, :e9) AND public.toggle_checkin(:pia, :e9),
  'tapping checks in, tapping again undoes, and again checks in');
SELECT pg_temp.check((SELECT checked_in_at IS NOT NULL FROM public.checkin_list((SELECT season_id FROM ctx), (SELECT d1 FROM ctx)) WHERE first_name = 'Pia'),
  'the list shows who is checked in');
SELECT pg_temp.expect_error(format('SELECT public.toggle_checkin(%s, %s)', :pia, :e10), 'not for this player', 'a player cannot be checked in to another age group''s event');
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) FROM public.audit_log WHERE target_id = :'pia' AND action IN ('player_checked_in', 'player_check_in_undone')) = 3,
  'check-ins and undos are audited');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ea003');
SELECT pg_temp.expect_error(format('SELECT public.toggle_checkin(%s, %s)', :quinn, :e9), 'Only registrars and league admins', 'a coach cannot check players in');
SELECT pg_temp.check(ARRAY(SELECT public.session_checked_in_today((SELECT s9 FROM ctx))) = ARRAY[:pia]::bigint[],
  'the coach scoring the age group sees who is here today');
SELECT pg_temp.check((SELECT count(*) FROM public.checkin_list((SELECT season_id FROM ctx), (SELECT d1 FROM ctx))) = 0
  AND (SELECT count(*) FROM public.registrar_timetable((SELECT season_id FROM ctx))) = 0, 'a coach gets no check-in list or timetable');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ea004');
SELECT pg_temp.check((SELECT count(*) FROM public.session_checked_in_today((SELECT s9 FROM ctx))) = 0, 'someone unrelated sees no one');
RESET ROLE;

-- Makeup day: Pia came on the main day, Quinn was scored; only Rory is left.
SET LOCAL session_replication_role = replica;
INSERT INTO public.evaluations (evaluation_session_id, player_season_id, evaluator_user_id, evaluator_type, status, submitted_at)
  SELECT s9, :quinn, '00000000-0000-4000-8000-0000000ea003', 'coach', 'submitted', now() FROM ctx;
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ea002');
SELECT pg_temp.check((SELECT array_agg(first_name) FROM public.checkin_list((SELECT season_id FROM ctx), (SELECT d1 + 7 FROM ctx))) = ARRAY['Rory'],
  'a makeup day leaves out players checked in earlier or already scored');
SELECT pg_temp.check((SELECT count(*) FROM public.evaluations) = 0, 'a registrar cannot read scores');

-- ---------- bibs ----------
SELECT public.set_registration_bib(:rory, 9903);
SELECT pg_temp.expect_error(format('SELECT public.set_registration_bib(%s, 9901)', :quinn), 'already used by Pia Regtest', 'a bib already in use is refused');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ea003');
SELECT pg_temp.expect_error(format('SELECT public.set_registration_bib(%s, 9904)', :quinn), 'Only registrars and league admins', 'a coach cannot set bibs');
RESET ROLE;
SELECT pg_temp.check((SELECT evaluation_number FROM public.player_seasons WHERE id = :rory) = 9903
  AND EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'registration_bib_set' AND target_id = :'rory'), 'a registrar sets a bib, audited');

-- ---------- walk-ups, timetable, and what stays admin-only ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ea002');
SELECT pg_temp.check(public.admin_add_onsite_registration((SELECT season_id FROM ctx), NULL, 'Walk', 'Regtest', '2016-05-05', 9, 9905, 'Walk-up at evaluations') IS NOT NULL,
  'a registrar adds a walk-up');
SELECT pg_temp.check((SELECT coaches FROM public.registrar_timetable((SELECT season_id FROM ctx)) WHERE league_age = 9) = ARRAY['Casey Coach']
  AND (SELECT jsonb_array_length(events) FROM public.registrar_timetable((SELECT season_id FROM ctx)) WHERE league_age = 9) = 2,
  'the timetable shows who scores each age group and when');
SELECT pg_temp.expect_error(format('SELECT public.admin_grant_role(%L, %L, %s)', '00000000-0000-4000-8000-0000000ea003', 'registrar', (SELECT season_id FROM ctx)),
  'Administrator access required', 'a registrar cannot give roles');
SELECT public.admin_save_registration(:sam, 'Samuel', 'Regtest', NULL, 10, NULL, 'Parent corrected the name');
SELECT pg_temp.check((SELECT first_name FROM public.players p JOIN public.player_seasons ps ON ps.player_id = p.id WHERE ps.id = :sam) = 'Samuel',
  'a registrar fixes a player''s name in their season');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ea004');
SELECT pg_temp.expect_error(format('SELECT public.admin_save_registration(%s, %L, %L, NULL, 10, NULL, %L)', :sam, 'Sam', 'Regtest', 'test reason'),
  'Administrator access required', 'a registrar for another season cannot');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ea002');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ea003');
SELECT pg_temp.expect_error(format('SELECT public.admin_add_onsite_registration(%s, NULL, %L, %L, NULL, 9, NULL, %L)', (SELECT season_id FROM ctx), 'No', 'Way', 'Walk-up test'),
  'Only registrars and league admins', 'a coach cannot add walk-ups');
RESET ROLE;

ROLLBACK;
