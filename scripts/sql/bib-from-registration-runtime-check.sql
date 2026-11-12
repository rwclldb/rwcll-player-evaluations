-- Runtime check: committing a Sports Connect row sets the bib from Registration Number. Rolled back.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000b1001', 'bibreg-admin@example.test', 'authenticated', 'authenticated');
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES ('00000000-0000-4000-8000-0000000b1001', 'administrator', NULL);
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Bib reg check season', '2097-01-01', '2097-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT (SELECT id FROM public.seasons WHERE name = 'Bib reg check season') AS season_id;
GRANT SELECT ON ctx TO authenticated;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text) TO authenticated;

-- A walk-up already wears bib 700, and one registered player has bib 500.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000b1001","role":"authenticated"}', true);
SELECT public.admin_add_onsite_registration((SELECT season_id FROM ctx), NULL, 'Walk', 'Bibreg', '2016-03-03', 10, 700, 'Walk-up') AS walk \gset
RESET ROLE;
INSERT INTO public.players (first_name, last_name) VALUES ('Has', 'Bibreg');
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number)
  SELECT id, (SELECT season_id FROM ctx), 9, 500 FROM public.players WHERE first_name = 'Has' AND last_name = 'Bibreg';

INSERT INTO public.import_batches (import_type, source_file_name, rows_received, season_id)
  VALUES ('players', 'bibreg.csv', 5, (SELECT season_id FROM ctx)) RETURNING id AS batch \gset
INSERT INTO public.sports_connect_import_rows (import_batch_id, source_row_number, first_name, last_name, birth_date, external_player_id, registration_number, payment_status, league_age, review_state, matched_player_id) VALUES
  (:batch, 2, 'Num', 'Bibreg', '2017-01-01', 'BR1', ' 412 ', 'Paid', 9, 'approved_new', NULL),
  (:batch, 3, 'Taken', 'Bibreg', '2017-01-02', 'BR2', '500', 'Paid', 9, 'approved_new', NULL),
  (:batch, 4, 'Text', 'Bibreg', '2017-01-03', 'BR3', 'REG-77', 'Paid', 9, 'approved_new', NULL),
  (:batch, 5, 'Blank', 'Bibreg', '2017-01-04', 'BR4', '', 'Paid', 9, 'approved_new', NULL),
  (:batch, 6, 'Walk', 'Bibreg', '2016-03-03', 'BR5', '701', 'Paid', 10, 'approved_match', (SELECT player_id FROM public.player_seasons WHERE id = :walk));

CREATE FUNCTION pg_temp.commit(p_first text) RETURNS bigint LANGUAGE sql AS $$
  SELECT public.commit_sports_connect_import_row(
    (SELECT id FROM public.sports_connect_import_rows WHERE last_name = 'Bibreg' AND first_name = p_first), 'Bib from registration check');
$$;
GRANT EXECUTE ON FUNCTION pg_temp.commit(text) TO authenticated;
CREATE FUNCTION pg_temp.bib(p_first text) RETURNS integer LANGUAGE sql AS $$
  SELECT ps.evaluation_number FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id
  WHERE p.last_name = 'Bibreg' AND p.first_name = p_first AND ps.season_id = (SELECT season_id FROM ctx);
$$;
CREATE FUNCTION pg_temp.note(p_first text) RETURNS text LANGUAGE sql AS $$
  SELECT a.after_data->>'bib_note' FROM public.audit_log a
  WHERE a.action = 'sports_connect_import_row_committed'
    AND a.target_id = (SELECT id::text FROM public.sports_connect_import_rows WHERE last_name = 'Bibreg' AND first_name = p_first);
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000b1001","role":"authenticated"}', true);
SELECT pg_temp.commit('Num'), pg_temp.commit('Taken'), pg_temp.commit('Text'), pg_temp.commit('Blank'), pg_temp.commit('Walk');
RESET ROLE;

SELECT pg_temp.check(pg_temp.bib('Num') = 412, 'a numeric Registration Number becomes the bib (spaces trimmed)');
SELECT pg_temp.check(pg_temp.bib('Taken') IS NULL AND pg_temp.note('Taken') LIKE 'Bib 500 is already used%', 'a Registration Number already used as a bib is not reused; the row still commits and the audit says why');
SELECT pg_temp.check(pg_temp.bib('Text') IS NULL AND pg_temp.note('Text') LIKE '%REG-77 is not a whole number%', 'a non-numeric Registration Number leaves the bib blank, with a note');
SELECT pg_temp.check(pg_temp.bib('Blank') IS NULL AND pg_temp.note('Blank') IS NULL, 'a blank Registration Number leaves the bib blank');
SELECT pg_temp.check(pg_temp.bib('Walk') = 700, 'a walk-up keeps the bib given on site');
SELECT pg_temp.check((SELECT external_registration_id = '412' FROM public.player_seasons WHERE id = (SELECT committed_player_season_id FROM public.sports_connect_import_rows WHERE first_name = 'Num' AND last_name = 'Bibreg')),
  'the Registration Number is still saved with the registration');
SELECT pg_temp.check((SELECT (a.after_data->>'evaluation_number')::int = 412 FROM public.audit_log a
                      WHERE a.action = 'sports_connect_import_row_committed'
                        AND a.target_id = (SELECT id::text FROM public.sports_connect_import_rows WHERE first_name = 'Num' AND last_name = 'Bibreg')),
  'the audit entry records the bib that was set');

ROLLBACK;
