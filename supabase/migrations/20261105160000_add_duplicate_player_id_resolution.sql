
-- Require an explicit, auditable resolution before a staged row
-- carrying a duplicate-in-file Player ID warning can be committed.
-- Apply locally first; do not apply to the hosted database yet.

ALTER TABLE public.sports_connect_import_rows
  ADD COLUMN duplicate_player_id_resolved_at timestamptz,
  ADD COLUMN duplicate_player_id_resolved_by uuid
    REFERENCES auth.users(id),
  ADD COLUMN duplicate_player_id_resolution_reason text;

COMMENT ON COLUMN public.sports_connect_import_rows.duplicate_player_id_resolved_at
  IS 'When an administrator explicitly resolved the duplicate Player ID in file warning. The original review_flags are preserved.';

COMMENT ON COLUMN public.sports_connect_import_rows.duplicate_player_id_resolved_by
  IS 'Administrator who explicitly resolved the duplicate Player ID in file warning.';

COMMENT ON COLUMN public.sports_connect_import_rows.duplicate_player_id_resolution_reason
  IS 'Required explanation for resolving the duplicate Player ID in file warning.';

CREATE OR REPLACE FUNCTION public.resolve_duplicate_player_id_warning(
  p_row_id bigint,
  p_reason text
)
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
  IF v_actor IS NULL OR NOT public.is_admin() THEN
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

REVOKE ALL ON FUNCTION
  public.resolve_duplicate_player_id_warning(bigint, text)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.resolve_duplicate_player_id_warning(bigint, text)
  TO authenticated;


-- Defense in depth: even if an application action accidentally attempts
-- to commit the row, the database refuses while the warning is unresolved.
CREATE OR REPLACE FUNCTION public.enforce_duplicate_player_id_resolution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.review_state = 'committed'
     AND OLD.review_state IS DISTINCT FROM 'committed'
     AND coalesce(NEW.review_flags, '[]'::jsonb)
       @> '["Duplicate Player ID in file"]'::jsonb
     AND NEW.duplicate_player_id_resolved_at IS NULL THEN
    RAISE EXCEPTION
      'Resolve the Duplicate Player ID in file warning before committing this row';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER enforce_duplicate_player_id_resolution_before_commit
BEFORE UPDATE OF review_state
ON public.sports_connect_import_rows
FOR EACH ROW
EXECUTE FUNCTION public.enforce_duplicate_player_id_resolution();
