-- People admin (decided 2026-11-11): admins invite coaches and independent evaluators in the app.
-- Accounts are created by the server with the Supabase secret key (auth admin API). Roles and names go
-- through these audited functions.
-- Rule: an account never holds both the coach and the independent-evaluator role in the same season
-- (one person doing both uses two accounts). Enforced by trigger, so direct inserts can't break it.

CREATE OR REPLACE FUNCTION public.enforce_one_evaluator_role_per_season()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.role_name IN ('coach', 'independent_evaluator') AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = NEW.user_id AND ur.season_id = NEW.season_id AND ur.id IS DISTINCT FROM NEW.id
      AND ur.role_name IN ('coach', 'independent_evaluator') AND ur.role_name <> NEW.role_name
  ) THEN
    RAISE EXCEPTION 'An account can''t be both a coach and an independent evaluator in the same season. Use a second account with a different email.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER user_roles_one_evaluator_role_per_season
BEFORE INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_one_evaluator_role_per_season();

-- ---------- give a role ----------
CREATE OR REPLACE FUNCTION public.admin_grant_role(p_user_id uuid, p_role text, p_season_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_season bigint := CASE WHEN p_role = 'administrator' THEN NULL ELSE p_season_id END;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('administrator', 'coach', 'independent_evaluator') THEN
    RAISE EXCEPTION 'Unknown role.';
  END IF;
  IF p_role <> 'administrator' AND NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = p_season_id) THEN
    RAISE EXCEPTION 'Choose a season for coach and evaluator roles.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'Account not found.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_user_id AND ur.role_name = p_role AND ur.season_id IS NOT DISTINCT FROM v_season) THEN
    RETURN;
  END IF;

  INSERT INTO public.user_roles (user_id, role_name, season_id, created_by) VALUES (p_user_id, p_role, v_season, v_actor);
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'role_granted', 'user_roles', p_user_id::text, NULL, NULL,
          jsonb_build_object('role', p_role, 'season_id', v_season));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_grant_role(uuid, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_role(uuid, text, bigint) TO authenticated;

-- ---------- take a role away ----------
CREATE OR REPLACE FUNCTION public.admin_revoke_role(p_user_id uuid, p_role text, p_season_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_season bigint := CASE WHEN p_role = 'administrator' THEN NULL ELSE p_season_id END;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_role = 'administrator' AND p_user_id = v_actor THEN
    RAISE EXCEPTION 'You can''t remove your own administrator role. Ask another administrator.';
  END IF;
  IF p_role = 'administrator' AND (SELECT count(*) FROM public.user_roles WHERE role_name = 'administrator') <= 1 THEN
    RAISE EXCEPTION 'The league needs at least one administrator.';
  END IF;
  IF p_role IN ('coach', 'independent_evaluator') AND EXISTS (
    SELECT 1 FROM public.evaluator_assignments ea JOIN public.evaluation_sessions es ON es.id = ea.evaluation_session_id
    WHERE ea.evaluator_user_id = p_user_id AND es.season_id = v_season
  ) THEN
    RAISE EXCEPTION 'This person is still assigned to age groups this season. Remove them on the Assignments page first.';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = p_user_id AND role_name = p_role AND season_id IS NOT DISTINCT FROM v_season;
  IF FOUND THEN
    INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
    VALUES (v_actor, 'role_revoked', 'user_roles', p_user_id::text, NULL,
            jsonb_build_object('role', p_role, 'season_id', v_season), NULL);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_revoke_role(uuid, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_role(uuid, text, bigint) TO authenticated;

-- ---------- display name ----------
CREATE OR REPLACE FUNCTION public.admin_set_display_name(p_user_id uuid, p_display_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.user_profiles (user_id, display_name) VALUES (p_user_id, NULLIF(btrim(COALESCE(p_display_name, '')), ''))
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_display_name(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_display_name(uuid, text) TO authenticated;

-- ---------- audit account events done through the auth admin API (invite, disable, enable) ----------
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
  IF p_action NOT IN ('account_invited', 'account_invite_resent', 'account_disabled', 'account_enabled') THEN
    RAISE EXCEPTION 'Unknown account event.';
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (auth.uid(), p_action, 'auth.users', p_user_id::text, NULL, NULL, p_detail);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_log_account_event(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_log_account_event(uuid, text, jsonb) TO authenticated;
