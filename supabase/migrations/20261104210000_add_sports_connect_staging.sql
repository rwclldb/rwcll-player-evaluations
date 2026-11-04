-- Phase 5.0: protected Sports Connect staging only.
-- This migration does not insert/update players or player-season registrations.

ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS season_id bigint REFERENCES public.seasons(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS import_batches_season_id_created_at_idx
  ON public.import_batches (season_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.try_parse_iso_date(p_value text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_date date;
BEGIN
  IF p_value IS NULL OR p_value !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_date := p_value::date;
    IF to_char(v_date, 'YYYY-MM-DD') <> p_value THEN
      RETURN NULL;
    END IF;
    RETURN v_date;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public.try_parse_iso_date(text) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.sports_connect_import_rows (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_batch_id bigint NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  source_row_number integer NOT NULL CHECK (source_row_number >= 2),
  external_player_id text,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  birth_date_text text NOT NULL DEFAULT '',
  birth_date date,
  source_program text NOT NULL DEFAULT '',
  source_division text NOT NULL DEFAULT '',
  registration_number text,
  payment_status text NOT NULL DEFAULT '',
  league_age integer CHECK (league_age IS NULL OR league_age BETWEEN 4 AND 16),
  review_flags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(review_flags) = 'array'),
  review_state text NOT NULL DEFAULT 'needs_review'
    CHECK (review_state IN ('needs_review', 'ready_for_match_review', 'approved_new', 'approved_match', 'ignored', 'committed')),
  matched_player_id bigint REFERENCES public.players(id) ON DELETE RESTRICT,
  committed_player_season_id bigint REFERENCES public.player_seasons(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sports_connect_import_rows_batch_line_key UNIQUE (import_batch_id, source_row_number),
  CONSTRAINT sports_connect_import_rows_match_state_check CHECK (
    (review_state <> 'approved_match') OR matched_player_id IS NOT NULL
  )
);

ALTER TABLE public.sports_connect_import_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sports_connect_import_rows FROM anon, authenticated;
GRANT SELECT ON TABLE public.sports_connect_import_rows TO authenticated;
CREATE POLICY sports_connect_import_rows_admin_read
  ON public.sports_connect_import_rows FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.stage_sports_connect_import(
  p_season_id bigint,
  p_source_file_name text,
  p_rows jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_batch_id bigint;
  v_row jsonb;
  v_row_number integer;
  v_rows_received integer;
  v_rows_with_errors integer := 0;
  v_season_closed boolean;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_season_id IS NULL THEN
    RAISE EXCEPTION 'Choose an existing season';
  END IF;
  SELECT s.is_closed INTO v_season_closed
  FROM public.seasons AS s WHERE s.id = p_season_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected season does not exist';
  END IF;
  IF v_season_closed THEN
    RAISE EXCEPTION 'Cannot stage an import for a closed season';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Rows must be a JSON array';
  END IF;
  v_rows_received := jsonb_array_length(p_rows);
  IF v_rows_received < 1 OR v_rows_received > 5000 THEN
    RAISE EXCEPTION 'Import staging requires between 1 and 5000 rows';
  END IF;
  IF length(coalesce(p_source_file_name, '')) < 1 OR length(p_source_file_name) > 255 THEN
    RAISE EXCEPTION 'Invalid source filename';
  END IF;

  INSERT INTO public.import_batches (
    import_type, source_file_name, status, rows_received, rows_processed,
    rows_with_errors, created_by, season_id
  ) VALUES (
    'players', left(p_source_file_name, 255), 'pending', v_rows_received, 0, 0, v_actor, p_season_id
  ) RETURNING id INTO v_batch_id;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    IF jsonb_typeof(v_row) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Each staged row must be an object';
    END IF;
    v_row_number := nullif(v_row->>'line', '')::integer;
    IF v_row_number IS NULL OR v_row_number < 2 THEN
      RAISE EXCEPTION 'Invalid source row number';
    END IF;
    IF jsonb_typeof(coalesce(v_row->'issues', '[]'::jsonb)) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Row review flags must be an array';
    END IF;
    IF jsonb_array_length(coalesce(v_row->'issues', '[]'::jsonb)) > 0 THEN
      v_rows_with_errors := v_rows_with_errors + 1;
    END IF;

    INSERT INTO public.sports_connect_import_rows (
      import_batch_id, source_row_number, external_player_id, first_name, last_name,
      birth_date_text, birth_date, source_program, source_division,
      registration_number, payment_status, league_age, review_flags
    ) VALUES (
      v_batch_id,
      v_row_number,
      nullif(left(coalesce(v_row->>'playerId', ''), 200), ''),
      left(coalesce(v_row->>'firstName', ''), 200),
      left(coalesce(v_row->>'lastName', ''), 200),
      left(coalesce(v_row->>'birthDate', ''), 40),
      public.try_parse_iso_date(v_row->>'birthDate'),
      left(coalesce(v_row->>'program', ''), 300),
      left(coalesce(v_row->>'division', ''), 200),
      nullif(left(coalesce(v_row->>'registrationNumber', ''), 200), ''),
      left(coalesce(v_row->>'paymentStatus', ''), 100),
      CASE WHEN coalesce(v_row->>'leagueAge', '') ~ '^\d{1,2}$'
           THEN (v_row->>'leagueAge')::integer ELSE NULL END,
      coalesce(v_row->'issues', '[]'::jsonb)
    );
  END LOOP;

  UPDATE public.import_batches SET rows_with_errors = v_rows_with_errors WHERE id = v_batch_id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, after_data)
  VALUES (
    v_actor, 'sports_connect_import_staged', 'import_batches', v_batch_id::text,
    'Validated CSV saved to staging; player and registration records were not changed',
    jsonb_build_object('season_id', p_season_id, 'rows_received', v_rows_received,
                       'rows_with_review_flags', v_rows_with_errors,
                       'source_file_name', left(p_source_file_name, 255))
  );
  RETURN v_batch_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.stage_sports_connect_import(bigint, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stage_sports_connect_import(bigint, text, jsonb) TO authenticated;
