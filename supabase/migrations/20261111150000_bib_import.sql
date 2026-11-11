-- Bib (evaluation number) upload (decided 2026-11-11).
-- * An admin uploads a CSV of bibs keyed by Sports Connect Player Id, or by name plus birthdate.
-- * Rows are staged in public.bib_import_rows and matched here, never by creating players.
--   status: ready   matched; change_kind says what applying would do (new / same / change / conflict)
--           held    no single registered player matches yet (unknown, ambiguous, still in import review).
--                   Re-checked with recheck_bib_import(); files can be uploaded before or after registrations.
--           invalid rejected with a message (blank or non-numeric bib, duplicate in file, out-of-scope player)
--           applied / skipped   final
-- * apply_bib_import() sets every 'new' bib plus the 'change' rows the admin accepted. Conflicts are skipped.
--   One audit entry per apply lists every registration changed.

ALTER TABLE public.import_batches DROP CONSTRAINT import_batches_import_type_check;
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_import_type_check
  CHECK (import_type IN ('players', 'historical_evaluations', 'historical_ratings', 'bibs'));

CREATE TABLE public.bib_import_rows (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_batch_id bigint NOT NULL REFERENCES public.import_batches(id) ON DELETE RESTRICT,
  source_row_number integer NOT NULL CHECK (source_row_number > 0),
  source_data jsonb NOT NULL,
  external_player_id text,
  first_name text,
  last_name text,
  birth_date date,
  bib_raw text,
  evaluation_number integer,
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('ready', 'held', 'invalid', 'applied', 'skipped')),
  change_kind text CHECK (change_kind IN ('new', 'same', 'change', 'conflict')),
  matched_player_season_id bigint REFERENCES public.player_seasons(id) ON DELETE RESTRICT,
  current_evaluation_number integer,
  message text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_batch_id, source_row_number)
);

ALTER TABLE public.bib_import_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bib_import_rows FROM anon;
CREATE POLICY "admins_manage_all" ON public.bib_import_rows FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT ON TABLE public.bib_import_rows TO authenticated;

-- ---------- matching (shared with the prior-year import) ----------
-- One registration in the season by Sports Connect Player Id, else by exact name + birthdate.
-- state: matched | held | invalid
CREATE OR REPLACE FUNCTION private.match_registration(
  p_season_id bigint, p_external_player_id text, p_first_name text, p_last_name text, p_birth_date date
)
RETURNS TABLE (player_season_id bigint, state text, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id text := NULLIF(btrim(COALESCE(p_external_player_id, '')), '');
  v_first text := lower(NULLIF(btrim(COALESCE(p_first_name, '')), ''));
  v_last text := lower(NULLIF(btrim(COALESCE(p_last_name, '')), ''));
  v_hits bigint[];
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT array_agg(ps.id) INTO v_hits
    FROM public.player_seasons ps WHERE ps.season_id = p_season_id AND ps.external_player_id = v_id;
    IF cardinality(v_hits) = 1 THEN
      -- The same Player Id still waiting in import review means two children may share it: only trust
      -- the match when the file's name agrees with the registered player.
      IF EXISTS (SELECT 1 FROM public.sports_connect_import_rows r JOIN public.import_batches b ON b.id = r.import_batch_id
                 WHERE b.season_id = p_season_id AND btrim(r.external_player_id) = v_id
                   AND r.review_state NOT IN ('ignored', 'committed'))
         AND NOT EXISTS (SELECT 1 FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id
                         WHERE ps.id = v_hits[1] AND lower(btrim(p.first_name)) = v_first AND lower(btrim(p.last_name)) = v_last) THEN
        RETURN QUERY SELECT NULL::bigint, 'held'::text,
          format('Player Id %s is on more than one registration (one still in import review). Add the player''s name to the row or set the bib on the Players page.', v_id);
        RETURN;
      END IF;
      RETURN QUERY SELECT v_hits[1], 'matched'::text, NULL::text; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.sports_connect_import_rows r JOIN public.import_batches b ON b.id = r.import_batch_id
               WHERE b.season_id = p_season_id AND btrim(r.external_player_id) = v_id AND r.review_state = 'ignored')
       AND NOT EXISTS (SELECT 1 FROM public.sports_connect_import_rows r JOIN public.import_batches b ON b.id = r.import_batch_id
               WHERE b.season_id = p_season_id AND btrim(r.external_player_id) = v_id AND r.review_state <> 'ignored') THEN
      RETURN QUERY SELECT NULL::bigint, 'invalid'::text, 'Player is not in the evaluation pool (out-of-scope program in the registration file).'::text; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.sports_connect_import_rows r JOIN public.import_batches b ON b.id = r.import_batch_id
               WHERE b.season_id = p_season_id AND btrim(r.external_player_id) = v_id
                 AND r.review_state NOT IN ('ignored', 'committed')) THEN
      RETURN QUERY SELECT NULL::bigint, 'held'::text, format('Player Id %s is still waiting in registration import review.', v_id); RETURN;
    END IF;
  END IF;

  IF v_first IS NOT NULL AND v_last IS NOT NULL THEN
    IF p_birth_date IS NULL THEN
      RETURN QUERY SELECT NULL::bigint, 'held'::text,
        CASE WHEN v_id IS NULL THEN 'Give a Player Id or a birthdate to match by name.'
             ELSE format('No registered player has Player Id %s, and there is no birthdate to match by name.', v_id) END;
      RETURN;
    END IF;
    SELECT array_agg(ps.id) INTO v_hits
    FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id
    WHERE ps.season_id = p_season_id AND lower(btrim(p.first_name)) = v_first AND lower(btrim(p.last_name)) = v_last
      AND p.date_of_birth = p_birth_date;
    IF cardinality(v_hits) = 1 THEN
      RETURN QUERY SELECT v_hits[1], 'matched'::text, NULL::text; RETURN;
    ELSIF cardinality(v_hits) > 1 THEN
      RETURN QUERY SELECT NULL::bigint, 'held'::text, 'More than one registered player has this name and birthdate. Set the bib on the Players page.'::text; RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT NULL::bigint, 'held'::text,
    CASE WHEN v_id IS NOT NULL THEN format('No registered player matches Player Id %s yet.', v_id)
         ELSE 'No registered player matches this name and birthdate yet.' END;
END;
$function$;

REVOKE ALL ON FUNCTION private.match_registration(bigint, text, text, text, date) FROM PUBLIC, anon, authenticated;

-- Recompute matches, duplicates and planned changes for every ready/held row of one batch.
CREATE OR REPLACE FUNCTION private.refresh_bib_batch(p_batch_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_season_id bigint;
  v_row record;
  v_match record;
  v_dup integer;
  v_owner text;
BEGIN
  SELECT season_id INTO v_season_id FROM public.import_batches WHERE id = p_batch_id;

  FOR v_row IN
    SELECT * FROM public.bib_import_rows WHERE import_batch_id = p_batch_id AND status IN ('ready', 'held') ORDER BY source_row_number
  LOOP
    SELECT * INTO v_match FROM private.match_registration(v_season_id, v_row.external_player_id, v_row.first_name, v_row.last_name, v_row.birth_date);

    IF v_match.state <> 'matched' THEN
      UPDATE public.bib_import_rows
      SET status = v_match.state, message = v_match.message, matched_player_season_id = NULL, change_kind = NULL, current_evaluation_number = NULL
      WHERE id = v_row.id;
      CONTINUE;
    END IF;

    -- Duplicates within the file: the first row wins.
    SELECT min(o.source_row_number) INTO v_dup FROM public.bib_import_rows o
    WHERE o.import_batch_id = p_batch_id AND o.id <> v_row.id AND o.source_row_number < v_row.source_row_number
      AND o.status IN ('ready', 'applied') AND o.matched_player_season_id = v_match.player_season_id;
    IF v_dup IS NOT NULL THEN
      UPDATE public.bib_import_rows SET status = 'invalid', change_kind = NULL, matched_player_season_id = v_match.player_season_id,
        message = format('Same player is listed twice in this file (first on row %s).', v_dup) WHERE id = v_row.id;
      CONTINUE;
    END IF;
    SELECT min(o.source_row_number) INTO v_dup FROM public.bib_import_rows o
    WHERE o.import_batch_id = p_batch_id AND o.id <> v_row.id AND o.source_row_number < v_row.source_row_number
      AND o.status IN ('ready', 'applied') AND o.evaluation_number = v_row.evaluation_number;
    IF v_dup IS NOT NULL THEN
      UPDATE public.bib_import_rows SET status = 'invalid', change_kind = NULL, matched_player_season_id = v_match.player_season_id,
        message = format('Bib %s is already used by another player in this file (row %s).', v_row.evaluation_number, v_dup) WHERE id = v_row.id;
      CONTINUE;
    END IF;

    UPDATE public.bib_import_rows r
    SET status = 'ready', message = NULL, matched_player_season_id = v_match.player_season_id,
        current_evaluation_number = ps.evaluation_number,
        change_kind = CASE WHEN ps.evaluation_number IS NULL THEN 'new'
                           WHEN ps.evaluation_number = r.evaluation_number THEN 'same' ELSE 'change' END
    FROM public.player_seasons ps
    WHERE r.id = v_row.id AND ps.id = v_match.player_season_id;
  END LOOP;

  -- A bib held by a player outside this file (or by one this file doesn't move) is a conflict.
  FOR v_row IN
    SELECT r.* FROM public.bib_import_rows r
    WHERE r.import_batch_id = p_batch_id AND r.status = 'ready' AND r.change_kind IN ('new', 'change', 'conflict')
  LOOP
    SELECT p.first_name || ' ' || p.last_name INTO v_owner
    FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id
    WHERE ps.season_id = v_season_id AND ps.evaluation_number = v_row.evaluation_number AND ps.id <> v_row.matched_player_season_id
      AND NOT EXISTS (SELECT 1 FROM public.bib_import_rows o WHERE o.import_batch_id = p_batch_id AND o.status = 'ready'
                      AND o.matched_player_season_id = ps.id AND o.change_kind = 'change')
    LIMIT 1;
    IF v_owner IS NOT NULL THEN
      UPDATE public.bib_import_rows SET change_kind = 'conflict',
        message = format('Bib %s already belongs to %s.', v_row.evaluation_number, v_owner) WHERE id = v_row.id;
    ELSIF v_row.change_kind = 'conflict' THEN
      UPDATE public.bib_import_rows SET change_kind = CASE WHEN v_row.current_evaluation_number IS NULL THEN 'new' ELSE 'change' END, message = NULL
      WHERE id = v_row.id;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION private.refresh_bib_batch(bigint) FROM PUBLIC, anon, authenticated;

-- ---------- stage ----------
-- p_rows: [{"player_id": "...", "first_name": "...", "last_name": "...", "birth_date": "YYYY-MM-DD" | null, "bib": "...", "source": {...}}]
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
      v_batch_id, v_item.n, COALESCE(v_item.r -> 'source', v_item.r),
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

REVOKE ALL ON FUNCTION public.stage_bib_import(bigint, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stage_bib_import(bigint, text, jsonb) TO authenticated;

-- ---------- re-check held rows (after more registrations arrive) ----------
CREATE OR REPLACE FUNCTION public.recheck_bib_import(p_batch_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_before integer;
  v_after integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_before FROM public.bib_import_rows WHERE import_batch_id = p_batch_id AND status = 'held';
  PERFORM private.refresh_bib_batch(p_batch_id);
  SELECT count(*) INTO v_after FROM public.bib_import_rows WHERE import_batch_id = p_batch_id AND status = 'held';
  RETURN v_before - v_after;
END;
$function$;

REVOKE ALL ON FUNCTION public.recheck_bib_import(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recheck_bib_import(bigint) TO authenticated;

-- ---------- apply ----------
CREATE OR REPLACE FUNCTION public.apply_bib_import(p_batch_id bigint, p_accept_change_row_ids bigint[] DEFAULT '{}')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_season_id bigint;
  v_changes jsonb;
  v_count integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  SELECT b.season_id INTO v_season_id FROM public.import_batches b
  JOIN public.seasons s ON s.id = b.season_id
  WHERE b.id = p_batch_id AND b.import_type = 'bibs' AND NOT s.is_closed
  FOR UPDATE OF b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bib upload not found, or its season is closed.';
  END IF;

  -- Re-check against the database as it is now.
  PERFORM private.refresh_bib_batch(p_batch_id);

  DROP TABLE IF EXISTS bib_apply;
  CREATE TEMP TABLE bib_apply ON COMMIT DROP AS
    SELECT r.id AS row_id, r.matched_player_season_id AS ps_id, r.current_evaluation_number AS before_bib, r.evaluation_number AS after_bib
    FROM public.bib_import_rows r
    WHERE r.import_batch_id = p_batch_id AND r.status = 'ready'
      AND (r.change_kind = 'new' OR (r.change_kind = 'change' AND r.id = ANY (COALESCE(p_accept_change_row_ids, '{}'))));

  SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object('player_season_id', ps_id, 'before', before_bib, 'after', after_bib)), '[]')
  INTO v_count, v_changes FROM bib_apply;

  BEGIN
    -- Clear first so swaps between players in the same file don't trip the unique index.
    UPDATE public.player_seasons ps SET evaluation_number = NULL FROM bib_apply a WHERE ps.id = a.ps_id;
    UPDATE public.player_seasons ps SET evaluation_number = a.after_bib FROM bib_apply a WHERE ps.id = a.ps_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Two players would end up with the same bib. Re-check the upload and resolve the conflicts first.';
  END;

  UPDATE public.bib_import_rows r SET status = 'applied', applied_at = now(), message = NULL
  FROM bib_apply a WHERE r.id = a.row_id;
  UPDATE public.bib_import_rows SET status = 'applied', applied_at = now()
  WHERE import_batch_id = p_batch_id AND status = 'ready' AND change_kind = 'same';
  UPDATE public.bib_import_rows
  SET status = 'skipped', message = CASE change_kind WHEN 'change' THEN 'Kept the current bib.' ELSE COALESCE(message, 'Skipped.') END
  WHERE import_batch_id = p_batch_id AND status = 'ready';

  UPDATE public.import_batches b
  SET rows_processed = (SELECT count(*) FROM public.bib_import_rows WHERE import_batch_id = p_batch_id AND status IN ('applied', 'skipped', 'invalid')),
      status = CASE WHEN EXISTS (SELECT 1 FROM public.bib_import_rows WHERE import_batch_id = p_batch_id AND status = 'held') THEN 'pending' ELSE 'completed' END,
      completed_at = now()
  WHERE b.id = p_batch_id;

  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'bib_import_applied', 'import_batches', p_batch_id::text, format('%s bib(s) set from upload', v_count), NULL,
          jsonb_build_object('season_id', v_season_id, 'changes', v_changes));
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_bib_import(bigint, bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_bib_import(bigint, bigint[]) TO authenticated;
