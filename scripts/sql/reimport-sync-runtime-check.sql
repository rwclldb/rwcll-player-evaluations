-- Runtime check: re-importing a Sports Connect export compares rows with existing registrations. Rolled back.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000e5a01', 'rs-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000e5c01', 'rs-coach@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Resync check season', '2097-01-01', '2097-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT (SELECT id FROM public.seasons WHERE name = 'Resync check season') AS season_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000e5a01', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000e5c01', 'coach', (SELECT season_id FROM ctx));

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
CREATE FUNCTION pg_temp.r(p_first text, p_last text, p_pid text, p_birth text, p_age int, p_pay text, p_reg text, p_line int, p_kid text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('line', p_line, 'playerId', p_pid, 'firstName', p_first, 'lastName', p_last, 'birthDate', p_birth,
    'program', 'Baseball', 'division', 'AA', 'registrationNumber', p_reg, 'paymentStatus', p_pay, 'leagueAge', p_age, 'issues', '[]'::jsonb)
    || CASE WHEN p_kid IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('coachKid', p_kid = 'Yes') END;
$$;

-- ---------- first export: seven players, committed as new ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e5a01');
SELECT public.stage_sports_connect_import((SELECT season_id FROM ctx), 'first.csv', jsonb_build_array(
  pg_temp.r('Ann', 'Rsync', 'S1', '2017-01-01', 9, 'Paid', '701', 2),
  pg_temp.r('Ben', 'Rsync', 'S2', '2017-01-02', 9, 'Pending', '', 3),
  pg_temp.r('Cal', 'Rsync', 'S3', '2017-01-03', 9, 'Paid', '', 4),
  pg_temp.r('Dee', 'Rsync', 'S4', '2017-01-04', 9, 'Paid', '', 5),
  pg_temp.r('Hal', 'Rsync', 'S5', '2017-01-05', 9, 'Paid', '', 6),
  pg_temp.r('Ivy', 'Rsync', 'S6', '2017-01-06', 9, 'Paid', '', 7),
  pg_temp.r('Jon', 'Rsync', 'S7', '2017-01-07', 9, 'Paid', '703', 8),
  pg_temp.r('Kit', 'Rsync', 'S8', '2017-01-08', 9, 'Paid', '', 9),
  pg_temp.r('Tee', 'Rsync', 'S10', '2021-01-01', 5, 'Paid', '', 10))) AS b1 \gset
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) FROM public.sports_connect_import_rows WHERE import_batch_id = :b1 AND review_state = 'needs_review') = 9,
  'a first import of new Player Ids goes to review as before');
UPDATE public.sports_connect_import_rows SET source_division = 'Tee Ball', review_state = 'ignored' WHERE import_batch_id = :b1 AND external_player_id = 'S10';
UPDATE public.sports_connect_import_rows SET review_state = 'approved_new' WHERE import_batch_id = :b1 AND external_player_id <> 'S10';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e5a01');
SELECT public.commit_sports_connect_import_row(id, 'Resync check') FROM public.sports_connect_import_rows WHERE import_batch_id = :b1 AND review_state = 'approved_new';
RESET ROLE;

CREATE FUNCTION pg_temp.reg(p_pid text) RETURNS bigint LANGUAGE sql AS $$
  SELECT id FROM public.player_seasons WHERE season_id = (SELECT season_id FROM ctx) AND external_player_id = p_pid;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.reg(text) TO authenticated;
-- Ivy already has a score, so her age group is fixed.
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES ((SELECT season_id FROM ctx), 9, 'open');
SET LOCAL session_replication_role = replica;
INSERT INTO public.evaluations (evaluation_session_id, player_season_id, evaluator_user_id, evaluator_type, status, submitted_at)
  SELECT id, pg_temp.reg('S6'), '00000000-0000-4000-8000-0000000e5c01', 'coach', 'submitted', now()
  FROM public.evaluation_sessions WHERE season_id = (SELECT season_id FROM ctx);
SET LOCAL session_replication_role = origin;

-- ---------- second export ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e5a01');
SELECT public.stage_sports_connect_import((SELECT season_id FROM ctx), 'second.csv', jsonb_build_array(
  pg_temp.r('Ann', 'Rsync', 'S1', '2017-01-01', 9, 'Paid', '701', 2),             -- identical
  pg_temp.r('Ben', 'Rsync', 'S2', '2017-01-02', 9, 'Paid', '702', 3),             -- paid now, bib from Registration Number
  pg_temp.r('Callum', 'Rsync', 'S3', '2017-01-03', 9, 'Paid', '', 4, 'Yes'),      -- new name, coach's kid
  pg_temp.r('Harold', 'Other', 'S5', '2016-05-05', 10, 'Paid', '', 5),            -- different child?
  pg_temp.r('Ivy', 'Rsync', 'S6', '2016-01-06', 10, 'Paid', '', 6),               -- birthdate and age
  pg_temp.r('Jon', 'Rsync', 'S7', '2017-01-07', 9, 'Paid', '701', 7),             -- bib taken by Ann
  pg_temp.r('Kitty', 'Rsync', 'S8', '2017-01-08', 9, 'Paid', '', 8),              -- edited in the app before applying
  -- Eve is new; Dee is missing from this file.
  pg_temp.r('Eve', 'Newrsync', 'S9', '2017-02-01', 9, 'Paid', '', 9),
  pg_temp.r('Tee', 'Rsync', 'S10', '2021-01-01', 5, 'Paid', '', 10) || '{"division": "Tee Ball"}',   -- ignored last time
  pg_temp.r('Tia', 'Rsync', 'S11', '2021-01-02', 5, 'Paid', '', 11) || '{"division": "Tee Ball"}'))  -- new, out of scope
  AS b2 \gset
RESET ROLE;

CREATE FUNCTION pg_temp.row_of(p_batch bigint, p_pid text) RETURNS public.sports_connect_import_rows LANGUAGE sql AS $$
  SELECT * FROM public.sports_connect_import_rows WHERE import_batch_id = p_batch AND external_player_id = p_pid;
$$;
SELECT pg_temp.check((pg_temp.row_of(:b2, 'S1')).review_state = 'up_to_date' AND (pg_temp.row_of(:b2, 'S1')).sync_changes = '[]'::jsonb,
  'an identical row is marked up to date');
SELECT pg_temp.check((pg_temp.row_of(:b2, 'S2')).review_state = 'up_to_date'
  AND (SELECT registration_payment_status = 'Paid' AND evaluation_number = 702 AND external_registration_id = '702' FROM public.player_seasons WHERE id = pg_temp.reg('S2')),
  'payment status, Registration Number and an empty bib are updated automatically');
SELECT pg_temp.check((SELECT count(*) FROM public.audit_log WHERE action = 'registration_synced_from_import' AND target_id = pg_temp.reg('S2')::text) = 1,
  'the automatic update is audited');
SELECT pg_temp.check((pg_temp.row_of(:b2, 'S3')).review_state = 'has_changes'
  AND (SELECT array_agg(c->>'field' ORDER BY c->>'field') FROM jsonb_array_elements((pg_temp.row_of(:b2, 'S3')).sync_changes) c) = ARRAY['coach_kid', 'name'],
  'a new name and Coaches Kid wait for the admin');
SELECT pg_temp.check((SELECT first_name FROM public.players p JOIN public.player_seasons ps ON ps.player_id = p.id WHERE ps.id = pg_temp.reg('S3')) = 'Cal',
  'nothing that needs a tick is changed at staging');
SELECT pg_temp.check((pg_temp.row_of(:b2, 'S5')).review_state = 'needs_review'
  AND (pg_temp.row_of(:b2, 'S5')).review_flags::text LIKE '%name and birthdate both differ%',
  'a different name and birthdate on the same Player Id stays in row review with a flag');
SELECT pg_temp.check((SELECT c->>'blocked' FROM jsonb_array_elements((pg_temp.row_of(:b2, 'S6')).sync_changes) c WHERE c->>'field' = 'league_age') LIKE '%already has scores%',
  'an age change for a player with scores is shown but blocked');
SELECT pg_temp.check((SELECT c->>'blocked' FROM jsonb_array_elements((pg_temp.row_of(:b2, 'S7')).sync_changes) c WHERE c->>'field' = 'bib') LIKE '%already used by Ann Rsync%',
  'a bib already used by someone else is shown but blocked');
SELECT pg_temp.check((pg_temp.row_of(:b2, 'S9')).review_state = 'needs_review'
  AND (SELECT clean_rows FROM public.import_batch_bulk_counts(:b2)) = 1, 'a new Player Id is a clean new row as before');
SELECT pg_temp.check((pg_temp.row_of(:b2, 'S10')).review_state = 'ignored' AND (pg_temp.row_of(:b2, 'S11')).review_state = 'needs_review',
  'a Player Id ignored in an earlier batch is ignored again; a new out-of-scope row still waits');
SELECT pg_temp.check((SELECT (after_data->>'rows_ignored')::int FROM public.audit_log WHERE action = 'sports_connect_import_rows_auto_ignored' AND target_id = :'b2') = 1,
  'the automatic ignore is audited');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e5a01');
SELECT pg_temp.check((SELECT array_agg(external_player_id) FROM public.import_batch_missing_registrations(:b2)) = ARRAY['S4'],
  'players missing from the new file are listed');
SELECT pg_temp.expect_error(format('SELECT public.review_sports_connect_import_row(%s, %L, NULL, %L)', (pg_temp.row_of(:b2, 'S1')).id, 'approved_new', 'Trying it'),
  'already registered', 'row review refuses an already-registered row');

-- ---------- applying ----------
SELECT pg_temp.check(public.apply_import_row_changes((pg_temp.row_of(:b2, 'S3')).id, ARRAY['name'], 'Parent fixed the name') = 1, 'applying the ticked change returns 1');
RESET ROLE;
SELECT pg_temp.check((SELECT first_name FROM public.players p JOIN public.player_seasons ps ON ps.player_id = p.id WHERE ps.id = pg_temp.reg('S3')) = 'Callum'
  AND NOT (SELECT is_coach_kid FROM public.player_seasons WHERE id = pg_temp.reg('S3'))
  AND (pg_temp.row_of(:b2, 'S3')).review_state = 'changes_reviewed',
  'the ticked change is applied, the unticked one keeps the app value');
SELECT pg_temp.check((SELECT after_data->'kept' FROM public.audit_log WHERE action = 'registration_synced_from_import' AND target_id = pg_temp.reg('S3')::text) = '["coach_kid"]'::jsonb,
  'the audit entry records what was applied and what was kept');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e5a01');
SELECT pg_temp.expect_error(format('SELECT public.apply_import_row_changes(%s, ARRAY[''league_age''], %L)', (pg_temp.row_of(:b2, 'S6')).id, 'Age fix'),
  'already has scores', 'a blocked change cannot be applied');
SELECT pg_temp.check(public.apply_import_row_changes((pg_temp.row_of(:b2, 'S6')).id, ARRAY['birth_date'], 'Birthdate fix') = 1, 'the birthdate alone can be applied');
SELECT pg_temp.check(public.apply_import_row_changes((pg_temp.row_of(:b2, 'S7')).id, '{}', 'Keep the bib') = 0, 'keeping everything applies nothing');
RESET ROLE;
SELECT pg_temp.check((SELECT evaluation_number FROM public.player_seasons WHERE id = pg_temp.reg('S7')) = 703
  AND (pg_temp.row_of(:b2, 'S7')).review_state = 'changes_reviewed', 'the kept row is marked reviewed with its bib unchanged');
UPDATE public.players SET first_name = 'Kat' WHERE id = (SELECT player_id FROM public.player_seasons WHERE id = pg_temp.reg('S8'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e5a01');
SELECT pg_temp.expect_error(format('SELECT public.apply_import_row_changes(%s, ARRAY[''name''], %L)', (pg_temp.row_of(:b2, 'S8')).id, 'Name fix'),
  'changed in the app', 'a value edited in the app after staging is not overwritten');
RESET ROLE;
SELECT (pg_temp.row_of(:b2, 'S8')).id AS kit_row \gset
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000e5c01');
SELECT pg_temp.expect_error(format('SELECT public.apply_import_row_changes(%s, ARRAY[''name''], %L)', :kit_row, 'Name fix'),
  'Administrator access required', 'a coach cannot apply changes');
SELECT pg_temp.check((SELECT count(*) FROM public.import_batch_missing_registrations(:b2)) = 0, 'a coach sees no missing list');
RESET ROLE;

ROLLBACK;
