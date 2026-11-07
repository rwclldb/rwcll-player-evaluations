
-- Administrator-only account roster for evaluator assignment.
-- This function is intentionally read-only.

CREATE OR REPLACE FUNCTION public.admin_list_evaluator_candidates()
RETURNS TABLE (
  user_id uuid,
  email text,
  display_name text,
  email_confirmed boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access is required.';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    p.display_name,
    (u.email_confirmed_at IS NOT NULL)
  FROM auth.users AS u
  LEFT JOIN public.user_profiles AS p
    ON p.user_id = u.id
  ORDER BY u.email;
END;
$function$;

REVOKE ALL ON FUNCTION
  public.admin_list_evaluator_candidates()
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.admin_list_evaluator_candidates()
  TO authenticated;
