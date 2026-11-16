-- Season backup: one call returns everything the app stores for one season, so an admin can download it as a zip
-- of spreadsheets (Season page → "Download season backup"). It is a safety copy and a draft-night fallback if the
-- app is down; it is not restored by the app (a full database copy is the restore path: docs/FAQ.md).
--
-- * admin_season_backup(season): admins only. Returns {made_at, season_id, tables: {name: [rows]}} with the season,
--   divisions, rating categories, registrations and their players, age groups, events, assignments, every
--   evaluation with its ratings, experience answers and shared evaluator notes, prior-year ratings of this season's
--   players, check-ins, calls, exemptions (with removed ones), teams, roles, coach divisions and the accounts
--   involved (name, email, disabled).
-- * Left out on purpose: birthdates (players.date_of_birth; only has_birth_date is included), coaches' private notes
--   and private stars (only their owner may read them), import staging rows (they can hold birthdates), the audit log
--   and View-as preview records.
-- * Every call is audited as season_backup_downloaded with the row count of each table.

CREATE FUNCTION public.admin_season_backup(p_season_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_tables jsonb;
  v_counts jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.seasons WHERE id = p_season_id) THEN
    RAISE EXCEPTION 'Season not found.';
  END IF;

  CREATE TEMP TABLE backup_registrations ON COMMIT DROP AS
    SELECT ps.id, ps.player_id FROM public.player_seasons ps WHERE ps.season_id = p_season_id;
  CREATE TEMP TABLE backup_sessions ON COMMIT DROP AS
    SELECT es.id FROM public.evaluation_sessions es WHERE es.season_id = p_season_id;
  CREATE TEMP TABLE backup_evaluations ON COMMIT DROP AS
    SELECT e.id, e.evaluator_user_id FROM public.evaluations e
    WHERE e.evaluation_session_id IN (SELECT id FROM backup_sessions)
       OR e.player_season_id IN (SELECT id FROM backup_registrations);
  CREATE TEMP TABLE backup_history ON COMMIT DROP AS
    SELECT h.id FROM public.historical_evaluations h WHERE h.player_id IN (SELECT player_id FROM backup_registrations);
  CREATE TEMP TABLE backup_users ON COMMIT DROP AS
    SELECT ur.user_id FROM public.user_roles ur WHERE ur.season_id = p_season_id OR ur.role_name = 'administrator'
    UNION SELECT evaluator_user_id FROM backup_evaluations
    UNION SELECT ea.evaluator_user_id FROM public.evaluator_assignments ea WHERE ea.evaluation_session_id IN (SELECT id FROM backup_sessions)
    UNION SELECT cd.user_id FROM public.coach_divisions cd WHERE cd.season_id = p_season_id;

  v_tables := jsonb_build_object(
    'seasons', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.seasons t WHERE t.id = p_season_id),
    'divisions', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.divisions t),
    'season_divisions', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.season_divisions t WHERE t.season_id = p_season_id),
    'rating_categories', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.rating_categories t),
    -- Never the birthdate itself: only whether one is on file.
    'players', (SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'date_of_birth' ORDER BY t.id), '[]') FROM public.players t
                WHERE t.id IN (SELECT player_id FROM backup_registrations)),
    'player_seasons', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.player_seasons t WHERE t.season_id = p_season_id),
    'evaluation_sessions', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.evaluation_sessions t WHERE t.season_id = p_season_id),
    'evaluation_session_events', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.evaluation_session_events t
                                  WHERE t.evaluation_session_id IN (SELECT id FROM backup_sessions)),
    'evaluator_assignments', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.evaluator_assignments t
                              WHERE t.evaluation_session_id IN (SELECT id FROM backup_sessions)),
    'evaluations', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.evaluations t WHERE t.id IN (SELECT id FROM backup_evaluations)),
    'ratings', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.ratings t WHERE t.evaluation_id IN (SELECT id FROM backup_evaluations)),
    'experience_answers', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.experience_answers t
                           WHERE t.evaluation_id IN (SELECT id FROM backup_evaluations)),
    'evaluator_notes', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.evaluator_notes t
                        WHERE t.evaluation_id IN (SELECT id FROM backup_evaluations)),
    'historical_evaluations', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.historical_evaluations t
                               WHERE t.id IN (SELECT id FROM backup_history)),
    'historical_ratings', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.historical_ratings t
                           WHERE t.historical_evaluation_id IN (SELECT id FROM backup_history)),
    'player_checkins', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.player_checkins t
                        WHERE t.player_season_id IN (SELECT id FROM backup_registrations)),
    'player_calls', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.player_calls t
                     WHERE t.player_season_id IN (SELECT id FROM backup_registrations)),
    'player_exemptions', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.player_exemptions t
                          WHERE t.player_season_id IN (SELECT id FROM backup_registrations)),
    'teams', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.teams t WHERE t.season_id = p_season_id),
    'team_coach_assignments', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.team_coach_assignments t WHERE t.season_id = p_season_id),
    'user_roles', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.user_roles t
                   WHERE t.season_id = p_season_id OR t.role_name = 'administrator'),
    'coach_divisions', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.coach_divisions t WHERE t.season_id = p_season_id),
    'accounts', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'user_id', u.id, 'email', u.email, 'display_name', p.display_name, 'created_at', u.created_at,
                   'last_sign_in_at', u.last_sign_in_at, 'disabled', (u.banned_until IS NOT NULL AND u.banned_until > now()))
                   ORDER BY lower(COALESCE(p.display_name, u.email))), '[]')
                 FROM auth.users u LEFT JOIN public.user_profiles p ON p.user_id = u.id
                 WHERE u.id IN (SELECT user_id FROM backup_users))
  );

  SELECT jsonb_object_agg(key, jsonb_array_length(value)) INTO v_counts FROM jsonb_each(v_tables);
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (auth.uid(), 'season_backup_downloaded', 'seasons', p_season_id::text, NULL, NULL, jsonb_build_object('rows', v_counts));

  DROP TABLE backup_registrations, backup_sessions, backup_evaluations, backup_history, backup_users;
  RETURN jsonb_build_object('made_at', now(), 'season_id', p_season_id, 'tables', v_tables);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_season_backup(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_season_backup(bigint) TO authenticated;
