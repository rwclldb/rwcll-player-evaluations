-- Prior-year (end-of-season) coach ratings upload (decided 2026-11-11).
-- Rows go to historical_evaluation_import_rows and are matched to this season's registrations:
--   matched  Player Id, name and birthdate all agree (or no Player Id given and name + birthdate agree).
--            Imported in bulk when the admin clicks Import.
--   review   Partly agrees (e.g. name + birthdate agree but Player Id differs). The admin confirms the
--            suggested player for each row.
--   held     No candidate yet (player not registered yet, or not returning). Re-checked later; the admin
--            can dismiss rows for players who aren't coming back.
--   invalid  No ratings, a score outside 1-5, or the same rating is already imported.
-- Rows never create or merge players. Each import writes one audit entry.

ALTER TABLE public.historical_evaluation_import_rows
  ADD COLUMN ratings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN match_status text NOT NULL DEFAULT 'held'
    CHECK (match_status IN ('matched', 'review', 'held', 'invalid')),
  ADD COLUMN match_message text;

-- Admins may read staged rows (writes go through the functions below).
CREATE POLICY "admins_read_all" ON public.historical_evaluation_import_rows FOR SELECT TO authenticated USING (public.is_admin());
GRANT SELECT ON TABLE public.historical_evaluation_import_rows TO authenticated;

-- ---------- match one batch ----------
CREATE OR REPLACE FUNCTION private.refresh_prior_year_batch(p_batch_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_season_id bigint;
  v_row record;
  v_by_id record;
  v_by_name bigint[];
  v_status text;
  v_message text;
  v_method text;
  v_candidates bigint[];
  v_first text;
  v_last text;
BEGIN
  SELECT season_id INTO v_season_id FROM public.import_batches WHERE id = p_batch_id;

  FOR v_row IN
    SELECT * FROM public.historical_evaluation_import_rows
    WHERE import_batch_id = p_batch_id AND review_state = 'pending_review' AND match_status <> 'invalid'
    ORDER BY source_row_number
  LOOP
    v_first := lower(btrim(COALESCE(v_row.first_name, '')));
    v_last := lower(btrim(COALESCE(v_row.last_name, '')));
    v_status := 'held'; v_message := NULL; v_method := NULL; v_candidates := ARRAY[]::bigint[];

    SELECT ps.player_id, lower(btrim(p.first_name)) AS f, lower(btrim(p.last_name)) AS l, p.date_of_birth AS dob,
           p.first_name || ' ' || p.last_name AS name
    INTO v_by_id
    FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id
    WHERE ps.season_id = v_season_id AND NULLIF(btrim(COALESCE(v_row.source_player_id, '')), '') IS NOT NULL
      AND ps.external_player_id = btrim(v_row.source_player_id)
    LIMIT 1;

    SELECT COALESCE(array_agg(DISTINCT ps.player_id), ARRAY[]::bigint[]) INTO v_by_name
    FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id
    WHERE ps.season_id = v_season_id AND v_row.birth_date IS NOT NULL
      AND lower(btrim(p.first_name)) = v_first AND lower(btrim(p.last_name)) = v_last AND p.date_of_birth = v_row.birth_date;

    IF v_by_id.player_id IS NOT NULL THEN
      v_candidates := ARRAY[v_by_id.player_id];
      IF v_by_id.f = v_first AND v_by_id.l = v_last AND v_by_id.dob IS NOT DISTINCT FROM v_row.birth_date THEN
        v_status := 'matched'; v_method := 'player_id';
      ELSIF v_by_id.dob IS NOT DISTINCT FROM v_row.birth_date THEN
        v_status := 'review'; v_method := 'manual_review';
        v_message := format('Player Id and birthdate agree, but the name differs (registered as %s).', v_by_id.name);
      ELSE
        v_status := 'review'; v_method := 'manual_review';
        v_message := format('Player Id agrees, but the birthdate differs (registered as %s).', v_by_id.name);
      END IF;
    ELSIF cardinality(v_by_name) = 1 THEN
      v_candidates := v_by_name;
      IF NULLIF(btrim(COALESCE(v_row.source_player_id, '')), '') IS NULL THEN
        v_status := 'matched'; v_method := 'name_and_details';
      ELSE
        v_status := 'review'; v_method := 'manual_review';
        v_message := 'Name and birthdate agree, but the Player Id differs from this season''s registration.';
      END IF;
    ELSIF cardinality(v_by_name) > 1 THEN
      v_candidates := v_by_name; v_status := 'review'; v_method := 'manual_review';
      v_message := 'More than one registered player has this name and birthdate. Pick the right one.';
    ELSE
      v_message := 'No player registered this season matches yet (not registered yet, or not returning).';
    END IF;

    -- Don't import the same rating twice (re-uploaded file, or the same row twice in this file).
    IF v_status IN ('matched', 'review') AND cardinality(v_candidates) = 1 AND (
         EXISTS (SELECT 1 FROM public.historical_evaluations he
                 WHERE he.player_id = v_candidates[1] AND he.source_season_label = v_row.source_season_label
                   AND he.source_coach_name IS NOT DISTINCT FROM v_row.source_coach_name)
         OR EXISTS (SELECT 1 FROM public.historical_evaluation_import_rows o
                    WHERE o.import_batch_id = p_batch_id AND o.source_row_number < v_row.source_row_number
                      AND o.match_status IN ('matched', 'review') AND o.candidate_player_ids = v_candidates
                      AND o.source_season_label = v_row.source_season_label
                      AND o.source_coach_name IS NOT DISTINCT FROM v_row.source_coach_name)) THEN
      v_status := 'invalid';
      v_message := format('This coach''s %s rating of this player is already imported or listed earlier in the file.', v_row.source_season_label);
    END IF;

    UPDATE public.historical_evaluation_import_rows
    SET match_status = v_status, match_message = v_message, match_method = v_method,
        candidate_player_ids = v_candidates, updated_at = now()
    WHERE id = v_row.id;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION private.refresh_prior_year_batch(bigint) FROM PUBLIC, anon, authenticated;

-- ---------- stage ----------
-- p_rows: [{"player_id", "first_name", "last_name", "birth_date" (ISO or null), "season", "division", "team",
--           "coach_name", "ratings": {"hitting": 4, ...}, "source": {...original row...}}]
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
      v_batch_id, v_item.n, COALESCE(v_item.r -> 'source', v_item.r),
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

REVOKE ALL ON FUNCTION public.stage_prior_year_import(bigint, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stage_prior_year_import(bigint, text, jsonb) TO authenticated;

-- ---------- re-check ----------
CREATE OR REPLACE FUNCTION public.recheck_prior_year_import(p_batch_id bigint)
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
  SELECT count(*) INTO v_before FROM public.historical_evaluation_import_rows
  WHERE import_batch_id = p_batch_id AND review_state = 'pending_review' AND match_status = 'held';
  PERFORM private.refresh_prior_year_batch(p_batch_id);
  SELECT count(*) INTO v_after FROM public.historical_evaluation_import_rows
  WHERE import_batch_id = p_batch_id AND review_state = 'pending_review' AND match_status = 'held';
  RETURN v_before - v_after;
END;
$function$;

REVOKE ALL ON FUNCTION public.recheck_prior_year_import(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recheck_prior_year_import(bigint) TO authenticated;

-- ---------- import ----------
-- p_selections: [{"row_id": 1, "player_id": 2}, ...]. Each player must be one of the row's candidates;
-- 'review' rows need this explicit choice, 'matched' rows use their single candidate.
CREATE OR REPLACE FUNCTION public.import_prior_year_rows(p_batch_id bigint, p_selections jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_sel record;
  v_row record;
  v_he_id bigint;
  v_count integer := 0;
  v_imported jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.import_batches WHERE id = p_batch_id AND import_type = 'historical_evaluations') THEN
    RAISE EXCEPTION 'Prior-year upload not found.';
  END IF;

  PERFORM private.refresh_prior_year_batch(p_batch_id);

  FOR v_sel IN SELECT (e ->> 'row_id')::bigint AS row_id, (e ->> 'player_id')::bigint AS player_id
               FROM jsonb_array_elements(COALESCE(p_selections, '[]'::jsonb)) e
  LOOP
    SELECT * INTO v_row FROM public.historical_evaluation_import_rows
    WHERE id = v_sel.row_id AND import_batch_id = p_batch_id FOR UPDATE;
    IF NOT FOUND OR v_row.review_state <> 'pending_review' THEN
      CONTINUE;
    END IF;
    IF v_row.match_status NOT IN ('matched', 'review') OR NOT (v_sel.player_id = ANY (v_row.candidate_player_ids)) THEN
      RAISE EXCEPTION 'Row % can''t be imported for that player (it changed since the preview). Re-check and try again.', v_row.source_row_number;
    END IF;

    INSERT INTO public.historical_evaluations (
      player_id, source_season_label, source_division_name, source_team_label, source_season_id, source_coach_name,
      source_player_id, player_match_method, source_import_batch_id, source_import_row_number,
      imported_by, created_by, reviewed_by, reviewed_at, review_reason)
    VALUES (
      v_sel.player_id, v_row.source_season_label, v_row.source_division_name, v_row.source_team_label,
      (SELECT s.id FROM public.seasons s WHERE lower(s.name) = lower(v_row.source_season_label) LIMIT 1),
      v_row.source_coach_name, v_row.source_player_id, COALESCE(v_row.match_method, 'manual_review'),
      p_batch_id, v_row.source_row_number, v_actor, v_actor, v_actor, now(),
      CASE v_row.match_status WHEN 'matched' THEN 'Imported: details agree' ELSE 'Imported after admin review: ' || COALESCE(v_row.match_message, '') END)
    RETURNING id INTO v_he_id;

    INSERT INTO public.historical_ratings (historical_evaluation_id, category_name, score, rating_category_id, source_category_code)
    SELECT v_he_id, rc.name, (r.value::text)::integer, rc.id, rc.code
    FROM jsonb_each(v_row.ratings) r JOIN public.rating_categories rc ON rc.code = r.key;

    UPDATE public.historical_evaluation_import_rows
    SET review_state = 'imported', resolved_player_id = v_sel.player_id, imported_historical_evaluation_id = v_he_id,
        reviewed_by = v_actor, reviewed_at = now(), updated_at = now()
    WHERE id = v_row.id;

    v_count := v_count + 1;
    v_imported := v_imported || jsonb_build_object('row', v_row.source_row_number, 'player_id', v_sel.player_id, 'historical_evaluation_id', v_he_id);
  END LOOP;

  UPDATE public.import_batches b
  SET rows_processed = (SELECT count(*) FROM public.historical_evaluation_import_rows
                        WHERE import_batch_id = p_batch_id AND (review_state IN ('imported', 'rejected') OR match_status = 'invalid')),
      status = CASE WHEN EXISTS (SELECT 1 FROM public.historical_evaluation_import_rows WHERE import_batch_id = p_batch_id
                                   AND review_state = 'pending_review' AND match_status <> 'invalid') THEN 'pending' ELSE 'completed' END,
      completed_at = now()
  WHERE b.id = p_batch_id;

  IF v_count > 0 THEN
    INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
    VALUES (v_actor, 'prior_year_ratings_imported', 'import_batches', p_batch_id::text, format('%s prior-year rating(s) imported', v_count),
            NULL, jsonb_build_object('imported', v_imported));
  END IF;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.import_prior_year_rows(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_prior_year_rows(bigint, jsonb) TO authenticated;

-- ---------- dismiss ----------
CREATE OR REPLACE FUNCTION public.dismiss_prior_year_rows(p_batch_id bigint, p_row_ids bigint[], p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Give a reason (at least 5 characters), for example "Not returning this season".';
  END IF;
  UPDATE public.historical_evaluation_import_rows
  SET review_state = 'rejected', review_reason = btrim(p_reason), reviewed_by = v_actor, reviewed_at = now(), updated_at = now()
  WHERE import_batch_id = p_batch_id AND id = ANY (p_row_ids) AND review_state = 'pending_review';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'prior_year_rows_dismissed', 'import_batches', p_batch_id::text, btrim(p_reason), NULL,
          jsonb_build_object('row_ids', to_jsonb(p_row_ids), 'dismissed', v_count));
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.dismiss_prior_year_rows(bigint, bigint[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_prior_year_rows(bigint, bigint[], text) TO authenticated;
