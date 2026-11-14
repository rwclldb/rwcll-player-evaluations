-- "Your account" page: every signed-in person can see their name and roles, change their own name, and
-- record a password change. The sign-in email is the user name and only an admin changes it (People page).

-- Name and roles (with season names and, for coaches, divisions) of the signed-in person.
CREATE FUNCTION public.my_account()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT jsonb_build_object(
    'display_name', (SELECT up.display_name FROM public.user_profiles up WHERE up.user_id = auth.uid()),
    'roles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'role', ur.role_name,
               'season', s.name,
               'divisions', (SELECT COALESCE(jsonb_agg(d.name ORDER BY d.sort_order, d.name), '[]'::jsonb)
                             FROM public.coach_divisions cd
                             JOIN public.divisions d ON d.id = cd.division_id
                             WHERE cd.user_id = ur.user_id AND cd.season_id = ur.season_id AND ur.role_name = 'coach'))
             ORDER BY s.start_date DESC NULLS FIRST, ur.role_name)
      FROM public.user_roles ur LEFT JOIN public.seasons s ON s.id = ur.season_id
      WHERE ur.user_id = auth.uid()), '[]'::jsonb))
  WHERE auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_account() TO authenticated;

-- Change your own name. Audited like an admin's change, with you as the actor.
CREATE FUNCTION public.set_my_display_name(p_display_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_name text := btrim(COALESCE(p_display_name, ''));
  v_before text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501'; END IF;
  IF v_name = '' OR char_length(v_name) > 100 THEN
    RAISE EXCEPTION 'Enter a name between 1 and 100 characters.';
  END IF;
  SELECT display_name INTO v_before FROM public.user_profiles WHERE user_id = v_actor;
  IF v_before IS NOT DISTINCT FROM v_name THEN RETURN; END IF;
  INSERT INTO public.user_profiles (user_id, display_name) VALUES (v_actor, v_name)
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now();
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'account_name_changed', 'auth.users', v_actor::text, 'Changed by the account owner',
          jsonb_build_object('display_name', v_before), jsonb_build_object('display_name', v_name));
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_display_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_display_name(text) TO authenticated;

-- Called by the app after Supabase Auth accepts a new password (the password itself is never stored here).
CREATE FUNCTION public.log_my_password_change()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason)
  SELECT auth.uid(), 'account_password_changed', 'auth.users', auth.uid()::text, 'Changed by the account owner'
  WHERE auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.log_my_password_change() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_my_password_change() TO authenticated;
