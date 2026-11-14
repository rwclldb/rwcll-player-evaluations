-- Re-importing Sports Connect exports.
--
-- The league can export the whole season from Sports Connect again and stage it. Rows whose Player Id is
-- already registered this season are compared with that registration instead of waiting in row review:
--   * up_to_date       nothing the admin needs to decide (payment status, Registration Number and an
--                      empty bib are updated automatically, audited as registration_synced_from_import)
--   * has_changes      name, birthdate, age group, bib or Coaches Kid differ; each change waits for the
--                      admin's tick on the batch page (apply_import_row_changes)
--   * changes_reviewed the admin applied the ticked changes and kept the current values for the rest
-- A row is only compared when its Player Id appears once in the file. When the name and the birthdate both
-- differ the Player Id probably belongs to another child, so the row stays in row review with a flag.
-- Nothing is ever removed: players missing from a later export are only listed
-- (import_batch_missing_registrations). Rows whose Player Id and division were ignored in an earlier batch
-- this season (out-of-scope programs) are ignored again.

ALTER TABLE public.sports_connect_import_rows
  ADD COLUMN existing_player_season_id bigint REFERENCES public.player_seasons(id) ON DELETE SET NULL,
  ADD COLUMN sync_changes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sync_changes) = 'array');

ALTER TABLE public.sports_connect_import_rows DROP CONSTRAINT sports_connect_import_rows_review_state_check;
ALTER TABLE public.sports_connect_import_rows ADD CONSTRAINT sports_connect_import_rows_review_state_check
  CHECK (review_state IN ('needs_review', 'ready_for_match_review', 'approved_new', 'approved_match', 'ignored', 'committed',
                          'up_to_date', 'has_changes', 'changes_reviewed'));

-- The values the admin compares, as display text. Used when staging and again when applying, so a
-- registration edited in between is caught.
CREATE FUNCTION private.import_sync_snapshot(p_player_season_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT jsonb_build_object(
    'name', p.first_name || ' ' || p.last_name,
    'birth_date', COALESCE(p.date_of_birth::text, ''),
    'league_age', COALESCE(ps.league_age::text, ''),
    'bib', COALESCE(ps.evaluation_number::text, ''),
    'coach_kid', CASE WHEN ps.is_coach_kid THEN 'Yes' ELSE 'No' END)
  FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id
  WHERE ps.id = p_player_season_id;
$$;

-- Compare the batch's rows with existing registrations. Called at the end of staging.
CREATE FUNCTION private.sync_import_batch(p_batch_id bigint, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_season bigint;
  v_row record;
  v_reg record;
  v_snap jsonb;
  v_changes jsonb;
  v_auto jsonb;
  v_set_bib integer;
  v_reg_number text;
  v_payment text;
  v_has_evals boolean;
  v_owner text;
  v_name_differs boolean;
  v_birth_differs boolean;
  v_ignored integer;
BEGIN
  SELECT season_id INTO v_season FROM public.import_batches WHERE id = p_batch_id;

  -- A Player Id the admin ignored in an earlier batch this season, with the same division (an out-of-scope
  -- program, usually), is ignored again. It can be reopened from the Ignored tab like any ignored row.
  UPDATE public.sports_connect_import_rows r
  SET review_state = 'ignored'
  WHERE r.import_batch_id = p_batch_id AND r.review_state = 'needs_review'
    AND NULLIF(btrim(COALESCE(r.external_player_id, '')), '') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.player_seasons ps WHERE ps.season_id = v_season AND ps.external_player_id = btrim(r.external_player_id))
    AND EXISTS (SELECT 1 FROM public.sports_connect_import_rows o JOIN public.import_batches ob ON ob.id = o.import_batch_id
                WHERE ob.season_id = v_season AND o.import_batch_id <> p_batch_id AND o.review_state = 'ignored'
                  AND btrim(o.external_player_id) = btrim(r.external_player_id)
                  AND upper(btrim(o.source_division)) = upper(btrim(r.source_division)));
  GET DIAGNOSTICS v_ignored = ROW_COUNT;
  IF v_ignored > 0 THEN
    INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, after_data)
    VALUES (p_actor, 'sports_connect_import_rows_auto_ignored', 'import_batches', p_batch_id::text,
            'Same Player Id and division were ignored in an earlier import this season',
            jsonb_build_object('rows_ignored', v_ignored));
  END IF;

  FOR v_row IN
    SELECT r.* FROM public.sports_connect_import_rows r
    WHERE r.import_batch_id = p_batch_id AND r.review_state = 'needs_review'
      AND NULLIF(btrim(COALESCE(r.external_player_id, '')), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.sports_connect_import_rows o
                      WHERE o.import_batch_id = r.import_batch_id AND o.id <> r.id
                        AND btrim(o.external_player_id) = btrim(r.external_player_id))
    ORDER BY r.source_row_number
  LOOP
    SELECT ps.id, ps.player_id, ps.league_age, ps.league_age_source, ps.evaluation_number, ps.is_coach_kid,
           ps.registration_payment_status, ps.external_registration_id, p.first_name, p.last_name, p.date_of_birth
      INTO v_reg
    FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id
    WHERE ps.season_id = v_season AND ps.external_player_id = btrim(v_row.external_player_id)
    FOR UPDATE OF ps;
    CONTINUE WHEN NOT FOUND;

    v_name_differs := btrim(v_row.first_name) IS DISTINCT FROM v_reg.first_name OR btrim(v_row.last_name) IS DISTINCT FROM v_reg.last_name;
    v_birth_differs := v_row.birth_date IS NOT NULL AND v_row.birth_date IS DISTINCT FROM v_reg.date_of_birth;

    IF v_name_differs AND v_birth_differs THEN
      -- Probably a different child carrying the same Player Id. Leave it for row review.
      UPDATE public.sports_connect_import_rows
      SET existing_player_season_id = v_reg.id,
          review_flags = review_flags || jsonb_build_array(format(
            'Player Id already registered to %s %s (born %s); name and birthdate both differ',
            v_reg.first_name, v_reg.last_name, COALESCE(v_reg.date_of_birth::text, 'unknown')))
      WHERE id = v_row.id;
      CONTINUE;
    END IF;

    v_snap := private.import_sync_snapshot(v_reg.id);
    v_has_evals := EXISTS (SELECT 1 FROM public.evaluations e WHERE e.player_season_id = v_reg.id);
    v_changes := '[]'::jsonb;
    v_auto := '[]'::jsonb;
    v_set_bib := NULL;

    IF v_name_differs THEN
      v_changes := v_changes || jsonb_build_object('field', 'name', 'label', 'Name', 'current', v_snap->>'name',
        'incoming', btrim(v_row.first_name) || ' ' || btrim(v_row.last_name));
    END IF;
    IF v_birth_differs THEN
      v_changes := v_changes || jsonb_build_object('field', 'birth_date', 'label', 'Birthdate', 'current', v_snap->>'birth_date',
        'incoming', v_row.birth_date::text);
    END IF;
    IF v_row.league_age IS NOT NULL AND v_row.league_age IS DISTINCT FROM v_reg.league_age THEN
      v_changes := v_changes || jsonb_build_object('field', 'league_age', 'label', 'Age group', 'current', v_snap->>'league_age',
        'incoming', v_row.league_age::text,
        'note', CASE WHEN v_reg.league_age_source = 'admin' THEN 'The current age group was set by hand on the Players page.' END,
        'blocked', CASE WHEN v_has_evals THEN 'This player already has scores in age group ' || v_reg.league_age || ', so the age group can''t change.' END);
    END IF;

    v_reg_number := NULLIF(btrim(COALESCE(v_row.registration_number, '')), '');
    IF v_reg_number ~ '^[0-9]{1,9}$' AND v_reg_number::integer > 0 AND v_reg_number::integer IS DISTINCT FROM v_reg.evaluation_number THEN
      v_owner := private.bib_owner_label(v_season, v_reg_number::integer, v_reg.id);
      IF v_reg.evaluation_number IS NULL AND v_owner IS NULL THEN
        v_set_bib := v_reg_number::integer;
        v_auto := v_auto || jsonb_build_object('field', 'bib', 'label', 'Bib', 'current', '', 'incoming', v_reg_number);
      ELSE
        v_changes := v_changes || jsonb_build_object('field', 'bib', 'label', 'Bib (from Registration Number)',
          'current', v_snap->>'bib', 'incoming', v_reg_number,
          'blocked', CASE WHEN v_owner IS NOT NULL THEN 'Bib ' || v_reg_number || ' is already used by ' || v_owner || '.' END);
      END IF;
    END IF;

    IF v_row.coach_kid IS NOT NULL AND v_row.coach_kid IS DISTINCT FROM v_reg.is_coach_kid THEN
      v_changes := v_changes || jsonb_build_object('field', 'coach_kid', 'label', 'Coach''s kid', 'current', v_snap->>'coach_kid',
        'incoming', CASE WHEN v_row.coach_kid THEN 'Yes' ELSE 'No' END);
    END IF;

    v_payment := COALESCE(NULLIF(btrim(v_row.payment_status), ''), 'UNKNOWN');
    IF v_payment IS DISTINCT FROM v_reg.registration_payment_status THEN
      v_auto := v_auto || jsonb_build_object('field', 'payment_status', 'label', 'Payment status',
        'current', v_reg.registration_payment_status, 'incoming', v_payment);
    END IF;
    -- Registration Numbers are unique per season; leave it alone when another registration has it.
    IF v_reg_number IS DISTINCT FROM v_reg.external_registration_id AND NOT EXISTS (
      SELECT 1 FROM public.player_seasons o WHERE o.season_id = v_season AND o.id <> v_reg.id AND o.external_registration_id = v_reg_number
    ) THEN
      v_auto := v_auto || jsonb_build_object('field', 'registration_number', 'label', 'Registration Number',
        'current', COALESCE(v_reg.external_registration_id, ''), 'incoming', COALESCE(v_reg_number, ''));
    END IF;

    IF jsonb_array_length(v_auto) > 0 THEN
      UPDATE public.player_seasons
      SET registration_payment_status = v_payment,
          external_registration_id = CASE WHEN v_auto @> '[{"field": "registration_number"}]' THEN v_reg_number ELSE external_registration_id END,
          evaluation_number = COALESCE(v_set_bib, evaluation_number)
      WHERE id = v_reg.id;
      INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
      VALUES (p_actor, 'registration_synced_from_import', 'player_seasons', v_reg.id::text,
              format('Updated automatically from Sports Connect import batch %s, line %s', p_batch_id, v_row.source_row_number),
              (SELECT jsonb_object_agg(c->>'field', c->'current') FROM jsonb_array_elements(v_auto) c),
              (SELECT jsonb_object_agg(c->>'field', c->'incoming') FROM jsonb_array_elements(v_auto) c));
    END IF;

    UPDATE public.sports_connect_import_rows
    SET existing_player_season_id = v_reg.id,
        sync_changes = (SELECT COALESCE(jsonb_agg(c || jsonb_build_object('auto', true, 'applied', true)), '[]'::jsonb) FROM jsonb_array_elements(v_auto) c)
                       || (SELECT COALESCE(jsonb_agg(c || jsonb_build_object('auto', false)), '[]'::jsonb) FROM jsonb_array_elements(v_changes) c),
        review_state = CASE WHEN jsonb_array_length(v_changes) > 0 THEN 'has_changes' ELSE 'up_to_date' END,
        matched_player_id = v_reg.player_id
    WHERE id = v_row.id;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.import_sync_snapshot(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sync_import_batch(bigint, uuid) FROM PUBLIC, anon, authenticated;

-- Apply the ticked changes for one row. Unticked changes keep the app's current value. An empty list keeps
-- everything as it is. Returns the number of changes applied.
CREATE FUNCTION public.apply_import_row_changes(p_row_id bigint, p_fields text[], p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
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
  IF v_actor IS NULL OR NOT public.is_admin() THEN
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
$$;
REVOKE ALL ON FUNCTION public.apply_import_row_changes(bigint, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_import_row_changes(bigint, text[], text) TO authenticated;

-- Registered (from Sports Connect) this season but not in this file. A list only; nothing is removed.
CREATE FUNCTION public.import_batch_missing_registrations(p_batch_id bigint)
RETURNS TABLE (player_season_id bigint, player_name text, external_player_id text, league_age integer, evaluation_number integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT ps.id, p.first_name || ' ' || p.last_name, ps.external_player_id, ps.league_age, ps.evaluation_number
  FROM public.import_batches b
  JOIN public.player_seasons ps ON ps.season_id = b.season_id
  JOIN public.players p ON p.id = ps.player_id
  WHERE b.id = p_batch_id AND public.is_admin()
    AND ps.external_player_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.sports_connect_import_rows r
                    WHERE r.import_batch_id = b.id AND btrim(r.external_player_id) = ps.external_player_id)
  ORDER BY p.last_name, p.first_name;
$$;
REVOKE ALL ON FUNCTION public.import_batch_missing_registrations(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_batch_missing_registrations(bigint) TO authenticated;

-- ---- generated: existing functions patched below ----
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
  IF v_actor IS NULL OR NOT public.is_admin() THEN
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

CREATE OR REPLACE FUNCTION public.admin_season_roadmap(p_season_id bigint, p_today date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_season record;
  v_sessions jsonb;
  v_reg jsonb;
  v_imports jsonb;
  v_prior jsonb;
  v_people jsonb;
  v_first_primary date;
  v_last_event date;
  v_total int;
  v_open int;
  v_locked int;
  v_released int;
  v_stage text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  SELECT s.id, s.name, s.is_closed, s.start_date, s.show_prior_year_during_evaluations INTO v_season
  FROM public.seasons s WHERE s.id = p_season_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season was not found.';
  END IF;

  -- Registrations
  SELECT jsonb_build_object(
    'total', count(*),
    'no_bib', count(*) FILTER (WHERE ps.evaluation_number IS NULL AND ps.league_age IS NOT NULL),
    'no_age', count(*) FILTER (WHERE ps.league_age IS NULL),
    'on_site', count(*) FILTER (WHERE ps.registration_source = 'on_site'))
  INTO v_reg
  FROM public.player_seasons ps WHERE ps.season_id = p_season_id;

  -- Imports waiting on the admin
  SELECT jsonb_build_object(
    'registration_batches', (SELECT count(*) FROM public.import_batches b WHERE b.season_id = p_season_id AND b.import_type = 'players'),
    'registration_rows_to_review', (
      SELECT count(*) FROM public.sports_connect_import_rows r
      JOIN public.import_batches b ON b.id = r.import_batch_id
      WHERE b.season_id = p_season_id
        AND r.review_state IN ('needs_review', 'ready_for_match_review', 'approved_new', 'approved_match', 'has_changes')),
    'bib_rows_held', (
      SELECT count(*) FROM public.bib_import_rows r
      JOIN public.import_batches b ON b.id = r.import_batch_id
      WHERE b.season_id = p_season_id AND r.status = 'held'))
  INTO v_imports;

  -- Prior-year ratings (pending rows are counted across batches, as the Prior-year page does)
  SELECT jsonb_build_object(
    'players_with_prior', (
      SELECT count(DISTINCT ps.id) FROM public.player_seasons ps
      JOIN public.historical_evaluations h ON h.player_id = ps.player_id
      WHERE ps.season_id = p_season_id AND h.source_season_id IS DISTINCT FROM p_season_id),
    'rows_pending', (
      SELECT count(*) FROM public.historical_evaluation_import_rows r
      WHERE r.review_state = 'pending_review' AND r.match_status <> 'invalid'),
    'shown_while_scoring', v_season.show_prior_year_during_evaluations)
  INTO v_prior;

  -- People with a role this season
  WITH people AS (
    SELECT ur.user_id, ur.role_name, u.last_sign_in_at,
           (u.banned_until IS NOT NULL AND u.banned_until > now()) AS disabled
    FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id
    WHERE ur.season_id = p_season_id AND ur.role_name IN ('coach', 'independent_evaluator')
  )
  SELECT jsonb_build_object(
    'coaches', count(*) FILTER (WHERE role_name = 'coach'),
    'evaluators', count(*) FILTER (WHERE role_name = 'independent_evaluator'),
    'not_signed_in', count(*) FILTER (WHERE last_sign_in_at IS NULL AND NOT disabled),
    'unassigned', count(*) FILTER (WHERE NOT disabled AND NOT EXISTS (
      SELECT 1 FROM public.evaluator_assignments ea
      JOIN public.evaluation_sessions es ON es.id = ea.evaluation_session_id
      WHERE ea.evaluator_user_id = people.user_id AND es.season_id = p_season_id)))
  INTO v_people FROM people;

  -- One entry per age group
  WITH sess AS (
    SELECT es.id, es.league_age, es.status, es.published_at
    FROM public.evaluation_sessions es WHERE es.season_id = p_season_id AND es.league_age IS NOT NULL
  ),
  players AS (
    SELECT s.id AS session_id, count(ps.id) AS players,
           count(ps.id) FILTER (WHERE ps.evaluation_number IS NULL) AS no_bib
    FROM sess s LEFT JOIN public.player_seasons ps ON ps.season_id = p_season_id AND ps.league_age = s.league_age
    GROUP BY s.id
  ),
  asg AS (
    SELECT s.id AS session_id,
           count(ea.id) FILTER (WHERE ea.evaluator_type = 'coach') AS coaches,
           count(ea.id) FILTER (WHERE ea.evaluator_type = 'independent_evaluator') AS evaluators
    FROM sess s LEFT JOIN public.evaluator_assignments ea ON ea.evaluation_session_id = s.id
    GROUP BY s.id
  ),
  ev AS (
    SELECT s.id AS session_id,
           count(e.id) FILTER (WHERE e.status = 'submitted') AS submitted,
           count(e.id) FILTER (WHERE e.status = 'draft') AS drafts,
           count(DISTINCT e.player_season_id) FILTER (WHERE e.status = 'submitted' AND e.evaluator_type = 'independent_evaluator') AS players_scored_by_evaluator,
           count(DISTINCT e.player_season_id) FILTER (WHERE e.status = 'submitted' AND e.evaluator_type = 'coach') AS players_scored_by_coach,
           count(DISTINCT e.player_season_id) FILTER (WHERE e.status IN ('submitted', 'not_evaluated')) AS players_touched
    FROM sess s LEFT JOIN public.evaluations e ON e.evaluation_session_id = s.id
    GROUP BY s.id
  ),
  evt AS (
    SELECT s.id AS session_id,
           min(x.event_date) FILTER (WHERE x.event_type = 'primary') AS primary_date,
           min(x.start_time) FILTER (WHERE x.event_type = 'primary') AS primary_start,
           count(x.id) FILTER (WHERE x.event_type = 'makeup') AS makeups,
           max(x.event_date) AS last_event_date
    FROM sess s LEFT JOIN public.evaluation_session_events x ON x.evaluation_session_id = s.id
    GROUP BY s.id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'league_age', s.league_age, 'status', s.status, 'released', s.published_at IS NOT NULL,
           'players', p.players, 'no_bib', p.no_bib,
           'coaches', a.coaches, 'evaluators', a.evaluators,
           'submitted', ev.submitted, 'drafts', ev.drafts,
           'players_scored_by_evaluator', ev.players_scored_by_evaluator,
           'players_scored_by_coach', ev.players_scored_by_coach,
           'players_touched', ev.players_touched,
           'primary_date', evt.primary_date, 'primary_start', evt.primary_start,
           'makeups', evt.makeups, 'last_event_date', evt.last_event_date)
         ORDER BY s.league_age), '[]'::jsonb),
         min(evt.primary_date), max(evt.last_event_date),
         count(*), count(*) FILTER (WHERE s.status = 'open'),
         count(*) FILTER (WHERE s.status = 'locked'), count(*) FILTER (WHERE s.published_at IS NOT NULL)
  INTO v_sessions, v_first_primary, v_last_event, v_total, v_open, v_locked, v_released
  FROM sess s
  JOIN players p ON p.session_id = s.id
  JOIN asg a ON a.session_id = s.id
  JOIN ev ON ev.session_id = s.id
  JOIN evt ON evt.session_id = s.id;

  v_stage := CASE
    WHEN v_season.is_closed OR (v_total > 0 AND v_released = v_total) THEN 'end'
    WHEN v_locked > 0 OR v_released > 0 OR (v_last_event IS NOT NULL AND p_today > v_last_event) THEN 'after'
    WHEN v_first_primary IS NOT NULL AND p_today BETWEEN v_first_primary AND v_last_event THEN 'day'
    WHEN v_open > 0 OR (v_first_primary IS NOT NULL AND v_first_primary - p_today <= 7) THEN 'week'
    ELSE 'before'
  END;

  RETURN jsonb_build_object(
    'season', jsonb_build_object('id', v_season.id, 'name', v_season.name, 'is_closed', v_season.is_closed),
    'stage', v_stage,
    'today', p_today,
    'first_primary_date', v_first_primary,
    'last_event_date', v_last_event,
    'registrations', v_reg,
    'imports', v_imports,
    'prior_year', v_prior,
    'people', v_people,
    'sessions', v_sessions);
END;
$function$;
