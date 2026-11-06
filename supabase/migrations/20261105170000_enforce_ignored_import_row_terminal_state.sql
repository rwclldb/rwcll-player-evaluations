-- Make ignored Sports Connect rows terminal during ordinary review.
-- Reopening requires a separate administrator-only RPC and an audit reason.
-- Apply to LOCAL Supabase only.

CREATE OR REPLACE FUNCTION public.review_sports_connect_import_row(
  p_row_id bigint,
  p_decision text,
  p_matched_player_id bigint DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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

REVOKE ALL ON FUNCTION public.review_sports_connect_import_row(bigint, text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_sports_connect_import_row(bigint, text, bigint, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.reopen_ignored_sports_connect_import_row(
  p_row_id bigint,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
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

REVOKE ALL ON FUNCTION public.reopen_ignored_sports_connect_import_row(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_ignored_sports_connect_import_row(bigint, text) TO authenticated;
