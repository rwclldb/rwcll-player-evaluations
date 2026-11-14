-- Registrar role (part 2: registrations).
--
-- Registrars for a season can now do the registration work admins do for that season:
--   * stage, review and commit the Sports Connect registration import, including bulk review and the
--     "Players already registered" changes from a re-import
--   * upload bibs
--   * fix a player's name, birthdate, age group, bib and coach's-kid flag (Players page)
-- Every function below used to require an admin. Each now requires an admin or a registrar for the season of
-- the batch, row or registration it touches (public.can_register). Error messages are unchanged.
-- Registrars still never see scores, notes, draft reports, prior-year ratings, people or sessions:
-- the prior-year upload (import_type 'historical_evaluations') stays admin-only.
--
-- The Players edit page reads the change history and whether the player has scores through
-- registration_history and registration_has_scores, so registrars need no access to audit_log or evaluations.

-- ---------- season of a batch, staged row or registration ----------
CREATE FUNCTION private.batch_season(p_batch_id bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT season_id FROM public.import_batches WHERE id = p_batch_id;
$$;
CREATE FUNCTION private.import_row_season(p_row_id bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT b.season_id FROM public.sports_connect_import_rows r JOIN public.import_batches b ON b.id = r.import_batch_id WHERE r.id = p_row_id;
$$;
CREATE FUNCTION private.registration_season(p_player_season_id bigint) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT season_id FROM public.player_seasons WHERE id = p_player_season_id;
$$;
REVOKE ALL ON FUNCTION private.batch_season(bigint), private.import_row_season(bigint), private.registration_season(bigint) FROM PUBLIC, anon, authenticated;

-- ---------- read access to registration and bib imports ----------
CREATE POLICY import_batches_read_registrar ON public.import_batches FOR SELECT TO authenticated
  USING (import_type IN ('players', 'bibs') AND public.is_registrar(season_id));
-- Policies run as the signed-in person, so they use this public check rather than the private helpers.
CREATE FUNCTION public.is_registrar_for_batch(p_batch_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT public.is_registrar(private.batch_season(p_batch_id));
$$;
REVOKE ALL ON FUNCTION public.is_registrar_for_batch(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_registrar_for_batch(bigint) TO authenticated;
CREATE POLICY sports_connect_import_rows_read_registrar ON public.sports_connect_import_rows FOR SELECT TO authenticated
  USING (public.is_registrar_for_batch(import_batch_id));
CREATE POLICY bib_import_rows_read_registrar ON public.bib_import_rows FOR SELECT TO authenticated
  USING (public.is_registrar_for_batch(import_batch_id));

-- Page gate for the registration pages (imports, bib upload, Players): admin, or registrar in an open season.
-- The data each page reads and every action are still limited to the registrar's own season.
CREATE FUNCTION public.is_admin_or_registrar() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT public.is_admin() OR public.is_registrar_any();
$$;
REVOKE ALL ON FUNCTION public.is_admin_or_registrar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_or_registrar() TO authenticated;

-- ---------- Players edit page helpers ----------
-- Changes to one registration (edits, bibs, check-ins, imports), newest first.
CREATE FUNCTION public.registration_history(p_player_season_id bigint)
RETURNS TABLE (id bigint, action text, reason text, before_data jsonb, after_data jsonb, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT a.id, a.action, a.reason, a.before_data, a.after_data, a.created_at
  FROM public.audit_log a
  WHERE a.target_table = 'player_seasons' AND a.target_id = p_player_season_id::text
    AND public.can_register(private.registration_season(p_player_season_id))
  ORDER BY a.created_at DESC
  LIMIT 20;
$$;

-- Whether anyone has scored this player (their age group is then fixed). Yes/no only; no scores.
CREATE FUNCTION public.registration_has_scores(p_player_season_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT CASE WHEN public.can_register(private.registration_season(p_player_season_id))
              THEN EXISTS (SELECT 1 FROM public.evaluations e WHERE e.player_season_id = p_player_season_id) END;
$$;
REVOKE ALL ON FUNCTION public.registration_history(bigint), public.registration_has_scores(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registration_history(bigint), public.registration_has_scores(bigint) TO authenticated;

-- ---- generated: existing functions patched below (admin check -> admin or registrar for the season) ----
CREATE OR REPLACE FUNCTION public.stage_sports_connect_import(p_season_id bigint, p_source_file_name text, p_rows jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
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
  IF v_actor IS NULL OR NOT public.can_register(p_season_id) THEN
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
      registration_number, payment_status, league_age, review_flags, coach_kid
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
      coalesce(v_row->'issues', '[]'::jsonb),
      CASE WHEN jsonb_typeof(v_row->'coachKid') = 'boolean' THEN (v_row->>'coachKid')::boolean END
    );
  END LOOP;

  -- Rows for players already registered this season are compared with their registration.
  PERFORM private.sync_import_batch(v_batch_id, v_actor);

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

CREATE OR REPLACE FUNCTION public.review_sports_connect_import_row(p_row_id bigint, p_decision text, p_matched_player_id bigint DEFAULT NULL::bigint, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
  v_batch_id bigint;
BEGIN
  IF v_actor IS NULL OR NOT public.can_register(private.import_row_season(p_row_id)) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('needs_review', 'ready_for_match_review', 'approved_new', 'approved_match', 'ignored') THEN
    RAISE EXCEPTION 'Unsupported review decision';
  END IF;

  IF length(trim(coalesce(p_reason, ''))) < 5 OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'Provide a review reason between 5 and 1000 characters';
  END IF;

  IF (p_decision = 'approved_match') <> (p_matched_player_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Select an existing player only for an approved match decision';
  END IF;

  IF p_matched_player_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.players WHERE id = p_matched_player_id
  ) THEN
    RAISE EXCEPTION 'Selected player does not exist';
  END IF;

  SELECT to_jsonb(r), r.import_batch_id
  INTO v_before, v_batch_id
  FROM public.sports_connect_import_rows r
  WHERE r.id = p_row_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staged import row not found';
  END IF;

  IF v_before->>'review_state' = 'committed' THEN
    RAISE EXCEPTION 'Committed rows cannot be changed through review';
  END IF;

  IF v_before->>'review_state' IN ('up_to_date', 'has_changes', 'changes_reviewed') THEN
    RAISE EXCEPTION 'This player is already registered. Review changes on the batch page instead.';
  END IF;

  IF v_before->>'review_state' = 'ignored' THEN
    RAISE EXCEPTION 'Ignored rows are terminal; an administrator must explicitly reopen this row first';
  END IF;

  UPDATE public.sports_connect_import_rows
  SET review_state = p_decision,
      matched_player_id = p_matched_player_id
  WHERE id = p_row_id;

  SELECT to_jsonb(r)
  INTO v_after
  FROM public.sports_connect_import_rows r
  WHERE r.id = p_row_id;

  INSERT INTO public.audit_log(
    actor_user_id, action, target_table, target_id, reason, before_data, after_data
  )
  VALUES (
    v_actor,
    'sports_connect_import_row_reviewed',
    'sports_connect_import_rows',
    p_row_id::text,
    trim(p_reason),
    v_before,
    v_after
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_sports_connect_import_row(p_row_id bigint, p_reason text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_row record;
  v_player_id bigint;
  v_player_season_id bigint;
  v_existing record;
  v_linked_on_site boolean := false;
  v_before jsonb;
  v_after jsonb;
  v_season_is_closed boolean;
  v_reg_number text;
  v_bib integer;
  v_bib_note text;
BEGIN
  IF v_actor IS NULL OR NOT public.can_register(private.import_row_season(p_row_id)) THEN
    RAISE EXCEPTION 'Administrator access required'
      USING ERRCODE = '42501';
  END IF;

  IF length(btrim(coalesce(p_reason, ''))) < 5
     OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION
      'Provide a commit reason between 5 and 1000 characters';
  END IF;

  SELECT r.*,
         b.season_id AS batch_season_id,
         b.import_type AS batch_import_type
    INTO v_row
  FROM public.sports_connect_import_rows AS r
  JOIN public.import_batches AS b
    ON b.id = r.import_batch_id
  WHERE r.id = p_row_id
  FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staged import row or its batch was not found';
  END IF;

  IF v_row.review_state = 'committed' THEN
    IF v_row.committed_player_season_id IS NULL THEN
      RAISE EXCEPTION
        'Row is marked committed but has no committed registration id';
    END IF;
    RETURN v_row.committed_player_season_id;
  END IF;

  IF v_row.review_state NOT IN ('approved_new', 'approved_match') THEN
    RAISE EXCEPTION
      'Only approved_new or approved_match rows can be committed';
  END IF;

  IF v_row.batch_import_type <> 'players' THEN
    RAISE EXCEPTION
      'Only player import batches can be committed by this function';
  END IF;

  IF v_row.batch_season_id IS NULL THEN
    RAISE EXCEPTION
      'The import batch must be associated with a season';
  END IF;

  SELECT s.is_closed
    INTO v_season_is_closed
  FROM public.seasons AS s
  WHERE s.id = v_row.batch_season_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The import batch season does not exist';
  END IF;

  IF v_season_is_closed THEN
    RAISE EXCEPTION 'Cannot commit registrations into a closed season';
  END IF;

  IF length(btrim(coalesce(v_row.first_name, ''))) = 0
     OR length(btrim(coalesce(v_row.last_name, ''))) = 0 THEN
    RAISE EXCEPTION
      'First and last name are required before committing a row';
  END IF;

  v_before := to_jsonb(v_row);

  -- The league keeps the bib in Sports Connect's Registration Number. Use it when it is a whole number;
  -- otherwise leave the bib blank (set it later by bib upload or on the Players page).
  v_reg_number := nullif(btrim(v_row.registration_number), '');
  IF v_reg_number ~ '^[0-9]{1,9}$' AND v_reg_number::integer > 0 THEN
    v_bib := v_reg_number::integer;
  ELSIF v_reg_number IS NOT NULL THEN
    v_bib_note := format('Registration Number %s is not a whole number, so no bib was set.', v_reg_number);
  END IF;

  IF v_row.review_state = 'approved_match' THEN
    IF v_row.matched_player_id IS NULL THEN
      RAISE EXCEPTION
        'An approved match must identify an existing player';
    END IF;

    PERFORM 1
    FROM public.players AS p
    WHERE p.id = v_row.matched_player_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected player no longer exists';
    END IF;

    v_player_id := v_row.matched_player_id;

    SELECT ps.id, ps.registration_source, ps.external_player_id
      INTO v_existing
    FROM public.player_seasons AS ps
    WHERE ps.player_id = v_player_id
      AND ps.season_id = v_row.batch_season_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing.registration_source = 'on_site' AND v_existing.external_player_id IS NULL THEN
        -- Keep a bib given on site; otherwise use the Registration Number if no one else has it.
        IF v_bib IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.player_seasons ps
          WHERE ps.season_id = v_row.batch_season_id AND ps.evaluation_number = v_bib AND ps.id <> v_existing.id
        ) THEN
          v_bib_note := format('Bib %s is already used by another player, so no bib was set from the Registration Number.', v_bib);
          v_bib := NULL;
        END IF;
        UPDATE public.player_seasons
        SET evaluation_number = COALESCE(evaluation_number, v_bib),
            is_coach_kid = COALESCE(v_row.coach_kid, is_coach_kid),
            external_registration_id = nullif(btrim(v_row.registration_number), ''),
            external_player_id = nullif(btrim(v_row.external_player_id), ''),
            registration_payment_status = COALESCE(NULLIF(BTRIM(v_row.payment_status), ''), 'UNKNOWN'),
            registration_source = 'sports_connect'
        WHERE id = v_existing.id;
        v_player_season_id := v_existing.id;
        v_linked_on_site := true;
      ELSE
        RAISE EXCEPTION
          'The selected player already has a registration for this season. Review the existing registration and resolve the conflicting import identifiers before committing.';
      END IF;
    END IF;

  ELSE
    INSERT INTO public.players (
      first_name,
      last_name,
      date_of_birth
    )
    VALUES (
      btrim(v_row.first_name),
      btrim(v_row.last_name),
      v_row.birth_date
    )
    RETURNING id INTO v_player_id;
  END IF;

  IF NOT v_linked_on_site THEN
    -- One registration per Sports Connect Player Id per season: say who already has it.
    IF nullif(btrim(v_row.external_player_id), '') IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.player_seasons ps
      WHERE ps.season_id = v_row.batch_season_id AND ps.external_player_id = btrim(v_row.external_player_id)
    ) THEN
      RAISE EXCEPTION 'Player Id % is already registered this season to %. Fix the Player Id in Sports Connect and import this row again.',
        btrim(v_row.external_player_id),
        (SELECT p.first_name || ' ' || p.last_name FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id
         WHERE ps.season_id = v_row.batch_season_id AND ps.external_player_id = btrim(v_row.external_player_id) LIMIT 1);
    END IF;

    IF v_bib IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.player_seasons ps
      WHERE ps.season_id = v_row.batch_season_id AND ps.evaluation_number = v_bib
    ) THEN
      v_bib_note := format('Bib %s is already used by another player, so no bib was set from the Registration Number.', v_bib);
      v_bib := NULL;
    END IF;

    INSERT INTO public.player_seasons (
      player_id,
      season_id,
      season_division_id,
      external_registration_id,
      external_player_id,
      league_age,
      evaluation_number,
      team_id,
      registration_payment_status,
      is_coach_kid
    )
    VALUES (
      v_player_id,
      v_row.batch_season_id,
      NULL,
      nullif(btrim(v_row.registration_number), ''),
      nullif(btrim(v_row.external_player_id), ''),
      v_row.league_age,
      v_bib,
      NULL,
      COALESCE(NULLIF(BTRIM(v_row.payment_status), ''), 'UNKNOWN'),
      COALESCE(v_row.coach_kid, false)
    )
    RETURNING id INTO v_player_season_id;
  END IF;

  UPDATE public.sports_connect_import_rows
  SET review_state = 'committed',
      matched_player_id = v_player_id,
      committed_player_season_id = v_player_season_id
  WHERE id = p_row_id;

  SELECT to_jsonb(r)
    INTO v_after
  FROM public.sports_connect_import_rows AS r
  WHERE r.id = p_row_id;

  UPDATE public.import_batches
  SET rows_processed = rows_processed + 1
  WHERE id = v_row.import_batch_id;

  INSERT INTO public.audit_log (
    actor_user_id, action, target_table, target_id, reason, before_data, after_data
  )
  VALUES (
    v_actor,
    'sports_connect_import_row_committed',
    'sports_connect_import_rows',
    p_row_id::text,
    btrim(p_reason),
    v_before,
    jsonb_build_object(
      'staged_row', v_after,
      'player_id', v_player_id,
      'player_season_id', v_player_season_id,
      'season_id', v_row.batch_season_id,
      'linked_on_site_registration', v_linked_on_site,
      'evaluation_number', (SELECT evaluation_number FROM public.player_seasons WHERE id = v_player_season_id),
      'bib_note', v_bib_note
    )
  );

  RETURN v_player_season_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_duplicate_player_id_warning(p_row_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
  v_flags jsonb;
  v_state text;
BEGIN
  IF v_actor IS NULL OR NOT public.can_register(private.import_row_season(p_row_id)) THEN
    RAISE EXCEPTION 'Administrator access required'
      USING ERRCODE = '42501';
  END IF;

  IF length(btrim(coalesce(p_reason, ''))) < 5
     OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION
      'Provide a resolution reason between 5 and 1000 characters';
  END IF;

  SELECT to_jsonb(r),
         r.review_flags,
         r.review_state
    INTO v_before, v_flags, v_state
  FROM public.sports_connect_import_rows AS r
  WHERE r.id = p_row_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staged import row not found';
  END IF;

  IF v_state = 'committed' THEN
    RAISE EXCEPTION 'Committed rows cannot be changed';
  END IF;

  IF NOT (
    coalesce(v_flags, '[]'::jsonb)
      @> '["Duplicate Player ID in file"]'::jsonb
  ) THEN
    RAISE EXCEPTION
      'This row does not have the duplicate Player ID in file warning';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sports_connect_import_rows AS r
    WHERE r.id = p_row_id
      AND r.duplicate_player_id_resolved_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'The duplicate Player ID warning has already been resolved';
  END IF;

  UPDATE public.sports_connect_import_rows
  SET duplicate_player_id_resolved_at = clock_timestamp(),
      duplicate_player_id_resolved_by = v_actor,
      duplicate_player_id_resolution_reason = btrim(p_reason)
  WHERE id = p_row_id;

  SELECT to_jsonb(r)
    INTO v_after
  FROM public.sports_connect_import_rows AS r
  WHERE r.id = p_row_id;

  INSERT INTO public.audit_log (
    actor_user_id,
    action,
    target_table,
    target_id,
    reason,
    before_data,
    after_data
  )
  VALUES (
    v_actor,
    'sports_connect_duplicate_player_id_resolved',
    'sports_connect_import_rows',
    p_row_id::text,
    btrim(p_reason),
    v_before,
    v_after
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_ignored_sports_connect_import_row(p_row_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.can_register(private.import_row_season(p_row_id)) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  IF length(trim(coalesce(p_reason, ''))) < 5 OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'Provide a reopening reason between 5 and 1000 characters';
  END IF;

  SELECT to_jsonb(r)
  INTO v_before
  FROM public.sports_connect_import_rows r
  WHERE r.id = p_row_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staged import row not found';
  END IF;

  IF v_before->>'review_state' = 'committed' THEN
    RAISE EXCEPTION 'Committed rows cannot be reopened';
  END IF;

  IF v_before->>'review_state' <> 'ignored' THEN
    RAISE EXCEPTION 'Only ignored rows can be reopened';
  END IF;

  UPDATE public.sports_connect_import_rows
  SET review_state = 'needs_review',
      matched_player_id = NULL
  WHERE id = p_row_id;

  SELECT to_jsonb(r)
  INTO v_after
  FROM public.sports_connect_import_rows r
  WHERE r.id = p_row_id;

  INSERT INTO public.audit_log(
    actor_user_id, action, target_table, target_id, reason, before_data, after_data
  )
  VALUES (
    v_actor,
    'sports_connect_import_row_reopened',
    'sports_connect_import_rows',
    p_row_id::text,
    trim(p_reason),
    v_before,
    v_after
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_import_row_changes(p_row_id bigint, p_fields text[], p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_row record;
  v_snap jsonb;
  v_change jsonb;
  v_field text;
  v_fields text[] := COALESCE(p_fields, '{}');
  v_new jsonb := '[]'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_applied integer := 0;
  v_owner text;
BEGIN
  IF v_actor IS NULL OR NOT public.can_register(private.import_row_season(p_row_id)) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'Give a reason between 5 and 1000 characters.';
  END IF;

  SELECT r.*, b.season_id, s.is_closed, ps.player_id AS reg_player_id
    INTO v_row
  FROM public.sports_connect_import_rows r
  JOIN public.import_batches b ON b.id = r.import_batch_id
  JOIN public.seasons s ON s.id = b.season_id
  LEFT JOIN public.player_seasons ps ON ps.id = r.existing_player_season_id
  WHERE r.id = p_row_id
  FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staged import row not found'; END IF;
  IF v_row.review_state <> 'has_changes' THEN RAISE EXCEPTION 'This row has no changes waiting.'; END IF;
  IF v_row.is_closed THEN RAISE EXCEPTION 'This season is closed.'; END IF;
  IF v_row.reg_player_id IS NULL THEN RAISE EXCEPTION 'The existing registration no longer exists. Stage the file again.'; END IF;

  FOREACH v_field IN ARRAY v_fields LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_row.sync_changes) c WHERE c->>'field' = v_field AND NOT (c->>'auto')::boolean) THEN
      RAISE EXCEPTION 'No waiting change for %.', v_field;
    END IF;
  END LOOP;

  PERFORM 1 FROM public.player_seasons WHERE id = v_row.existing_player_season_id FOR UPDATE;
  v_snap := private.import_sync_snapshot(v_row.existing_player_season_id);

  FOR v_change IN SELECT value FROM jsonb_array_elements(v_row.sync_changes) LOOP
    IF (v_change->>'auto')::boolean OR NOT (v_change->>'field' = ANY (v_fields)) THEN
      v_new := v_new || CASE WHEN (v_change->>'auto')::boolean THEN v_change ELSE v_change || '{"applied": false}'::jsonb END;
      CONTINUE;
    END IF;
    v_field := v_change->>'field';
    IF v_change->>'blocked' IS NOT NULL THEN
      RAISE EXCEPTION '%', v_change->>'blocked';
    END IF;
    IF v_snap->>v_field IS DISTINCT FROM v_change->>'current' THEN
      RAISE EXCEPTION '% was changed in the app after this file was staged (now %). Stage the file again to compare.',
        v_change->>'label', NULLIF(v_snap->>v_field, '');
    END IF;

    IF v_field = 'name' THEN
      UPDATE public.players SET first_name = btrim(v_row.first_name), last_name = btrim(v_row.last_name), updated_at = now()
      WHERE id = v_row.reg_player_id;
    ELSIF v_field = 'birth_date' THEN
      UPDATE public.players SET date_of_birth = v_row.birth_date, updated_at = now() WHERE id = v_row.reg_player_id;
    ELSIF v_field = 'league_age' THEN
      IF EXISTS (SELECT 1 FROM public.evaluations e WHERE e.player_season_id = v_row.existing_player_season_id) THEN
        RAISE EXCEPTION 'This player already has scores, so the age group can''t change.';
      END IF;
      UPDATE public.player_seasons SET league_age = v_row.league_age, league_age_source = 'import'
      WHERE id = v_row.existing_player_season_id;
    ELSIF v_field = 'bib' THEN
      v_owner := private.bib_owner_label(v_row.season_id, (v_change->>'incoming')::integer, v_row.existing_player_season_id);
      IF v_owner IS NOT NULL THEN
        RAISE EXCEPTION 'Bib % is already used by %.', v_change->>'incoming', v_owner;
      END IF;
      UPDATE public.player_seasons SET evaluation_number = (v_change->>'incoming')::integer
      WHERE id = v_row.existing_player_season_id;
    ELSIF v_field = 'coach_kid' THEN
      UPDATE public.player_seasons SET is_coach_kid = (v_change->>'incoming' = 'Yes')
      WHERE id = v_row.existing_player_season_id;
    END IF;

    v_before := v_before || jsonb_build_object(v_field, v_change->'current');
    v_after := v_after || jsonb_build_object(v_field, v_change->'incoming');
    v_new := v_new || (v_change || '{"applied": true}'::jsonb);
    v_applied := v_applied + 1;
  END LOOP;

  UPDATE public.sports_connect_import_rows SET sync_changes = v_new, review_state = 'changes_reviewed' WHERE id = p_row_id;

  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'registration_synced_from_import', 'player_seasons', v_row.existing_player_season_id::text,
          btrim(p_reason),
          jsonb_build_object('import_row_id', p_row_id, 'values', v_before),
          jsonb_build_object('import_row_id', p_row_id, 'values', v_after,
                             'kept', (SELECT COALESCE(jsonb_agg(c->>'field'), '[]'::jsonb) FROM jsonb_array_elements(v_new) c
                                      WHERE NOT (c->>'auto')::boolean AND NOT (c->>'applied')::boolean)));
  RETURN v_applied;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_commit_clean_import_rows(p_batch_id bigint, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_season_id bigint;
  v_row public.sports_connect_import_rows;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_register(private.batch_season(p_batch_id)) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Give a reason (at least 5 characters).';
  END IF;
  SELECT season_id INTO v_season_id FROM public.import_batches WHERE id = p_batch_id AND import_type = 'players';
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Import batch not found.';
  END IF;

  -- One row at a time, re-checking each, so rows earlier in the loop count as "already registered".
  FOR v_row IN SELECT * FROM public.sports_connect_import_rows WHERE import_batch_id = p_batch_id ORDER BY source_row_number
  LOOP
    CONTINUE WHEN NOT private.import_row_is_clean(v_row, v_season_id);
    PERFORM public.review_sports_connect_import_row(v_row.id, 'approved_new', NULL, btrim(p_reason));
    PERFORM public.commit_sports_connect_import_row(v_row.id, btrim(p_reason));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_ignore_out_of_scope_import_rows(p_batch_id bigint, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_register(private.batch_season(p_batch_id)) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Give a reason (at least 5 characters).';
  END IF;
  FOR v_row IN
    SELECT r.id FROM public.sports_connect_import_rows r
    WHERE r.import_batch_id = p_batch_id AND r.review_state IN ('needs_review', 'ready_for_match_review')
      AND upper(btrim(r.source_division)) NOT IN ('AA', 'AAA', 'MAJORS', 'JUNIORS', 'SENIORS')
    ORDER BY r.source_row_number
  LOOP
    PERFORM public.review_sports_connect_import_row(v_row.id, 'ignored', NULL, btrim(p_reason));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
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
  IF v_actor IS NULL OR NOT public.can_register(p_season_id) THEN
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
  IF auth.uid() IS NULL OR NOT public.can_register(private.batch_season(p_batch_id)) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_before FROM public.bib_import_rows WHERE import_batch_id = p_batch_id AND status = 'held';
  PERFORM private.refresh_bib_batch(p_batch_id);
  SELECT count(*) INTO v_after FROM public.bib_import_rows WHERE import_batch_id = p_batch_id AND status = 'held';
  RETURN v_before - v_after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_bib_import(p_batch_id bigint, p_accept_change_row_ids bigint[] DEFAULT '{}'::bigint[])
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
  IF v_actor IS NULL OR NOT public.can_register(private.batch_season(p_batch_id)) THEN
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

CREATE OR REPLACE FUNCTION public.admin_save_registration(p_player_season_id bigint, p_first_name text, p_last_name text, p_date_of_birth date, p_league_age integer, p_evaluation_number integer, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reg record;
  v_before jsonb;
  v_after jsonb;
  v_identity_changed boolean;
  v_age_changed boolean;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_owner text;
BEGIN
  IF v_actor IS NULL OR NOT public.can_register(private.registration_season(p_player_season_id)) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  SELECT ps.id, ps.season_id, ps.player_id, ps.league_age, ps.evaluation_number, ps.league_age_source,
         p.first_name, p.last_name, p.date_of_birth, s.is_closed
  INTO v_reg
  FROM public.player_seasons ps
  JOIN public.players p ON p.id = ps.player_id
  JOIN public.seasons s ON s.id = ps.season_id
  WHERE ps.id = p_player_season_id
  FOR UPDATE OF ps, p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player registration was not found.';
  END IF;
  IF v_reg.is_closed THEN
    RAISE EXCEPTION 'This season is closed. Reopen it before changing registrations.';
  END IF;
  IF btrim(COALESCE(p_first_name, '')) = '' OR btrim(COALESCE(p_last_name, '')) = '' THEN
    RAISE EXCEPTION 'First and last name are required.';
  END IF;
  IF p_league_age IS NOT NULL AND (p_league_age < 4 OR p_league_age > 18) THEN
    RAISE EXCEPTION 'League age must be between 4 and 18.';
  END IF;
  IF p_evaluation_number IS NOT NULL AND p_evaluation_number < 1 THEN
    RAISE EXCEPTION 'Bib numbers must be positive whole numbers.';
  END IF;

  v_identity_changed := btrim(p_first_name) IS DISTINCT FROM v_reg.first_name
                        OR btrim(p_last_name) IS DISTINCT FROM v_reg.last_name
                        OR p_date_of_birth IS DISTINCT FROM v_reg.date_of_birth;
  v_age_changed := p_league_age IS DISTINCT FROM v_reg.league_age;

  IF (v_identity_changed OR v_age_changed) AND (v_reason IS NULL OR char_length(v_reason) < 5) THEN
    RAISE EXCEPTION 'Give a reason (at least 5 characters) for changing the name, birthdate, or age group.';
  END IF;

  IF v_age_changed AND EXISTS (SELECT 1 FROM public.evaluations e WHERE e.player_season_id = p_player_season_id) THEN
    RAISE EXCEPTION 'This player already has evaluations in age group %. The age group cannot change now.', v_reg.league_age;
  END IF;

  IF p_evaluation_number IS NOT NULL AND p_evaluation_number IS DISTINCT FROM v_reg.evaluation_number THEN
    v_owner := private.bib_owner_label(v_reg.season_id, p_evaluation_number, p_player_season_id);
    IF v_owner IS NOT NULL THEN
      RAISE EXCEPTION 'Bib % is already used by % this season.', p_evaluation_number, v_owner;
    END IF;
  END IF;

  v_before := jsonb_build_object('first_name', v_reg.first_name, 'last_name', v_reg.last_name, 'date_of_birth', v_reg.date_of_birth,
                                 'league_age', v_reg.league_age, 'league_age_source', v_reg.league_age_source, 'evaluation_number', v_reg.evaluation_number);

  IF v_identity_changed THEN
    UPDATE public.players
    SET first_name = btrim(p_first_name), last_name = btrim(p_last_name), date_of_birth = p_date_of_birth, updated_at = now()
    WHERE id = v_reg.player_id;
  END IF;

  UPDATE public.player_seasons
  SET league_age = p_league_age,
      league_age_source = CASE WHEN v_age_changed THEN 'admin' ELSE league_age_source END,
      evaluation_number = p_evaluation_number
  WHERE id = p_player_season_id;

  v_after := jsonb_build_object('first_name', btrim(p_first_name), 'last_name', btrim(p_last_name), 'date_of_birth', p_date_of_birth,
                                'league_age', p_league_age,
                                'league_age_source', CASE WHEN v_age_changed THEN 'admin' ELSE v_reg.league_age_source END,
                                'evaluation_number', p_evaluation_number);

  IF v_before IS DISTINCT FROM v_after THEN
    INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
    VALUES (v_actor, 'registration_admin_update', 'player_seasons', p_player_season_id::text,
            COALESCE(v_reason, 'Bib change'), v_before, v_after);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_coach_kid(p_player_season_id bigint, p_value boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_before boolean;
  v_closed boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_register(private.registration_season(p_player_season_id)) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  SELECT ps.is_coach_kid, s.is_closed INTO v_before, v_closed
  FROM public.player_seasons ps JOIN public.seasons s ON s.id = ps.season_id
  WHERE ps.id = p_player_season_id FOR UPDATE OF ps;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found.'; END IF;
  IF v_closed THEN RAISE EXCEPTION 'This season is closed.'; END IF;
  IF v_before = coalesce(p_value, false) THEN RETURN; END IF;
  UPDATE public.player_seasons SET is_coach_kid = coalesce(p_value, false) WHERE id = p_player_season_id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (auth.uid(), 'coach_kid_set', 'player_seasons', p_player_season_id::text, NULL,
          jsonb_build_object('is_coach_kid', v_before), jsonb_build_object('is_coach_kid', coalesce(p_value, false)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_batch_bulk_counts(p_batch_id bigint)
 RETURNS TABLE(clean_rows integer, out_of_scope_rows integer, out_of_scope_programs text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    (SELECT count(*)::int FROM public.sports_connect_import_rows r WHERE r.import_batch_id = b.id AND private.import_row_is_clean(r, b.season_id)),
    (SELECT count(*)::int FROM public.sports_connect_import_rows r WHERE r.import_batch_id = b.id
       AND r.review_state IN ('needs_review', 'ready_for_match_review')
       AND upper(btrim(r.source_division)) NOT IN ('AA', 'AAA', 'MAJORS', 'JUNIORS', 'SENIORS')),
    (SELECT string_agg(DISTINCT btrim(r.source_program) || ' / ' || btrim(r.source_division), '; ')
       FROM public.sports_connect_import_rows r WHERE r.import_batch_id = b.id
       AND r.review_state IN ('needs_review', 'ready_for_match_review')
       AND upper(btrim(r.source_division)) NOT IN ('AA', 'AAA', 'MAJORS', 'JUNIORS', 'SENIORS'))
  FROM public.import_batches b
  WHERE b.id = p_batch_id AND public.can_register(b.season_id);
$function$;

CREATE OR REPLACE FUNCTION public.import_batch_missing_registrations(p_batch_id bigint)
 RETURNS TABLE(player_season_id bigint, player_name text, external_player_id text, league_age integer, evaluation_number integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT ps.id, p.first_name || ' ' || p.last_name, ps.external_player_id, ps.league_age, ps.evaluation_number
  FROM public.import_batches b
  JOIN public.player_seasons ps ON ps.season_id = b.season_id
  JOIN public.players p ON p.id = ps.player_id
  WHERE b.id = p_batch_id AND public.can_register(b.season_id)
    AND ps.external_player_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.sports_connect_import_rows r
                    WHERE r.import_batch_id = b.id AND btrim(r.external_player_id) = ps.external_player_id)
  ORDER BY p.last_name, p.first_name;
$function$;

-- Fix (re-import, 20261113180000): rows for players already registered are not "waiting in import review".
-- Without this, a bib upload after a re-import held every player with "Player Id is on more than one registration".
CREATE OR REPLACE FUNCTION private.match_registration(p_season_id bigint, p_external_player_id text, p_first_name text, p_last_name text, p_birth_date date)
 RETURNS TABLE(player_season_id bigint, state text, message text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
                   AND r.review_state NOT IN ('ignored', 'committed', 'up_to_date', 'has_changes', 'changes_reviewed'))
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
                 AND r.review_state NOT IN ('ignored', 'committed', 'up_to_date', 'has_changes', 'changes_reviewed')) THEN
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
