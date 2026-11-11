-- Runtime check: registration admin, on-site players, bib upload, and prior-year upload. Rolled back.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000aa001', 'ss-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ac001', 'ss-coach@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('SS check season', '2099-01-01', '2099-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT (SELECT id FROM public.seasons WHERE name = 'SS check season') AS season_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000aa001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000ac001', 'coach', (SELECT season_id FROM ctx));
-- Ann (Player Id SS1, bib 11), Ben (SS2, no bib), Cal (SS3, bib 13), Dee (no birthdate, no age)
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES
  ('Ann', 'Sstest', '2017-03-01'), ('Ben', 'Sstest', '2017-04-01'), ('Cal', 'Sstest', '2017-05-01'), ('Dee', 'Sstest', NULL);
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number, external_player_id)
  SELECT p.id, (SELECT season_id FROM ctx),
         CASE p.first_name WHEN 'Dee' THEN NULL ELSE 10 END,
         CASE p.first_name WHEN 'Ann' THEN 11 WHEN 'Cal' THEN 13 END,
         CASE p.first_name WHEN 'Ann' THEN 'SS1' WHEN 'Ben' THEN 'SS2' WHEN 'Cal' THEN 'SS3' END
  FROM public.players p WHERE p.last_name = 'Sstest';
CREATE FUNCTION pg_temp.reg(p_first text) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
  SELECT ps.id FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id
  WHERE p.first_name = p_first AND p.last_name = 'Sstest' AND ps.season_id = (SELECT season_id FROM ctx);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.reg(text) TO authenticated;

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
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF; RAISE NOTICE 'PASS: %', p_label; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text) TO authenticated;

SET LOCAL ROLE authenticated;

-- ---------- registration admin ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ac001');
SELECT pg_temp.expect_error(format('SELECT public.admin_save_registration(%s, %L, %L, NULL, 10, 99, NULL)', pg_temp.reg('Ben'), 'Ben', 'Sstest'),
  'Administrator access required', 'coaches cannot edit registrations');
SELECT pg_temp.expect_error(format('SELECT public.stage_bib_import(%s, %L, %L::jsonb)', (SELECT season_id FROM ctx), 'x.csv', '[{"player_id":"SS2","bib":"5"}]'),
  'Administrator access required', 'coaches cannot upload bibs');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000aa001');
SELECT pg_temp.expect_error(format('SELECT public.admin_save_registration(%s, %L, %L, %L, 10, NULL, NULL)', pg_temp.reg('Ben'), 'Benjamin', 'Sstest', '2017-04-01'),
  'Give a reason', 'renaming a player needs a reason');
SELECT public.admin_save_registration(pg_temp.reg('Ben'), 'Ben', 'Sstest', '2017-04-01', 10, 12, NULL);
SELECT pg_temp.check((SELECT evaluation_number = 12 FROM public.player_seasons WHERE id = pg_temp.reg('Ben')), 'admin sets a bib by hand (no reason needed)');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.audit_log WHERE action = 'registration_admin_update' AND target_id = pg_temp.reg('Ben')::text), 'bib edit is audited');
SELECT pg_temp.expect_error(format('SELECT public.admin_save_registration(%s, %L, %L, %L, 10, 11, NULL)', pg_temp.reg('Ben'), 'Ben', 'Sstest', '2017-04-01'),
  'already used by Ann Sstest', 'a bib already in use this season is refused, naming the player');
SELECT public.admin_save_registration(pg_temp.reg('Dee'), 'Dee', 'Sstest', NULL, 9, NULL, 'No birthdate; parent says 9');
SELECT pg_temp.check((SELECT league_age = 9 AND league_age_source = 'admin' FROM public.player_seasons WHERE id = pg_temp.reg('Dee')),
  'admin sets the age group for a player with no birthdate (marked as set by admin)');

-- ---------- on-site players ----------
SELECT public.admin_add_onsite_registration((SELECT season_id FROM ctx), NULL, 'Eve', 'Sstest', '2016-02-02', 11, 20, 'Walk-up at evaluations') AS eve \gset
SELECT pg_temp.check((SELECT registration_source = 'on_site' AND external_player_id IS NULL AND evaluation_number = 20 FROM public.player_seasons WHERE id = :eve),
  'admin adds a walk-up player on site with a bib');
SELECT pg_temp.expect_error(format('SELECT public.admin_add_onsite_registration(%s, %s, NULL, NULL, NULL, 11, NULL, %L)',
  (SELECT season_id FROM ctx), (SELECT player_id FROM public.player_seasons WHERE id = :eve), 'Walk-up again'),
  'already registered this season', 'the same player cannot be added twice in a season');
-- Later, Sports Connect lists Eve. The admin approves the match to the on-site player and commits.
RESET ROLE;
INSERT INTO public.import_batches (import_type, source_file_name, rows_received, season_id) VALUES ('players', 'ss-late.csv', 1, (SELECT season_id FROM ctx)) RETURNING id AS sc_batch \gset
INSERT INTO public.sports_connect_import_rows (import_batch_id, source_row_number, first_name, last_name, birth_date, external_player_id, registration_number, payment_status, league_age, review_state, matched_player_id)
  VALUES (:sc_batch, 2, 'Eve', 'Sstest', '2016-02-02', 'SS5', 'REG-5', 'Paid', 11, 'approved_match', (SELECT player_id FROM public.player_seasons WHERE id = :eve)) RETURNING id AS sc_row \gset
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000aa001');
SELECT pg_temp.check(public.commit_sports_connect_import_row(:sc_row, 'Late Sports Connect registration') = :eve, 'import commit links to the on-site registration instead of failing');
SELECT pg_temp.check((SELECT external_player_id = 'SS5' AND registration_source = 'sports_connect' AND evaluation_number = 20 AND registration_payment_status = 'Paid'
                      FROM public.player_seasons WHERE id = :eve), 'linked registration gets the Player Id and keeps its bib');

-- ---------- bib upload ----------
SELECT public.stage_bib_import((SELECT season_id FROM ctx), 'ss-bibs.csv', '[
  {"player_id":"SS3","bib":"30"},
  {"first_name":"Dee","last_name":"Sstest","birth_date":null,"bib":"31"},
  {"player_id":"SS1","bib":"11"},
  {"player_id":"SS2","bib":"20"},
  {"player_id":"SS9","bib":"32"},
  {"player_id":"SS1","bib":"33"},
  {"player_id":"SS3","bib":"x1"},
  {"player_id":"","first_name":"","bib":"34"}
]'::jsonb) AS bib_batch \gset
SELECT pg_temp.check((SELECT string_agg(source_row_number || ':' || status || COALESCE('/' || change_kind, ''), ' ' ORDER BY source_row_number)
                      FROM public.bib_import_rows WHERE import_batch_id = :bib_batch)
                     = '1:ready/change 2:held 3:ready/same 4:ready/conflict 5:held 6:invalid 7:invalid 8:invalid',
  'bib upload preview: change, held (no birthdate), same, conflict (Eve has 20), held (unknown Id), same player twice, bad bib, no identity');
SELECT pg_temp.check(public.apply_bib_import(:bib_batch, ARRAY[(SELECT id FROM public.bib_import_rows WHERE import_batch_id = :bib_batch AND source_row_number = 1)]) = 1,
  'applying sets only the accepted change');
SELECT pg_temp.check((SELECT evaluation_number = 30 FROM public.player_seasons WHERE id = pg_temp.reg('Cal'))
                     AND (SELECT evaluation_number = 12 FROM public.player_seasons WHERE id = pg_temp.reg('Ben')),
  'Cal moved to 30; Ben kept 12 (conflict skipped)');
-- A player with Player Id SS9 registers later; the held row now matches.
RESET ROLE;
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Fay', 'Sstest', '2016-06-06');
INSERT INTO public.player_seasons (player_id, season_id, league_age, external_player_id)
  SELECT id, (SELECT season_id FROM ctx), 11, 'SS9' FROM public.players WHERE first_name = 'Fay' AND last_name = 'Sstest';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000aa001');
SELECT pg_temp.check(public.recheck_bib_import(:bib_batch) = 1, 're-check matches the held row after the player registers');
SELECT public.apply_bib_import(:bib_batch, '{}');
SELECT pg_temp.check((SELECT evaluation_number = 32 FROM public.player_seasons WHERE id = pg_temp.reg('Fay')), 'held bib is applied after re-check');
SELECT pg_temp.check((SELECT count(*) = 2 FROM public.audit_log WHERE action = 'bib_import_applied' AND target_id = :'bib_batch'), 'each bib apply is audited');

-- ---------- prior-year upload ----------
SELECT public.stage_prior_year_import((SELECT season_id FROM ctx), 'ss-prior.csv', '[
  {"player_id":"SS1","first_name":"Ann","last_name":"Sstest","birth_date":"2017-03-01","season":"Spring 2098","division":"AAA","coach_name":"Coach X","ratings":{"hitting":4,"throwing":3}},
  {"player_id":"SS2","first_name":"Benny","last_name":"Sstest","birth_date":"2017-04-01","season":"Spring 2098","division":"AAA","coach_name":"Coach X","ratings":{"hitting":2}},
  {"player_id":"ZZ","first_name":"Gone","last_name":"Sstest","birth_date":"2015-01-01","season":"Spring 2098","division":"AAA","coach_name":"Coach X","ratings":{"hitting":5}},
  {"player_id":"SS3","first_name":"Cal","last_name":"Sstest","birth_date":"2017-05-01","season":"Spring 2098","division":"AAA","coach_name":"Coach X","ratings":{"hitting":7}}
]'::jsonb) AS py_batch \gset
SELECT pg_temp.check((SELECT string_agg(source_row_number || ':' || match_status, ' ' ORDER BY source_row_number)
                      FROM public.historical_evaluation_import_rows WHERE import_batch_id = :py_batch) = '1:matched 2:review 3:held 4:invalid',
  'prior-year preview: exact match, name differs (review), unknown player (held), score 7 (rejected)');
SELECT pg_temp.check(public.import_prior_year_rows(:py_batch, (SELECT jsonb_agg(jsonb_build_object('row_id', id, 'player_id', candidate_player_ids[1]))
                       FROM public.historical_evaluation_import_rows WHERE import_batch_id = :py_batch AND match_status IN ('matched', 'review'))) = 2,
  'admin imports the matched row and confirms the review row');
SELECT pg_temp.check((SELECT count(*) = 2 FROM public.historical_evaluations he JOIN public.player_seasons ps ON ps.player_id = he.player_id
                      WHERE ps.id IN (pg_temp.reg('Ann'), pg_temp.reg('Ben')) AND he.source_season_label = 'Spring 2098'),
  'prior-year ratings land on the right players');
SELECT pg_temp.expect_error(format('SELECT public.import_prior_year_rows(%s, %L::jsonb)', :py_batch,
  json_build_array(json_build_object('row_id', (SELECT id FROM public.historical_evaluation_import_rows WHERE import_batch_id = :py_batch AND source_row_number = 3), 'player_id', (SELECT player_id FROM public.player_seasons WHERE id = pg_temp.reg('Cal'))))::text),
  'can''t be imported for that player', 'a held row cannot be forced onto an arbitrary player');
SELECT public.stage_prior_year_import((SELECT season_id FROM ctx), 'ss-prior-again.csv', '[
  {"player_id":"SS1","first_name":"Ann","last_name":"Sstest","birth_date":"2017-03-01","season":"Spring 2098","division":"AAA","coach_name":"Coach X","ratings":{"hitting":4}}
]'::jsonb) AS py_again \gset
SELECT pg_temp.check((SELECT match_status = 'invalid' FROM public.historical_evaluation_import_rows WHERE import_batch_id = :py_again), 'uploading the same rating again is rejected');
SELECT pg_temp.check(public.dismiss_prior_year_rows(:py_batch, ARRAY[(SELECT id FROM public.historical_evaluation_import_rows WHERE import_batch_id = :py_batch AND source_row_number = 3)], 'Not returning this season') = 1,
  'admin dismisses a held row for a player who is not returning');
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.players WHERE first_name = 'Gone'), 'no player is ever created from a prior-year row');

-- ---------- bulk import review ----------
RESET ROLE;
INSERT INTO public.import_batches (import_type, source_file_name, rows_received, season_id) VALUES ('players', 'ss-bulk.csv', 3, (SELECT season_id FROM ctx)) RETURNING id AS bulk_batch \gset
INSERT INTO public.sports_connect_import_rows (import_batch_id, source_row_number, first_name, last_name, birth_date, external_player_id, source_program, source_division, league_age, review_flags) VALUES
  (:bulk_batch, 2, 'Gus', 'Bulktest', '2017-07-07', 'BK1', 'Baseball', 'AA', 10, '["Payment status needs review"]'),
  (:bulk_batch, 3, 'Ann', 'Sstest', '2017-08-08', 'BK2', 'Baseball', 'AA', 10, '[]'),
  (:bulk_batch, 4, 'Tee', 'Bulktest', '2021-01-01', 'BK3', 'Tee Ball', 'Tee Ball', NULL, '["Division needs review"]');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000aa001');
SELECT pg_temp.check(public.bulk_ignore_out_of_scope_import_rows(:bulk_batch, 'Out-of-scope program') = 1, 'bulk ignore skips only the out-of-scope row');
SELECT pg_temp.check(public.bulk_commit_clean_import_rows(:bulk_batch, 'Clean registration') = 1
                     AND (SELECT review_state FROM public.sports_connect_import_rows WHERE import_batch_id = :bulk_batch AND first_name = 'Ann') = 'needs_review',
  'bulk commit takes the clean row and leaves a same-name row for review');

-- ---------- people admin ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ac001');
SELECT pg_temp.expect_error(format('SELECT public.admin_grant_role(%L, %L, %s)', '00000000-0000-4000-8000-0000000ac001', 'independent_evaluator', (SELECT season_id FROM ctx)),
  'Administrator access required', 'coaches cannot give roles');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000aa001');
SELECT pg_temp.expect_error(format('SELECT public.admin_grant_role(%L, %L, %s)', '00000000-0000-4000-8000-0000000ac001', 'independent_evaluator', (SELECT season_id FROM ctx)),
  'both a coach and an independent evaluator', 'one account cannot be coach and evaluator in the same season');
SELECT pg_temp.expect_error(format('SELECT public.admin_revoke_role(%L, %L, NULL)', '00000000-0000-4000-8000-0000000aa001', 'administrator'),
  'your own administrator role', 'admins cannot remove their own admin role');

ROLLBACK;
