-- Runtime check: birthdate protection. Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000b0001', 'bp-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b0002', 'bp-registrar@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000b0003', 'bp-coach@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Birthdate check season', '2086-01-01', '2086-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT (SELECT id FROM public.seasons WHERE name = 'Birthdate check season') AS season_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000b0001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000b0002', 'registrar', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000b0003', 'coach', (SELECT season_id FROM ctx));
INSERT INTO public.evaluation_sessions (season_id, league_age, status) SELECT season_id, 9, 'setup' FROM ctx;
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT id, '00000000-0000-4000-8000-0000000b0003'::uuid, 'coach' FROM public.evaluation_sessions WHERE season_id = (SELECT season_id FROM ctx);
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Dana', 'Bptest', '2016-05-06'), ('Eli', 'Bptest', NULL);
INSERT INTO public.player_seasons (player_id, season_id, league_age)
  SELECT p.id, (SELECT season_id FROM ctx), 9 FROM public.players p WHERE p.last_name = 'Bptest';
SELECT ps.id AS dana FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.first_name = 'Dana' AND p.last_name = 'Bptest' \gset

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

-- ---------- nobody reads the column ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0003');
SELECT pg_temp.expect_error('SELECT date_of_birth FROM public.players LIMIT 1', 'permission denied', 'a coach cannot read birthdates');
SELECT pg_temp.check((SELECT array_agg(has_birth_date ORDER BY first_name) FROM public.players WHERE last_name = 'Bptest') = ARRAY[true, false],
  'a coach scoring the age group sees only whether a birthdate is on file');
SELECT pg_temp.expect_error(format('SELECT public.reveal_birthdate(%L, %s)', 'registration', :dana), 'Only league admins and registrars', 'a coach cannot reveal one');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0002');
SELECT pg_temp.expect_error('SELECT date_of_birth FROM public.players LIMIT 1', 'permission denied', 'nor a registrar, directly');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0001');
SELECT pg_temp.expect_error('SELECT date_of_birth FROM public.players LIMIT 1', 'permission denied', 'nor an admin, directly');
SELECT pg_temp.expect_error('SELECT birth_date FROM public.sports_connect_import_rows LIMIT 1', 'permission denied', 'staged import birthdates are closed too');
SELECT pg_temp.expect_error('SELECT source_data FROM public.bib_import_rows LIMIT 1', 'permission denied', 'and the raw rows of bib uploads');

-- ---------- one at a time, logged ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0002');
SELECT pg_temp.check(public.reveal_birthdate('registration', :dana, 'Player edit page') = '2016-05-06', 'a registrar reveals one birthdate');
RESET ROLE;
SELECT pg_temp.check((SELECT reason FROM public.audit_log WHERE action = 'birthdate_revealed' AND target_id = :'dana') = 'Player edit page',
  'the reveal is logged with where it happened');

-- ---------- saving without reading it; the audit log never keeps it ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0002');
SELECT public.admin_save_registration(:dana, 'Dana', 'Bptest', NULL, 9, 4321, NULL, true);
RESET ROLE;
SELECT pg_temp.check((SELECT date_of_birth FROM public.players WHERE first_name = 'Dana' AND last_name = 'Bptest') = '2016-05-06',
  '"keep" saves other fields and leaves the stored birthdate alone');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0002');
SELECT public.admin_save_registration(:dana, 'Dana', 'Bptest', '2016-05-07', 9, 4321, 'Parent corrected it');
RESET ROLE;
SELECT pg_temp.check((SELECT after_data ->> 'date_of_birth_changed' = 'true' AND after_data ->> 'date_of_birth' = '(hidden)'
                             AND before_data::text !~ '2016-05' AND after_data::text !~ '2016-05'
  FROM public.audit_log WHERE action = 'registration_admin_update' AND target_id = :'dana' ORDER BY id DESC LIMIT 1),
  'the audit log records that the birthdate changed, never the dates');

-- ---------- imports: compare without showing, forget once handled ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0002');
SELECT public.stage_sports_connect_import((SELECT season_id FROM ctx), 'bp.csv', jsonb_build_array(
  jsonb_build_object('line', 2, 'playerId', 'BP1', 'firstName', 'Dana', 'lastName', 'Bptest', 'birthDate', '2016-05-07', 'program', 'Baseball',
                     'division', 'AA', 'paymentStatus', 'Paid', 'leagueAge', 9, 'issues', '[]'::jsonb),
  jsonb_build_object('line', 3, 'playerId', 'BP2', 'firstName', 'Fay', 'lastName', 'Bptest', 'birthDate', '2017-01-01', 'program', 'Baseball',
                     'division', 'AA', 'paymentStatus', 'Paid', 'leagueAge', 9, 'issues', '[]'::jsonb))) AS b \gset
SELECT pg_temp.check((SELECT reason FROM public.import_batch_candidates(:b) WHERE first_name = 'Dana' LIMIT 1) = 'Name and birthdate match',
  'import review says whether name and birthdate match, without the dates');
SELECT pg_temp.check((SELECT has_birth_date FROM public.sports_connect_import_rows WHERE import_batch_id = :b AND external_player_id = 'BP2'),
  'a staged row shows only that it has a birthdate');
RESET ROLE;
UPDATE public.sports_connect_import_rows SET review_state = 'approved_new' WHERE import_batch_id = :b AND external_player_id = 'BP2';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000b0002');
SELECT public.commit_sports_connect_import_row(id, 'Birthdate check') FROM public.sports_connect_import_rows WHERE import_batch_id = :b AND external_player_id = 'BP2';
RESET ROLE;
SELECT pg_temp.check((SELECT birth_date IS NULL AND birth_date_text = '' FROM public.sports_connect_import_rows WHERE import_batch_id = :b AND external_player_id = 'BP2')
  AND (SELECT date_of_birth FROM public.players WHERE first_name = 'Fay' AND last_name = 'Bptest') = '2017-01-01',
  'once committed, the staged row forgets the birthdate (the player keeps it)');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM public.audit_log WHERE action = 'sports_connect_import_row_committed' AND (before_data::text || after_data::text) ~ '2017-01-01'),
  'the commit audit entry has no birthdate');

-- ---------- check-in sends no birthdates ----------
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proargnames) a WHERE p.proname = 'checkin_list' AND a = 'date_of_birth'),
  'check-in no longer returns birthdates');

ROLLBACK;
