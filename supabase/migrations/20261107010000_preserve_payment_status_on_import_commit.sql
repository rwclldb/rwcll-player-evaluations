-- Preserve the payment status captured in the Sports Connect staging row.
-- Apply to LOCAL Supabase first. Do not apply to hosted Supabase without explicit approval.
-- Existing committed registrations are not modified by this migration; it updates only the
-- commit RPC used for future commits.


-- Prevent matched-player imports from creating duplicate season registrations.
-- Apply to LOCAL Supabase first. Do not apply to hosted Supabase without
-- explicit approval.

BEGIN;

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

  -- Preserve safe retry behavior.
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

    -- Lock and verify the selected master player. Matching never
    -- overwrites their name or date of birth.
    PERFORM 1
    FROM public.players AS p
    WHERE p.id = v_row.matched_player_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected player no longer exists';
    END IF;

    v_player_id := v_row.matched_player_id;

    -- A player can have only one registration per season.
    -- Do not silently reuse an existing registration: its external
    -- identifiers or other registration details may differ.
    IF EXISTS (
      SELECT 1
      FROM public.player_seasons AS ps
      WHERE ps.player_id = v_player_id
        AND ps.season_id = v_row.batch_season_id
    ) THEN
      RAISE EXCEPTION
        'The selected player already has a registration for this season. Review the existing registration and resolve the conflicting import identifiers before committing.';
    END IF;

  ELSE
    -- approved_new is an explicit admin decision. Do not silently
    -- merge with a possible match.
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
    'sports_connect_import_row_committed',
    'sports_connect_import_rows',
    p_row_id::text,
    btrim(p_reason),
    v_before,
    jsonb_build_object(
      'staged_row', v_after,
      'player_id', v_player_id,
      'player_season_id', v_player_season_id,
      'season_id', v_row.batch_season_id
    )
  );

  RETURN v_player_season_id;
END;
$function$;

REVOKE ALL ON FUNCTION
  public.commit_sports_connect_import_row(bigint, text)
  FROM PUBLIC;

REVOKE ALL ON FUNCTION
  public.commit_sports_connect_import_row(bigint, text)
  FROM anon;

GRANT EXECUTE ON FUNCTION
  public.commit_sports_connect_import_row(bigint, text)
  TO authenticated;

COMMIT;
