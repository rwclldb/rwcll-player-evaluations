-- Age charts per season (decided 2026-11-23). An admin uploads the official Little League age chart for each season
-- (the CSV the league gets: JAN..DEC columns of birth years, then AGE); the app reads it where it works out a league
-- age from a birthdate (the registration import preview, the player edit page) and lists players whose age doesn't
-- match it. It doesn't change anyone's age by itself.
--
-- * season_age_charts: one row per birth year and month. Read through the functions below only.
-- * admin_save_age_chart(season, rows, file name): admins replace the whole chart (audited with the old and new row
--   counts). Each birth month once; ages 4-18; refused in a closed season.
-- * season_age_chart(season): the chart and who uploaded it, for admins and registrars of the season.
-- * age_chart_mismatches(season): registrations whose league age differs from the chart for their birthdate (compared
--   in the database; birthdates are never returned).
-- * Seasons starting in 2027 that exist now get the built-in 2027 chart (lib/data/age-chart-2027.json).

CREATE TABLE public.season_age_charts (
  season_id bigint NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  birth_year integer NOT NULL CHECK (birth_year BETWEEN 1990 AND 2100),
  birth_month integer NOT NULL CHECK (birth_month BETWEEN 1 AND 12),
  league_age integer NOT NULL CHECK (league_age BETWEEN 4 AND 18),
  PRIMARY KEY (season_id, birth_year, birth_month)
);
CREATE TABLE public.season_age_chart_uploads (
  season_id bigint PRIMARY KEY REFERENCES public.seasons(id) ON DELETE CASCADE,
  file_name text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.season_age_charts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_age_chart_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.season_age_charts, public.season_age_chart_uploads FROM anon, authenticated;

CREATE FUNCTION public.admin_save_age_chart(p_season_id bigint, p_rows jsonb, p_file_name text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_closed boolean;
  v_before integer;
  v_n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only league admins can upload the age chart.' USING ERRCODE = '42501';
  END IF;
  SELECT is_closed INTO v_closed FROM public.seasons WHERE id = p_season_id;
  IF v_closed IS NULL THEN RAISE EXCEPTION 'Season not found.'; END IF;
  IF v_closed THEN RAISE EXCEPTION 'This season is closed.'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 OR jsonb_array_length(p_rows) > 600 THEN
    RAISE EXCEPTION 'The chart has no rows.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS x(birth_year integer, birth_month integer, league_age integer)
             WHERE birth_year IS NULL OR birth_month IS NULL OR league_age IS NULL
                OR birth_year NOT BETWEEN 1990 AND 2100 OR birth_month NOT BETWEEN 1 AND 12 OR league_age NOT BETWEEN 4 AND 18) THEN
    RAISE EXCEPTION 'Every row needs a birth year, a month from 1 to 12 and an age from 4 to 18.';
  END IF;
  IF (SELECT count(*) FROM jsonb_to_recordset(p_rows) AS x(birth_year integer, birth_month integer))
     <> (SELECT count(DISTINCT (birth_year, birth_month)) FROM jsonb_to_recordset(p_rows) AS x(birth_year integer, birth_month integer)) THEN
    RAISE EXCEPTION 'A birth month appears twice in the chart.';
  END IF;
  SELECT count(*) INTO v_before FROM public.season_age_charts WHERE season_id = p_season_id;
  DELETE FROM public.season_age_charts WHERE season_id = p_season_id;
  INSERT INTO public.season_age_charts (season_id, birth_year, birth_month, league_age)
  SELECT p_season_id, birth_year, birth_month, league_age FROM jsonb_to_recordset(p_rows) AS x(birth_year integer, birth_month integer, league_age integer);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.season_age_chart_uploads (season_id, file_name, uploaded_by) VALUES (p_season_id, left(p_file_name, 200), auth.uid())
  ON CONFLICT (season_id) DO UPDATE SET file_name = EXCLUDED.file_name, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now();
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, before_data, after_data)
  VALUES (auth.uid(), 'age_chart_uploaded', 'seasons', p_season_id::text, jsonb_build_object('rows', v_before),
          jsonb_build_object('rows', v_n, 'file', p_file_name,
            'ages', (SELECT jsonb_agg(DISTINCT league_age ORDER BY league_age) FROM public.season_age_charts WHERE season_id = p_season_id)));
  RETURN v_n;
END $$;

CREATE FUNCTION public.season_age_chart(p_season_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_register(p_season_id) THEN
    RAISE EXCEPTION 'Only admins and registrars can see the age chart.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'rows', (SELECT COALESCE(jsonb_agg(jsonb_build_object('birth_year', birth_year, 'birth_month', birth_month, 'league_age', league_age)
              ORDER BY league_age, birth_month), '[]') FROM public.season_age_charts WHERE season_id = p_season_id),
    'upload', (SELECT jsonb_build_object('file_name', u.file_name, 'uploaded_at', u.uploaded_at, 'by', private.person_name(u.uploaded_by))
               FROM public.season_age_chart_uploads u WHERE u.season_id = p_season_id));
END $$;

-- Registrations whose league age isn't what the chart says for their birthdate. Birthdates stay in the database.
CREATE FUNCTION public.age_chart_mismatches(p_season_id bigint)
RETURNS TABLE (player_season_id bigint, first_name text, last_name text, bib integer, league_age integer, chart_age integer, age_source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_register(p_season_id) THEN
    RAISE EXCEPTION 'Only admins and registrars can check ages.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT ps.id, p.first_name, p.last_name, ps.evaluation_number, ps.league_age, c.league_age, ps.league_age_source
  FROM public.player_seasons ps
  JOIN public.players p ON p.id = ps.player_id
  JOIN public.season_age_charts c ON c.season_id = ps.season_id
    AND c.birth_year = extract(year FROM p.date_of_birth)::int AND c.birth_month = extract(month FROM p.date_of_birth)::int
  WHERE ps.season_id = p_season_id AND p.date_of_birth IS NOT NULL AND ps.league_age IS DISTINCT FROM c.league_age
  ORDER BY p.last_name, p.first_name;
END $$;

REVOKE ALL ON FUNCTION public.admin_save_age_chart(bigint, jsonb, text), public.season_age_chart(bigint), public.age_chart_mismatches(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_age_chart(bigint, jsonb, text), public.season_age_chart(bigint), public.age_chart_mismatches(bigint) TO authenticated;

-- The built-in 2027 chart for seasons starting in 2027 that exist now (the fixture loader uploads it for new ones).
INSERT INTO public.season_age_charts (season_id, birth_year, birth_month, league_age)
SELECT s.id, x.y, x.m, x.a
FROM public.seasons s
CROSS JOIN (VALUES
    (2023, 1, 4), (2023, 2, 4), (2023, 3, 4), (2023, 4, 4), (2023, 5, 4), (2023, 6, 4), (2023, 7, 4), (2023, 8, 4), (2022, 9, 4), (2022, 10, 4), (2022, 11, 4), (2022, 12, 4),
    (2022, 1, 5), (2022, 2, 5), (2022, 3, 5), (2022, 4, 5), (2022, 5, 5), (2022, 6, 5), (2022, 7, 5), (2022, 8, 5), (2021, 9, 5), (2021, 10, 5), (2021, 11, 5), (2021, 12, 5),
    (2021, 1, 6), (2021, 2, 6), (2021, 3, 6), (2021, 4, 6), (2021, 5, 6), (2021, 6, 6), (2021, 7, 6), (2021, 8, 6), (2020, 9, 6), (2020, 10, 6), (2020, 11, 6), (2020, 12, 6),
    (2020, 1, 7), (2020, 2, 7), (2020, 3, 7), (2020, 4, 7), (2020, 5, 7), (2020, 6, 7), (2020, 7, 7), (2020, 8, 7), (2019, 9, 7), (2019, 10, 7), (2019, 11, 7), (2019, 12, 7),
    (2019, 1, 8), (2019, 2, 8), (2019, 3, 8), (2019, 4, 8), (2019, 5, 8), (2019, 6, 8), (2019, 7, 8), (2019, 8, 8), (2018, 9, 8), (2018, 10, 8), (2018, 11, 8), (2018, 12, 8),
    (2018, 1, 9), (2018, 2, 9), (2018, 3, 9), (2018, 4, 9), (2018, 5, 9), (2018, 6, 9), (2018, 7, 9), (2018, 8, 9), (2017, 9, 9), (2017, 10, 9), (2017, 11, 9), (2017, 12, 9),
    (2017, 1, 10), (2017, 2, 10), (2017, 3, 10), (2017, 4, 10), (2017, 5, 10), (2017, 6, 10), (2017, 7, 10), (2017, 8, 10), (2016, 9, 10), (2016, 10, 10), (2016, 11, 10), (2016, 12, 10),
    (2016, 1, 11), (2016, 2, 11), (2016, 3, 11), (2016, 4, 11), (2016, 5, 11), (2016, 6, 11), (2016, 7, 11), (2016, 8, 11), (2015, 9, 11), (2015, 10, 11), (2015, 11, 11), (2015, 12, 11),
    (2015, 1, 12), (2015, 2, 12), (2015, 3, 12), (2015, 4, 12), (2015, 5, 12), (2015, 6, 12), (2015, 7, 12), (2015, 8, 12), (2014, 9, 12), (2014, 10, 12), (2014, 11, 12), (2014, 12, 12),
    (2014, 1, 13), (2014, 2, 13), (2014, 3, 13), (2014, 4, 13), (2014, 5, 13), (2014, 6, 13), (2014, 7, 13), (2014, 8, 13), (2013, 9, 13), (2013, 10, 13), (2013, 11, 13), (2013, 12, 13),
    (2013, 1, 14), (2013, 2, 14), (2013, 3, 14), (2013, 4, 14), (2013, 5, 14), (2013, 6, 14), (2013, 7, 14), (2013, 8, 14), (2012, 9, 14), (2012, 10, 14), (2012, 11, 14), (2012, 12, 14),
    (2012, 1, 15), (2012, 2, 15), (2012, 3, 15), (2012, 4, 15), (2012, 5, 15), (2012, 6, 15), (2012, 7, 15), (2012, 8, 15), (2011, 9, 15), (2011, 10, 15), (2011, 11, 15), (2011, 12, 15),
    (2011, 1, 16), (2011, 2, 16), (2011, 3, 16), (2011, 4, 16), (2011, 5, 16), (2011, 6, 16), (2011, 7, 16), (2011, 8, 16), (2010, 9, 16), (2010, 10, 16), (2010, 11, 16), (2010, 12, 16)
) AS x(y, m, a)
WHERE extract(year FROM s.start_date) = 2027
  AND NOT EXISTS (SELECT 1 FROM public.season_age_charts c WHERE c.season_id = s.id);
INSERT INTO public.season_age_chart_uploads (season_id, file_name)
SELECT DISTINCT season_id, 'built-in 2027 chart' FROM public.season_age_charts ON CONFLICT DO NOTHING;
