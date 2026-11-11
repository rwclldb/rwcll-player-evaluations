-- Registration admin tools (decided 2026-11-11):
-- * Admins edit a registration: player name and birthdate, league age (age group), bib. Name, birthdate
--   and age changes need a reason. Every change is audited.
-- * Admins set the age group by hand when a birthdate is missing (league_age_source = 'admin').
-- * Admins add a player on site on evaluation day (registration_source = 'on_site'). When that child
--   later appears in a Sports Connect import and the admin approves the match, the commit links the
--   on-site registration instead of failing as a duplicate registration.

-- ---------- columns ----------
ALTER TABLE public.player_seasons
  ADD COLUMN registration_source text NOT NULL DEFAULT 'sports_connect',
  ADD COLUMN league_age_source text NOT NULL DEFAULT 'import',
  ADD CONSTRAINT player_seasons_registration_source_check CHECK (registration_source IN ('sports_connect', 'on_site')),
  ADD CONSTRAINT player_seasons_league_age_source_check CHECK (league_age_source IN ('import', 'admin'));

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION private.bib_owner_label(p_season_id bigint, p_bib integer, p_except bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT p.first_name || ' ' || p.last_name
  FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id
  WHERE ps.season_id = p_season_id AND ps.evaluation_number = p_bib AND ps.id IS DISTINCT FROM p_except
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION private.bib_owner_label(bigint, integer, bigint) FROM PUBLIC, anon, authenticated;

-- ---------- edit a registration ----------
CREATE OR REPLACE FUNCTION public.admin_save_registration(
  p_player_season_id bigint,
  p_first_name text,
  p_last_name text,
  p_date_of_birth date,
  p_league_age integer,
  p_evaluation_number integer,
  p_reason text DEFAULT NULL
)
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
  IF v_actor IS NULL OR NOT public.is_admin() THEN
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

REVOKE ALL ON FUNCTION public.admin_save_registration(bigint, text, text, date, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_registration(bigint, text, text, date, integer, integer, text) TO authenticated;

-- ---------- add a player on site ----------
-- p_player_id: reuse a known player (e.g. from a past season) chosen by the admin; NULL creates a new one.
CREATE OR REPLACE FUNCTION public.admin_add_onsite_registration(
  p_season_id bigint,
  p_player_id bigint,
  p_first_name text,
  p_last_name text,
  p_date_of_birth date,
  p_league_age integer,
  p_evaluation_number integer,
  p_reason text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_player_id bigint := p_player_id;
  v_ps_id bigint;
  v_owner text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = p_season_id AND NOT s.is_closed) THEN
    RAISE EXCEPTION 'Choose an open season.';
  END IF;
  IF p_league_age IS NULL OR p_league_age < 4 OR p_league_age > 18 THEN
    RAISE EXCEPTION 'Choose the player''s age group (league age 4 to 18).';
  END IF;
  IF p_evaluation_number IS NOT NULL AND p_evaluation_number < 1 THEN
    RAISE EXCEPTION 'Bib numbers must be positive whole numbers.';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Give a reason (at least 5 characters), for example "Walk-up at evaluations".';
  END IF;

  IF v_player_id IS NULL THEN
    IF btrim(COALESCE(p_first_name, '')) = '' OR btrim(COALESCE(p_last_name, '')) = '' THEN
      RAISE EXCEPTION 'First and last name are required.';
    END IF;
    INSERT INTO public.players (first_name, last_name, date_of_birth)
    VALUES (btrim(p_first_name), btrim(p_last_name), p_date_of_birth)
    RETURNING id INTO v_player_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = v_player_id) THEN
    RAISE EXCEPTION 'The selected player was not found.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.player_seasons ps WHERE ps.player_id = v_player_id AND ps.season_id = p_season_id) THEN
    RAISE EXCEPTION 'That player is already registered this season. Find them on the Players page instead.';
  END IF;

  IF p_evaluation_number IS NOT NULL THEN
    v_owner := private.bib_owner_label(p_season_id, p_evaluation_number, NULL);
    IF v_owner IS NOT NULL THEN
      RAISE EXCEPTION 'Bib % is already used by % this season.', p_evaluation_number, v_owner;
    END IF;
  END IF;

  INSERT INTO public.player_seasons (player_id, season_id, season_division_id, league_age, evaluation_number,
                                     registration_payment_status, registration_source, league_age_source)
  VALUES (v_player_id, p_season_id, NULL, p_league_age, p_evaluation_number, 'UNKNOWN', 'on_site', 'admin')
  RETURNING id INTO v_ps_id;

  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'registration_added_on_site', 'player_seasons', v_ps_id::text, v_reason, NULL,
          jsonb_build_object('player_id', v_player_id, 'reused_existing_player', p_player_id IS NOT NULL,
                             'season_id', p_season_id, 'league_age', p_league_age, 'evaluation_number', p_evaluation_number));
  RETURN v_ps_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_add_onsite_registration(bigint, bigint, text, text, date, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_onsite_registration(bigint, bigint, text, text, date, integer, integer, text) TO authenticated;

-- ---------- import commit: link an on-site registration ----------
-- Same as 20261107010000 except: an approved match to a player whose registration this season was added
-- on site now fills in that registration's Sports Connect details (Player Id, registration number,
-- payment status) instead of failing. Bib and the admin-set age group are kept. Any other existing
-- registration still blocks the commit.
CREATE OR REPLACE FUNCTION public.commit_sports_connect_import_row(
  p_row_id bigint,
  p_reason text
)
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
        UPDATE public.player_seasons
        SET external_registration_id = nullif(btrim(v_row.registration_number), ''),
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
      NULL,
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
      'linked_on_site_registration', v_linked_on_site
    )
  );

  RETURN v_player_season_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_sports_connect_import_row(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_sports_connect_import_row(bigint, text) TO authenticated;
