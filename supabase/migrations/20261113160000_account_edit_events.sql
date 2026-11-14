-- Admins can correct a person's name and sign-in email on the People page (decided 2026-11-13).
-- The name goes through admin_set_display_name; the email through the auth admin API on the server.
-- Both are written to the audit log with before and after values, so the allowed account events grow.
CREATE OR REPLACE FUNCTION public.admin_log_account_event(p_user_id uuid, p_action text, p_detail jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('account_invited', 'account_invite_resent', 'account_disabled', 'account_enabled',
                      'account_name_changed', 'account_email_changed') THEN
    RAISE EXCEPTION 'Unknown account event.';
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (auth.uid(), p_action, 'auth.users', p_user_id::text, NULL, NULL, p_detail);
END;
$function$;
