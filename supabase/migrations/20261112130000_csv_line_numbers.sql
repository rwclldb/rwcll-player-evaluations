-- Spreadsheet line numbers for bib and prior-year uploads (decided 2026-11-12).
-- The app now sends each row's spreadsheet line ("line": 2 for the first row under the headings, as Excel
-- numbers rows). Staged rows keep that number, so "Line 3" on the review page is row 3 in Excel even when
-- rows were skipped (e.g. players with no prior-year ratings). Without "line", rows are numbered 1, 2, 3 as before.
-- Only the source_row_number expression changes in stage_bib_import and stage_prior_year_import.

CREATE OR REPLACE FUNCTION private.csv_line(p_row jsonb)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE WHEN p_row ->> 'line' ~ '^[0-9]{1,7}$' AND (p_row ->> 'line')::integer > 0 THEN (p_row ->> 'line')::integer END;
$function$;

CREATE OR REPLACE FUNCTION public.stage_bib_import(p_season_id bigint, p_file_name text, p_rows jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_batch_id bigint;
  v_item record;
  v_bib text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = p_season_id AND NOT s.is_closed) THEN
    RAISE EXCEPTION 'Choose an open season.';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'The file has no rows.';
  END IF;
  IF jsonb_array_length(p_rows) > 2000 THEN
    RAISE EXCEPTION 'The file has more than 2000 rows.';
  END IF;

  INSERT INTO public.import_batches (import_type, source_file_name, status, rows_received, created_by, season_id, started_at)
  VALUES ('bibs', left(p_file_name, 200), 'pending', jsonb_array_length(p_rows), v_actor, p_season_id, now())
  RETURNING id INTO v_batch_id;

  FOR v_item IN SELECT value AS r, ordinality AS n FROM jsonb_array_elements(p_rows) WITH ORDINALITY
  LOOP
    v_bib := NULLIF(btrim(COALESCE(v_item.r ->> 'bib', '')), '');
    INSERT INTO public.bib_import_rows (import_batch_id, source_row_number, source_data, external_player_id, first_name, last_name,
                                        birth_date, bib_raw, evaluation_number, status, message)
    VALUES (
      v_batch_id, COALESCE(private.csv_line(v_item.r), v_item.n), COALESCE(v_item.r -> 'source', v_item.r),
      NULLIF(btrim(COALESCE(v_item.r ->> 'player_id', '')), ''),
      NULLIF(btrim(COALESCE(v_item.r ->> 'first_name', '')), ''),
      NULLIF(btrim(COALESCE(v_item.r ->> 'last_name', '')), ''),
      public.try_parse_iso_date(v_item.r ->> 'birth_date'),
      v_bib,
      CASE WHEN v_bib ~ '^[0-9]{1,6}$' AND v_bib::integer > 0 THEN v_bib::integer END,
      CASE WHEN v_bib IS NULL OR v_bib !~ '^[0-9]{1,6}$' OR v_bib::integer = 0
                OR (NULLIF(btrim(COALESCE(v_item.r ->> 'player_id', '')), '') IS NULL
                    AND (NULLIF(btrim(COALESCE(v_item.r ->> 'first_name', '')), '') IS NULL OR NULLIF(btrim(COALESCE(v_item.r ->> 'last_name', '')), '') IS NULL))
           THEN 'invalid' ELSE 'held' END,
      CASE WHEN v_bib IS NULL THEN 'Bib is blank.'
           WHEN v_bib !~ '^[0-9]{1,6}$' OR v_bib::integer = 0 THEN format('Bib "%s" is not a whole number.', v_bib)
           WHEN NULLIF(btrim(COALESCE(v_item.r ->> 'player_id', '')), '') IS NULL
                AND (NULLIF(btrim(COALESCE(v_item.r ->> 'first_name', '')), '') IS NULL OR NULLIF(btrim(COALESCE(v_item.r ->> 'last_name', '')), '') IS NULL)
             THEN 'Row has no Player Id and no full name.' END
    );
  END LOOP;

  PERFORM private.refresh_bib_batch(v_batch_id);

  UPDATE public.import_batches
  SET rows_with_errors = (SELECT count(*) FROM public.bib_import_rows WHERE import_batch_id = v_batch_id AND status = 'invalid')
  WHERE id = v_batch_id;

  RETURN v_batch_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stage_prior_year_import(p_season_id bigint, p_file_name text, p_rows jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_batch_id bigint;
  v_item record;
  v_ratings jsonb;
  v_bad text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = p_season_id AND NOT s.is_closed) THEN
    RAISE EXCEPTION 'Choose the open season these ratings are for.';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'The file has no rows.';
  END IF;
  IF jsonb_array_length(p_rows) > 3000 THEN
    RAISE EXCEPTION 'The file has more than 3000 rows.';
  END IF;

  INSERT INTO public.import_batches (import_type, source_file_name, status, rows_received, created_by, season_id, started_at)
  VALUES ('historical_evaluations', left(p_file_name, 200), 'pending', jsonb_array_length(p_rows), v_actor, p_season_id, now())
  RETURNING id INTO v_batch_id;

  FOR v_item IN SELECT value AS r, ordinality AS n FROM jsonb_array_elements(p_rows) WITH ORDINALITY
  LOOP
    v_ratings := COALESCE(v_item.r -> 'ratings', '{}'::jsonb);
    IF jsonb_typeof(v_ratings) <> 'object' THEN v_ratings := '{}'::jsonb; END IF;
    SELECT string_agg(key, ', ') INTO v_bad FROM jsonb_each(v_ratings)
    WHERE key NOT IN (SELECT code FROM public.rating_categories) OR jsonb_typeof(value) <> 'number' OR value::text !~ '^[1-5]$';

    INSERT INTO public.historical_evaluation_import_rows (
      import_batch_id, source_row_number, source_data, source_player_id, first_name, last_name, birth_date,
      source_season_label, source_division_name, source_team_label, source_coach_name, ratings, match_status, match_message)
    VALUES (
      v_batch_id, COALESCE(private.csv_line(v_item.r), v_item.n), COALESCE(v_item.r -> 'source', v_item.r),
      NULLIF(btrim(COALESCE(v_item.r ->> 'player_id', '')), ''),
      NULLIF(btrim(COALESCE(v_item.r ->> 'first_name', '')), ''),
      NULLIF(btrim(COALESCE(v_item.r ->> 'last_name', '')), ''),
      public.try_parse_iso_date(v_item.r ->> 'birth_date'),
      COALESCE(NULLIF(btrim(COALESCE(v_item.r ->> 'season', '')), ''), 'Prior year'),
      COALESCE(NULLIF(btrim(COALESCE(v_item.r ->> 'division', '')), ''), 'Unknown'),
      NULLIF(btrim(COALESCE(v_item.r ->> 'team', '')), ''),
      NULLIF(btrim(COALESCE(v_item.r ->> 'coach_name', '')), ''),
      CASE WHEN v_bad IS NULL THEN v_ratings ELSE '{}'::jsonb END,
      CASE WHEN v_bad IS NOT NULL OR v_ratings = '{}'::jsonb THEN 'invalid' ELSE 'held' END,
      CASE WHEN v_bad IS NOT NULL THEN format('Ratings must be whole numbers 1-5 for known skills (check: %s).', v_bad)
           WHEN v_ratings = '{}'::jsonb THEN 'Row has no ratings.' END
    );
  END LOOP;

  PERFORM private.refresh_prior_year_batch(v_batch_id);
  UPDATE public.import_batches
  SET rows_with_errors = (SELECT count(*) FROM public.historical_evaluation_import_rows WHERE import_batch_id = v_batch_id AND match_status = 'invalid')
  WHERE id = v_batch_id;
  RETURN v_batch_id;
END;
$function$;

