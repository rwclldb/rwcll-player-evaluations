-- Runtime check: season age charts. Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-000000090001', 'ac-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000090002', 'ac-registrar@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-000000090003', 'ac-coach@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Chart 2091', '2091-01-01', '2091-06-30') RETURNING id AS s \gset
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Chart 2092', '2092-01-01', '2092-06-30') RETURNING id AS closed \gset
UPDATE public.seasons SET is_closed = true WHERE id = :closed;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-000000090001', 'administrator', NULL), ('00000000-0000-4000-8000-000000090002', 'registrar', :s),
  ('00000000-0000-4000-8000-000000090003', 'coach', :s);
INSERT INTO public.players (first_name, last_name, date_of_birth) VALUES ('Aug', 'Actest', '2079-08-15'), ('Sep', 'Actest', '2079-09-15'), ('None', 'Actest', NULL);
INSERT INTO public.player_seasons (player_id, season_id, league_age) SELECT p.id, :s, 12 FROM public.players p WHERE p.last_name = 'Actest';

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
-- A chart for 2091: ages 11 and 12 (two rows of twelve months).
CREATE FUNCTION pg_temp.chart() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('birth_year', CASE WHEN m <= 8 THEN y ELSE y - 1 END, 'birth_month', m, 'league_age', a))
  FROM (VALUES (2079, 12), (2080, 11)) v(y, a) CROSS JOIN generate_series(1, 12) m;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.chart() TO authenticated;

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-000000090002');
SELECT pg_temp.expect_error(format('SELECT public.admin_save_age_chart(%s, pg_temp.chart(), ''x.csv'')', :s), 'Only league admins', 'a registrar can''t upload the age chart');
SELECT pg_temp.check(jsonb_array_length(public.season_age_chart(:s)->'rows') = 0, 'a season starts with no chart (registrars can look)');
SELECT pg_temp.as_user('00000000-0000-4000-8000-000000090003');
SELECT pg_temp.expect_error(format('SELECT public.season_age_chart(%s)', :s), 'Only admins and registrars', 'a coach can''t see the chart page data');

SELECT pg_temp.as_user('00000000-0000-4000-8000-000000090001');
SELECT pg_temp.expect_error(format('SELECT public.admin_save_age_chart(%s, ''[{"birth_year": 2079, "birth_month": 1, "league_age": 12}, {"birth_year": 2079, "birth_month": 1, "league_age": 11}]'', ''x.csv'')', :s),
  'appears twice', 'a birth month can''t be in the chart twice');
SELECT pg_temp.expect_error(format('SELECT public.admin_save_age_chart(%s, ''[{"birth_year": 2079, "birth_month": 13, "league_age": 12}]'', ''x.csv'')', :s),
  'month from 1 to 12', 'months and ages are checked');
SELECT pg_temp.expect_error(format('SELECT public.admin_save_age_chart(%s, pg_temp.chart(), ''x.csv'')', :closed), 'closed', 'a closed season''s chart can''t change');
SELECT public.admin_save_age_chart(:s, pg_temp.chart(), 'chart-2091.csv') AS saved \gset
SELECT pg_temp.check(:saved = 24 AND public.season_age_chart(:s)->'upload'->>'file_name' = 'chart-2091.csv', 'an admin uploads the chart; the page shows the file name');
SELECT pg_temp.check((SELECT string_agg(first_name || ':' || league_age || '>' || chart_age, ',') FROM public.age_chart_mismatches(:s)) = 'Sep:12>11',
  'players whose age doesn''t match the chart are listed (Sep 2079 is 11); none without a birthdate');
SELECT pg_temp.check(NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proargnames) a WHERE p.proname = 'age_chart_mismatches' AND a ~ 'birth'),
  'the mismatch list returns no birthdates');
SELECT public.admin_save_age_chart(:s, '[{"birth_year": 2079, "birth_month": 9, "league_age": 12}]', 'small.csv');
SELECT pg_temp.check(jsonb_array_length(public.season_age_chart(:s)->'rows') = 1, 'uploading again replaces the whole chart');
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) FROM public.audit_log WHERE action = 'age_chart_uploaded' AND target_id = :'s') = 2, 'each upload is audited');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT count(*) FROM public.season_age_charts', 'permission denied', 'nobody reads the chart table directly');
RESET ROLE;

ROLLBACK;
