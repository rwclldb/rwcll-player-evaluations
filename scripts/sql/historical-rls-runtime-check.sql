-- Runtime RLS check: non-admins cannot read or write historical rating tables directly.
-- Runs entirely inside one transaction that is ALWAYS rolled back. Leaves no data behind.
-- Any failed expectation raises an exception, which aborts psql with a non-zero exit code.
\set ON_ERROR_STOP 1
BEGIN;

-- Fixture users (one per role) and a fixture player/historical evaluation, as postgres.
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'rls-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000c1', 'rls-coach@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000e1', 'rls-evaluator@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000000f1', 'rls-norole@example.test', 'authenticated', 'authenticated');

INSERT INTO public.seasons (name, start_date, end_date)
  VALUES ('RLS check season', '2099-01-01', '2099-06-30');

INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000000c1', 'coach', (SELECT id FROM public.seasons WHERE name = 'RLS check season')),
  ('00000000-0000-4000-8000-0000000000e1', 'independent_evaluator', (SELECT id FROM public.seasons WHERE name = 'RLS check season'));

INSERT INTO public.players (first_name, last_name) VALUES ('Rls', 'Fixture');

INSERT INTO public.historical_evaluations (player_id, source_season_label, source_division_name)
  SELECT id, 'RLS check prior season', 'AAA' FROM public.players WHERE last_name = 'Fixture' AND first_name = 'Rls';

INSERT INTO public.historical_ratings (historical_evaluation_id, category_name, score)
  SELECT id, 'Hitting', 4 FROM public.historical_evaluations WHERE source_season_label = 'RLS check prior season';

-- Run the read/write checks as a given user.
CREATE FUNCTION pg_temp.check_non_admin(p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.historical_evaluations;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % can read % historical_evaluations rows', p_label, n; END IF;

  SELECT count(*) INTO n FROM public.historical_ratings;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % can read % historical_ratings rows', p_label, n; END IF;

  SELECT count(*) INTO n FROM public.historical_evaluation_import_rows;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % can read % historical_evaluation_import_rows rows', p_label, n; END IF;

  UPDATE public.historical_ratings SET score = 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % updated % historical_ratings rows', p_label, n; END IF;

  BEGIN
    INSERT INTO public.historical_evaluations (player_id, source_season_label, source_division_name)
      SELECT id, 'RLS injected', 'AAA' FROM public.players LIMIT 1;
    -- No visible players means nothing inserted; try a direct id too.
    INSERT INTO public.historical_ratings (historical_evaluation_id, category_name, score)
      VALUES ((SELECT max(id) FROM public.historical_evaluations), 'Throwing', 5);
    RAISE EXCEPTION 'FAIL: % inserted into historical tables', p_label;
  EXCEPTION
    WHEN insufficient_privilege OR not_null_violation OR foreign_key_violation THEN NULL; -- blocked, as expected
  END;

  BEGIN
    DELETE FROM public.historical_ratings;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL: % deleted % historical_ratings rows', p_label, n; END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'PASS: % has no direct access to historical tables', p_label;
END;
$$;

GRANT EXECUTE ON FUNCTION pg_temp.check_non_admin(text) TO authenticated, anon;

-- Coach
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
SELECT pg_temp.check_non_admin('coach');
RESET ROLE;

-- Independent evaluator
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
SELECT pg_temp.check_non_admin('independent evaluator');
RESET ROLE;

-- Signed-in user with no role
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', true);
SELECT pg_temp.check_non_admin('user with no role');
RESET ROLE;

-- Anonymous (not signed in): table privileges should deny outright, or RLS should hide rows.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE n bigint;
BEGIN
  BEGIN
    SELECT count(*) INTO n FROM public.historical_ratings;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL: anon can read % historical_ratings rows', n; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'PASS: anon has no access to historical tables';
END $$;
RESET ROLE;

-- Admin must see the fixture (proves the checks above are meaningful, not just an empty table).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.historical_ratings WHERE category_name = 'Hitting';
  IF n < 1 THEN RAISE EXCEPTION 'FAIL: admin cannot read the historical_ratings fixture'; END IF;
  RAISE NOTICE 'PASS: admin can read historical ratings';
END $$;
RESET ROLE;

ROLLBACK;
