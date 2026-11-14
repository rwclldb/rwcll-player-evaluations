-- Coach's kids and private star shortlists (decided 2026-11-13).
--
-- Coach's kid: a per-season flag on a registration (player_seasons.is_coach_kid). The league's rules for
-- drafting coaches' children change often, so the app only records the flag and shows it: on the scoring
-- screen, the roster, and draft reports. Players are scored as usual. It is NOT linked to a coach.
--   * Set by admins on the Players page (admin_set_coach_kid, audited).
--   * Or from an optional "Coaches Kid" column (true/false) in the Sports Connect registration file: staged
--     as sports_connect_import_rows.coach_kid and applied when the row is committed.
--
-- Stars: any signed-in user can star players while reading a draft report (or scoring) and filter to
-- "my stars". Stars are private to their owner (admins can't read them either), per registration, so they
-- don't carry into later seasons.

ALTER TABLE public.player_seasons ADD COLUMN is_coach_kid boolean NOT NULL DEFAULT false;
ALTER TABLE public.sports_connect_import_rows ADD COLUMN coach_kid boolean;

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
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
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

REVOKE ALL ON FUNCTION public.admin_set_coach_kid(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_coach_kid(bigint, boolean) TO authenticated;

-- Registration import: "Coaches Kid" column (only the staging insert and the commit change).
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

-- ---------- private stars ----------
CREATE TABLE public.player_stars (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  player_season_id bigint NOT NULL REFERENCES public.player_seasons(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, player_season_id)
);
ALTER TABLE public.player_stars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_stars_read" ON public.player_stars FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON TABLE public.player_stars TO authenticated;

-- Star or unstar a player; returns the new state. Only players the caller can see in an age group.
CREATE OR REPLACE FUNCTION public.toggle_player_star(p_player_season_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_admin() AND NOT EXISTS (
    SELECT 1 FROM public.player_seasons ps
    JOIN public.evaluation_sessions es ON es.season_id = ps.season_id AND es.league_age = ps.league_age
    WHERE ps.id = p_player_season_id AND public.can_access_evaluation_session(es.id)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.player_seasons ps
    JOIN public.evaluation_sessions es ON es.season_id = ps.season_id AND es.league_age = ps.league_age
    JOIN public.user_roles ur ON ur.season_id = ps.season_id AND ur.user_id = v_me AND ur.role_name IN ('coach', 'independent_evaluator')
    WHERE ps.id = p_player_season_id AND es.published_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'You can only star players in age groups you can see.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.player_stars WHERE user_id = v_me AND player_season_id = p_player_season_id;
  IF FOUND THEN RETURN false; END IF;
  INSERT INTO public.player_stars (user_id, player_season_id) VALUES (v_me, p_player_season_id);
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.toggle_player_star(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_player_star(bigint) TO authenticated;
