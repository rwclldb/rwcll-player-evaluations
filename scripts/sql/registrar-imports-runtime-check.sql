-- Runtime check: registrars run the registration import, bib upload and player fixes for their season. Rolled back.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000eb001', 'ri-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000eb002', 'ri-registrar@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000eb003', 'ri-other-registrar@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000eb004', 'ri-coach@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Reg import season', '2093-01-01', '2093-06-30'), ('Reg import other', '2092-01-01', '2092-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS
  SELECT (SELECT id FROM public.seasons WHERE name = 'Reg import season') AS season_id, (SELECT id FROM public.seasons WHERE name = 'Reg import other') AS other_season;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000eb001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000eb002', 'registrar', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000eb003', 'registrar', (SELECT other_season FROM ctx)),
  ('00000000-0000-4000-8000-0000000eb004', 'coach', (SELECT season_id FROM ctx));

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
CREATE FUNCTION pg_temp.r(p_first text, p_pid text, p_pay text, p_line int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('line', p_line, 'playerId', p_pid, 'firstName', p_first, 'lastName', 'Rimport', 'birthDate', '2016-03-0' || p_line,
    'program', 'Baseball', 'division', 'AA', 'registrationNumber', '', 'paymentStatus', p_pay, 'leagueAge', 9, 'issues', '[]'::jsonb);
$$;

-- An admin's prior-year import in the same season stays hidden from registrars.
INSERT INTO public.import_batches (import_type, source_file_name, status, rows_received, rows_processed, rows_with_errors, season_id)
  SELECT 'historical_evaluations', 'prior.csv', 'pending', 0, 0, 0, season_id FROM ctx;

-- ---------- registration import ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000eb002');
SELECT public.stage_sports_connect_import((SELECT season_id FROM ctx), 'reg.csv',
  jsonb_build_array(pg_temp.r('Ada', 'RI1', 'Paid', 2), pg_temp.r('Bo', 'RI2', 'Pending', 3))) AS b1 \gset
SELECT pg_temp.check((SELECT count(*) FROM public.sports_connect_import_rows WHERE import_batch_id = :b1) = 2, 'a registrar stages the registration file and sees its rows');
SELECT pg_temp.check((SELECT array_agg(import_type) FROM public.import_batches WHERE season_id = (SELECT season_id FROM ctx)) = ARRAY['players'],
  'a registrar sees registration batches but not the prior-year import');
SELECT pg_temp.check((SELECT clean_rows FROM public.import_batch_bulk_counts(:b1)) = 2, 'bulk counts work for a registrar');
SELECT pg_temp.check(public.bulk_commit_clean_import_rows(:b1, 'Clean registrations') = 2, 'a registrar approves and commits clean rows');
SELECT pg_temp.check((SELECT count(*) FROM public.player_seasons WHERE season_id = (SELECT season_id FROM ctx)) = 2, 'the players are registered');

-- Re-import: Bo paid (automatic) and has a new name (waits for a tick).
SELECT public.stage_sports_connect_import((SELECT season_id FROM ctx), 'reg2.csv',
  jsonb_build_array(pg_temp.r('Ada', 'RI1', 'Paid', 2), pg_temp.r('Bobby', 'RI2', 'Paid', 3))) AS b2 \gset
SELECT pg_temp.check((SELECT count(*) FROM public.import_batch_missing_registrations(:b2)) = 0, 'the missing-players list works for a registrar');
SELECT pg_temp.check(public.apply_import_row_changes((SELECT id FROM public.sports_connect_import_rows WHERE import_batch_id = :b2 AND external_player_id = 'RI2'),
  ARRAY['name'], 'Parent fixed the name') = 1, 'a registrar applies re-import changes');
SELECT pg_temp.check((SELECT first_name FROM public.players p JOIN public.player_seasons ps ON ps.player_id = p.id WHERE ps.external_player_id = 'RI2') = 'Bobby',
  'the change is saved');
SELECT ps.id AS ada FROM public.player_seasons ps WHERE ps.external_player_id = 'RI1' \gset

-- ---------- bib upload and player fixes ----------
SELECT public.stage_bib_import((SELECT season_id FROM ctx), 'bibs.csv', '[{"line": 2, "player_id": "RI1", "bib": "777"}]'::jsonb) AS bb \gset
SELECT pg_temp.check((SELECT count(*) FROM public.bib_import_rows WHERE import_batch_id = :bb) = 1, 'a registrar uploads bibs and sees the rows');
SELECT public.apply_bib_import(:bb, '{}');
SELECT pg_temp.check((SELECT evaluation_number FROM public.player_seasons WHERE id = :ada) = 777, 'a registrar applies the bib upload');
SELECT public.admin_set_coach_kid(:ada, true);
SELECT public.admin_save_registration(:ada, 'Ada', 'Rimport', '2016-03-02', 9, 778, NULL);
SELECT pg_temp.check((SELECT is_coach_kid AND evaluation_number = 778 FROM public.player_seasons WHERE id = :ada), 'a registrar sets coach''s kid and changes a bib');
SELECT pg_temp.check((SELECT count(*) FROM public.registration_history(:ada)) >= 2, 'a registrar sees the registration''s change history');
SELECT pg_temp.check(public.registration_has_scores(:ada) = false, 'and whether the player has scores (yes/no only)');
SELECT pg_temp.check((SELECT count(*) FROM public.audit_log) = 0 AND (SELECT count(*) FROM public.evaluations) = 0,
  'a registrar still cannot read the audit log or scores directly');

-- ---------- someone else ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000eb003');
SELECT pg_temp.check((SELECT count(*) FROM public.import_batches WHERE id = :b1) = 0
  AND (SELECT count(*) FROM public.sports_connect_import_rows WHERE import_batch_id = :b1) = 0, 'a registrar for another season sees none of it');
SELECT pg_temp.expect_error(format('SELECT public.bulk_commit_clean_import_rows(%s, %L)', :b1, 'Not mine'), 'Administrator access required', 'and cannot commit it');
SELECT pg_temp.expect_error(format('SELECT public.stage_sports_connect_import(%s, %L, %L::jsonb)', (SELECT season_id FROM ctx), 'x.csv', jsonb_build_array(pg_temp.r('Cy', 'RI3', 'Paid', 2))),
  'Administrator access required', 'or stage a file for that season');
SELECT pg_temp.check(public.registration_has_scores(:ada) IS NULL AND (SELECT count(*) FROM public.registration_history(:ada)) = 0, 'or read the player''s history');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000eb004');
SELECT pg_temp.expect_error(format('SELECT public.admin_set_coach_kid(%s, false)', :ada), 'Administrator access required', 'a coach cannot fix registrations');
SELECT pg_temp.expect_error(format('SELECT public.stage_bib_import(%s, %L, %L::jsonb)', (SELECT season_id FROM ctx), 'b.csv', '[{"line": 2, "player_id": "RI1", "bib": "1"}]'),
  'Administrator access required', 'or upload bibs');
RESET ROLE;

ROLLBACK;
