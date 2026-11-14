-- Admins can delete an account that has no evaluation history (People page). Accounts that scored players,
-- wrote shared evaluator notes, coach a team or carry prior-year ratings can only be disabled, because
-- deleting them would remove or orphan that data. Admin accounts and your own account can't be deleted here.
--
-- admin_delete_account does it all in one transaction: checks again, removes the person's age-group
-- assignments and private notes, clears "done by" columns that point at them, writes an account_deleted audit
-- entry, and deletes the auth user. Roles, profile, coach divisions and stars go with it (ON DELETE CASCADE).

-- The audit log outlives accounts: keep the actor's id even after the account is gone.
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_actor_user_id_fkey;

-- Why an account can't be deleted (empty array = it can).
CREATE FUNCTION private.account_delete_blockers(p_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN p_user_id = auth.uid() THEN 'it is your own account' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role_name = 'administrator') THEN 'it is a league admin account' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.evaluations WHERE evaluator_user_id = p_user_id) THEN 'they have scored players' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.evaluator_notes WHERE author_user_id = p_user_id) THEN 'they wrote evaluator notes' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.team_coach_assignments WHERE coach_user_id = p_user_id) THEN 'they coach a team' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.historical_evaluations WHERE source_coach_user_id = p_user_id) THEN 'prior-year ratings are linked to them' END
  ], NULL);
$$;
REVOKE ALL ON FUNCTION private.account_delete_blockers(uuid) FROM PUBLIC, anon, authenticated;

-- Blockers for every account, for the People page.
CREATE FUNCTION public.admin_account_delete_blockers()
RETURNS TABLE (user_id uuid, blockers text[])
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT u.id, private.account_delete_blockers(u.id) FROM auth.users u WHERE public.is_admin();
$$;
REVOKE ALL ON FUNCTION public.admin_account_delete_blockers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_account_delete_blockers() TO authenticated;

-- Returns the deleted email, for the app's confirmation message.
CREATE FUNCTION public.admin_delete_account(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_blockers text[];
  v_email text;
  v_snapshot jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That account no longer exists.'; END IF;
  v_blockers := private.account_delete_blockers(p_user_id);
  IF cardinality(v_blockers) > 0 THEN
    RAISE EXCEPTION 'This account can''t be deleted because %. Disable it instead.', array_to_string(v_blockers, ' and ');
  END IF;

  v_snapshot := jsonb_build_object(
    'email', v_email,
    'display_name', (SELECT display_name FROM public.user_profiles WHERE user_id = p_user_id),
    'roles', (SELECT COALESCE(jsonb_agg(jsonb_build_object('role', role_name, 'season_id', season_id)), '[]'::jsonb) FROM public.user_roles WHERE user_id = p_user_id),
    'coach_divisions', (SELECT COALESCE(jsonb_agg(jsonb_build_object('season_id', season_id, 'division_id', division_id)), '[]'::jsonb) FROM public.coach_divisions WHERE user_id = p_user_id),
    'age_group_assignments', (SELECT COALESCE(jsonb_agg(evaluation_session_id), '[]'::jsonb) FROM public.evaluator_assignments WHERE evaluator_user_id = p_user_id),
    'private_notes_deleted', (SELECT count(*) FROM public.private_notes WHERE author_user_id = p_user_id));

  DELETE FROM public.evaluator_assignments WHERE evaluator_user_id = p_user_id;
  DELETE FROM public.private_notes WHERE author_user_id = p_user_id;
  UPDATE public.coach_divisions SET created_by = NULL WHERE created_by = p_user_id;
  UPDATE public.evaluation_session_events SET created_by = NULL WHERE created_by = p_user_id;
  UPDATE public.evaluation_sessions SET created_by = NULL WHERE created_by = p_user_id;
  UPDATE public.evaluation_sessions SET published_by = NULL WHERE published_by = p_user_id;
  UPDATE public.evaluator_assignments SET assigned_by = NULL WHERE assigned_by = p_user_id;
  UPDATE public.historical_evaluation_import_rows SET reviewed_by = NULL WHERE reviewed_by = p_user_id;
  UPDATE public.historical_evaluations SET created_by = NULL WHERE created_by = p_user_id;
  UPDATE public.historical_evaluations SET imported_by = NULL WHERE imported_by = p_user_id;
  UPDATE public.historical_evaluations SET reviewed_by = NULL WHERE reviewed_by = p_user_id;
  UPDATE public.import_batches SET created_by = NULL WHERE created_by = p_user_id;
  UPDATE public.sports_connect_import_rows SET duplicate_player_id_resolved_by = NULL WHERE duplicate_player_id_resolved_by = p_user_id;
  UPDATE public.user_roles SET created_by = NULL WHERE created_by = p_user_id;

  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'account_deleted', 'auth.users', p_user_id::text, 'Deleted by an administrator on the People page', v_snapshot, NULL);
  DELETE FROM auth.users WHERE id = p_user_id;
  RETURN v_email;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_account(uuid) TO authenticated;
