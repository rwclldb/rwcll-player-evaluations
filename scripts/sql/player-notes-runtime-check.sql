-- Runtime check: coach private notes and independent-evaluator shared notes. Rolled back.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000fa001', 'pn-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000fc001', 'pn-coach-a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000fc002', 'pn-coach-b@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000fe001', 'pn-eval@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000fc003', 'pn-other-season-coach@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('PN check season', '2099-01-01', '2099-06-30'), ('PN other season', '2098-01-01', '2098-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS
  SELECT (SELECT id FROM public.seasons WHERE name = 'PN check season') AS season_id, (SELECT id FROM public.seasons WHERE name = 'PN other season') AS other_season_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000fa001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000fc001', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000fc002', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000fe001', 'independent_evaluator', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000fc003', 'coach', (SELECT other_season_id FROM ctx));
INSERT INTO public.players (first_name, last_name) VALUES ('Pn', 'Alpha'), ('Pn', 'Beta');
INSERT INTO public.player_seasons (player_id, season_id, league_age, evaluation_number)
  SELECT id, (SELECT season_id FROM ctx), 10, CASE last_name WHEN 'Alpha' THEN 601 ELSE 602 END FROM public.players WHERE first_name = 'Pn';
INSERT INTO public.evaluation_sessions (season_id, league_age, status) VALUES ((SELECT season_id FROM ctx), 10, 'setup');
ALTER TABLE ctx ADD COLUMN session_id bigint, ADD COLUMN alpha bigint, ADD COLUMN beta bigint;
UPDATE ctx SET session_id = (SELECT id FROM public.evaluation_sessions WHERE season_id = ctx.season_id),
  alpha = (SELECT ps.id FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Alpha' AND ps.season_id = ctx.season_id),
  beta = (SELECT ps.id FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE p.last_name = 'Beta' AND ps.season_id = ctx.season_id);
INSERT INTO public.evaluation_session_events (evaluation_session_id, event_type, event_date, start_time, end_time, location)
  SELECT session_id, 'primary', '2099-01-23', '09:00', '10:30', 'Check Field' FROM ctx;
INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type)
  SELECT session_id, '00000000-0000-4000-8000-0000000fc001'::uuid, 'coach' FROM ctx
  UNION ALL SELECT session_id, '00000000-0000-4000-8000-0000000fc002'::uuid, 'coach' FROM ctx
  UNION ALL SELECT session_id, '00000000-0000-4000-8000-0000000fe001'::uuid, 'independent_evaluator' FROM ctx;
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
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF; RAISE NOTICE 'PASS: %', p_label; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text) TO authenticated;
CREATE FUNCTION pg_temp.notes(p_kind text) RETURNS TABLE (player_season_id bigint, note_text text, author_label text, is_mine boolean) LANGUAGE sql AS $$
  SELECT n.player_season_id, n.note_text, n.author_label, n.is_mine FROM public.player_notes((SELECT session_id FROM ctx)) n WHERE n.kind = p_kind;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.notes(text) TO authenticated;

SET LOCAL ROLE authenticated;

-- ---------- coach private notes ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fc001');
SELECT public.save_private_note((SELECT alpha FROM ctx), '  Coach A: strong arm  ');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fc002');
SELECT public.save_private_note((SELECT alpha FROM ctx), 'Coach B: hesitant on grounders');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fc001');
SELECT pg_temp.check((SELECT count(*) = 1 AND min(note_text) = 'Coach A: strong arm' FROM pg_temp.notes('private')),
  'coach sees only their own private note (trimmed)');
SELECT pg_temp.check((SELECT count(*) = 1 FROM public.my_notes() WHERE kind = 'private' AND editable), 'coach''s private note is listed on My Notes and editable');
SELECT pg_temp.expect_error('SELECT count(*) FROM public.private_notes', 'permission denied', 'coaches cannot read the private notes table directly');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fa001');
SELECT pg_temp.check((SELECT count(*) = 0 FROM pg_temp.notes('private')), 'admin cannot read coaches'' private notes');
SELECT pg_temp.expect_error('SELECT count(*) FROM public.private_notes', 'permission denied', 'admin cannot read the private notes table directly');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fe001');
SELECT pg_temp.expect_error(format('SELECT public.save_private_note(%s, %L)', (SELECT alpha FROM ctx), 'x'), 'for coaches', 'independent evaluator cannot write a private note');
SELECT pg_temp.check((SELECT count(*) = 0 FROM pg_temp.notes('private')), 'independent evaluator sees no private notes');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fc003');
SELECT pg_temp.expect_error(format('SELECT public.save_private_note(%s, %L)', (SELECT alpha FROM ctx), 'x'), 'for coaches', 'coach from another season cannot write a note on this season''s player');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fc001');
SELECT pg_temp.expect_error(format('SELECT public.save_private_note(%s, %L)', (SELECT alpha FROM ctx), repeat('x', 2001)), 'at most 2000', 'notes over 2000 characters are rejected');

-- ---------- independent-evaluator shared notes ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fe001');
SELECT pg_temp.expect_error(format('SELECT public.save_shared_note(%s, %s, %L)', (SELECT session_id FROM ctx), (SELECT alpha FROM ctx), 'x'), 'Save the evaluation', 'shared note needs a saved evaluation first');
SELECT public.save_evaluation((SELECT session_id FROM ctx), (SELECT alpha FROM ctx), '{"hitting":3}', '{}', 'submitted');
SELECT public.save_shared_note((SELECT session_id FROM ctx), (SELECT alpha FROM ctx), 'Quick feet, good hustle');
SELECT public.save_evaluation((SELECT session_id FROM ctx), (SELECT beta FROM ctx), '{"hitting":2}', '{}', 'draft');
SELECT public.save_shared_note((SELECT session_id FROM ctx), (SELECT beta FROM ctx), 'Draft-only note');
SELECT pg_temp.check((SELECT count(*) = 2 AND bool_and(author_label = 'You' AND is_mine) FROM pg_temp.notes('shared')), 'evaluator sees their own shared notes');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fc001');
SELECT public.save_evaluation((SELECT session_id FROM ctx), (SELECT alpha FROM ctx), '{"hitting":4}', '{}', 'submitted');
SELECT pg_temp.expect_error(format('SELECT public.save_shared_note(%s, %s, %L)', (SELECT session_id FROM ctx), (SELECT alpha FROM ctx), 'x'), 'for independent evaluators', 'coach cannot write a shared note');
SELECT pg_temp.check((SELECT count(*) = 0 FROM pg_temp.notes('shared')), 'before release: coach sees no evaluator notes');
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.evaluator_notes), 'coach cannot read the evaluator notes table directly');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fa001');
SELECT pg_temp.check((SELECT count(*) = 2 AND bool_and(author_label = 'pn-eval@example.test') FROM pg_temp.notes('shared')), 'admin sees all evaluator notes with the author, before release');

-- ---------- lock ----------
SELECT public.change_evaluation_session_stage((SELECT session_id FROM ctx), 'lock');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fe001');
SELECT pg_temp.expect_error(format('SELECT public.save_shared_note(%s, %s, %L)', (SELECT session_id FROM ctx), (SELECT alpha FROM ctx), 'changed'), 'locked', 'shared notes lock with the session');
SELECT pg_temp.check((SELECT count(*) = 2 AND NOT bool_or(editable) FROM public.my_notes()), 'after lock: evaluator''s notes are listed read-only');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fc001');
SELECT public.save_private_note((SELECT alpha FROM ctx), 'Coach A: strong arm; ask about pitching');
SELECT pg_temp.check((SELECT min(note_text) = 'Coach A: strong arm; ask about pitching' FROM pg_temp.notes('private')), 'after lock: coach can still edit their private note');
SELECT public.save_private_note((SELECT beta FROM ctx), 'Coach A: new note after lock');
SELECT pg_temp.check((SELECT count(*) = 2 FROM pg_temp.notes('private')), 'after lock: coach can add a new private note');

-- ---------- release ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fa001');
SELECT public.change_evaluation_session_stage((SELECT session_id FROM ctx), 'release');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fc002');
SELECT pg_temp.check((SELECT count(*) = 1 AND min(note_text) = 'Quick feet, good hustle' AND min(author_label) = 'Independent evaluator' FROM pg_temp.notes('shared')),
  'after release: coach sees the submitted evaluator note, labelled only "Independent evaluator"');
SELECT pg_temp.check((SELECT bool_and(position('pn-eval' IN row_to_json(n)::text) = 0 AND position('0000000fe001' IN row_to_json(n)::text) = 0) FROM public.player_notes((SELECT session_id FROM ctx)) n),
  'coach never sees the evaluator''s name, email, or id');
SELECT pg_temp.check((SELECT count(*) = 1 AND min(note_text) = 'Coach B: hesitant on grounders' FROM pg_temp.notes('private')), 'after release: coach B still sees only their own private note');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fc003');
SELECT pg_temp.check((SELECT count(*) = 0 FROM public.player_notes((SELECT session_id FROM ctx))), 'coach from another season sees no notes');

-- ---------- delete ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000fc001');
SELECT public.save_private_note((SELECT beta FROM ctx), '   ');
SELECT pg_temp.check((SELECT count(*) = 1 FROM pg_temp.notes('private')), 'saving a blank private note deletes it');

ROLLBACK;
