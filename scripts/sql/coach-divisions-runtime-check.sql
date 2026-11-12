-- Runtime check: division ages, coach divisions, and assignments suggested from divisions. Rolled back.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000fa001', 'div-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000fc001', 'div-coach@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000fc002', 'div-coach2@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000fe001', 'div-eval@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Division check season', '2098-01-01', '2098-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT (SELECT id FROM public.seasons WHERE name = 'Division check season') AS season_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000fa001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000fc001', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000fc002', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000fe001', 'independent_evaluator', (SELECT season_id FROM ctx));
INSERT INTO public.evaluation_sessions (season_id, league_age, status)
  SELECT (SELECT season_id FROM ctx), a, CASE WHEN a = 11 THEN 'open' ELSE 'setup' END FROM generate_series(7, 16) a;
-- Coach 1 already scores age 8.
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT id, '00000000-0000-4000-8000-0000000fc001'::uuid, 'coach' FROM public.evaluation_sessions
  WHERE season_id = (SELECT season_id FROM ctx) AND league_age = 8;

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

CREATE FUNCTION pg_temp.div(p_name text) RETURNS bigint LANGUAGE sql AS $$ SELECT id FROM public.divisions WHERE name = p_name $$;
GRANT EXECUTE ON FUNCTION pg_temp.div(text) TO authenticated;

-- New seasons get the RWCLL division ages.
SELECT pg_temp.check((SELECT string_agg(d.name || ' ' || sd.min_age || '-' || sd.max_age, ', ' ORDER BY d.sort_order)
                      FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id
                      WHERE sd.season_id = (SELECT season_id FROM ctx))
  = 'AA 7-9, AAA 8-11, Majors 10-12, Juniors 13-14, Seniors 15-16', 'a new season gets the default division ages');

-- Only admins set ages; bad ranges are refused.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fc001');
SELECT pg_temp.expect_error(format('SELECT public.admin_set_division_ages(%s, %s, 7, 10)', (SELECT season_id FROM ctx), pg_temp.div('AA')),
  'Administrator access required', 'a coach cannot change division ages');
SELECT pg_temp.expect_error(format('SELECT public.division_assignment_preview(%s)', (SELECT season_id FROM ctx)),
  'Administrator access required', 'a coach cannot see the division preview');
SELECT pg_temp.check((SELECT count(*) FROM public.coach_divisions) = 0, 'coaches cannot read coach_divisions');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fa001');
SELECT pg_temp.expect_error(format('SELECT public.admin_set_division_ages(%s, %s, 10, 8)', (SELECT season_id FROM ctx), pg_temp.div('AA')),
  'youngest first', 'a backwards age range is refused');
SELECT public.admin_set_division_ages((SELECT season_id FROM ctx), pg_temp.div('Seniors'), 15, 17);
RESET ROLE;
SELECT pg_temp.check((SELECT max_age FROM public.season_divisions WHERE season_id = (SELECT season_id FROM ctx) AND division_id = pg_temp.div('Seniors')) = 17,
  'admin changes Seniors to 15-17');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'division_ages_set'), 'division age change is audited');

-- The next season copies the changed ages.
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Division check season 2', '2099-01-01', '2099-06-30');
SELECT pg_temp.check((SELECT sd.max_age FROM public.season_divisions sd JOIN public.seasons s ON s.id = sd.season_id
                      WHERE s.name = 'Division check season 2' AND sd.division_id = pg_temp.div('Seniors')) = 17,
  'a later season copies division ages from the latest earlier season');

-- Coach divisions.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fa001');
SELECT pg_temp.check(public.admin_set_coach_divisions('00000000-0000-4000-8000-0000000fc001', (SELECT season_id FROM ctx), ARRAY['aa', 'Tee Ball'], false)
  = '{"divisions":["AA"],"skipped":["Tee Ball"]}'::jsonb, 'import adds AA (case-insensitive) and reports Tee Ball as skipped');
SELECT pg_temp.check(public.admin_set_coach_divisions('00000000-0000-4000-8000-0000000fc001', (SELECT season_id FROM ctx), ARRAY['AAA'], false)
  -> 'divisions' = '["AA","AAA"]'::jsonb, 'a second import row adds AAA to AA');
SELECT pg_temp.expect_error(format('SELECT public.admin_set_coach_divisions(%L, %s, ARRAY[%L], true)', '00000000-0000-4000-8000-0000000fe001', (SELECT season_id FROM ctx), 'AA'),
  'Divisions are for coaches', 'an evaluator cannot be given divisions');
SELECT public.admin_set_coach_divisions('00000000-0000-4000-8000-0000000fc002', (SELECT season_id FROM ctx), ARRAY['Juniors', 'Majors'], true);
SELECT pg_temp.check(public.admin_set_coach_divisions('00000000-0000-4000-8000-0000000fc002', (SELECT season_id FROM ctx), ARRAY['Juniors'], true)
  -> 'divisions' = '["Juniors"]'::jsonb, 'People-page save replaces the list (Majors removed)');

-- Preview: coach 1 (AA 7-9 + AAA 8-11) covers 7-11; overlap ages name both divisions.
SELECT pg_temp.check((SELECT array_agg(league_age ORDER BY league_age) FROM public.division_assignment_preview((SELECT season_id FROM ctx))
                      WHERE user_id = '00000000-0000-4000-8000-0000000fc001') = ARRAY[7, 8, 9, 10, 11], 'AA + AAA coach covers ages 7-11');
SELECT pg_temp.check((SELECT divisions FROM public.division_assignment_preview((SELECT season_id FROM ctx))
                      WHERE user_id = '00000000-0000-4000-8000-0000000fc001' AND league_age = 9) = 'AA, AAA', 'age 9 comes from both AA and AAA');
SELECT pg_temp.check((SELECT already_assigned FROM public.division_assignment_preview((SELECT season_id FROM ctx))
                      WHERE user_id = '00000000-0000-4000-8000-0000000fc001' AND league_age = 8), 'existing age 8 assignment is shown as already assigned');

-- Apply: adds 7, 9, 10 for coach 1 (8 exists, 11 is open) and 13, 14 for coach 2. Running again adds nothing.
SELECT pg_temp.check(public.apply_division_assignments((SELECT season_id FROM ctx)) = 5, 'apply adds 5 assignments (skips existing and open age groups)');
SELECT pg_temp.check(public.apply_division_assignments((SELECT season_id FROM ctx)) = 0, 'running apply again adds nothing');
RESET ROLE;
SELECT pg_temp.check((SELECT array_agg(es.league_age ORDER BY es.league_age) FROM public.evaluator_assignments ea
                      JOIN public.evaluation_sessions es ON es.id = ea.evaluation_session_id
                      WHERE ea.evaluator_user_id = '00000000-0000-4000-8000-0000000fc001' AND es.season_id = (SELECT season_id FROM ctx))
  = ARRAY[7, 8, 9, 10], 'coach 1 now scores ages 7-10 (open age 11 untouched)');
SELECT pg_temp.check((SELECT bool_and(evaluator_type = 'coach') FROM public.evaluator_assignments ea
                      JOIN public.evaluation_sessions es ON es.id = ea.evaluation_session_id WHERE es.season_id = (SELECT season_id FROM ctx)),
  'assignments from divisions are coach assignments');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'division_assignments_applied' AND after_data->>'added' = '5'),
  'apply is audited with the count');

-- Removing the coach role drops that season's divisions.
DELETE FROM public.user_roles WHERE user_id = '00000000-0000-4000-8000-0000000fc002' AND role_name = 'coach';
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.coach_divisions WHERE user_id = '00000000-0000-4000-8000-0000000fc002'),
  'removing the coach role removes their divisions');

ROLLBACK;
