-- Bibs from Sports Connect's Registration Number (decided 2026-11-12).
-- The league keeps each player's bib (evaluation number) in Sports Connect's "Registration Number" field.
-- Committing an import row now sets the bib from it when it is a whole number and no other registration in
-- the season has that bib. Otherwise the bib stays blank (the audit entry says why) and the admin sets it
-- later by bib upload or on the Players page. Walk-ups linked to Sports Connect keep a bib given on site.
-- Only commit_sports_connect_import_row changes; the rest of the function is as in 20261111140000.

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
  IF v_actor IS NULL OR NOT public.is_admin() THEN
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
      registration_payment_status
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
      COALESCE(NULLIF(BTRIM(v_row.payment_status), ''), 'UNKNOWN')
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
