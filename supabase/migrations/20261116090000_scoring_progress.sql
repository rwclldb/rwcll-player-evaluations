-- Scoring progress (admins): for each age group, how far each assigned coach and independent evaluator has got.
-- One row per age group and assigned person (an age group nobody is assigned to still gets one row, with no person).
-- Counts only; no scores. Used by /protected/progress on evaluation day.

CREATE FUNCTION public.admin_scoring_progress(p_season_id bigint)
RETURNS TABLE (
  session_id bigint, league_age integer, session_status text, released boolean,
  players integer, checked_in_today integer,
  user_id uuid, scorer_name text, evaluator_type text,
  saved integer, not_evaluated integer, drafts integer, last_saved_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  WITH s AS (
    SELECT es.id, es.league_age, es.status, es.published_at IS NOT NULL AS released,
      (SELECT count(*)::int FROM public.player_seasons ps WHERE ps.season_id = es.season_id AND ps.league_age = es.league_age) AS players,
      (SELECT count(DISTINCT c.player_season_id)::int FROM public.player_checkins c
         JOIN public.evaluation_session_events e ON e.id = c.event_id
        WHERE e.evaluation_session_id = es.id AND e.event_date = (now() AT TIME ZONE 'America/Los_Angeles')::date) AS here
    FROM public.evaluation_sessions es
    WHERE es.season_id = p_season_id AND es.league_age IS NOT NULL
  )
  SELECT s.id, s.league_age, s.status, s.released, s.players, s.here,
         ea.evaluator_user_id,
         COALESCE(NULLIF(up.display_name, ''), u.email),
         ea.evaluator_type,
         COALESCE(ev.saved, 0), COALESCE(ev.not_evaluated, 0), COALESCE(ev.drafts, 0), ev.last_saved_at
  FROM s
  LEFT JOIN public.evaluator_assignments ea ON ea.evaluation_session_id = s.id
  LEFT JOIN auth.users u ON u.id = ea.evaluator_user_id
  LEFT JOIN public.user_profiles up ON up.user_id = ea.evaluator_user_id
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE e.status = 'submitted')::int AS saved,
           count(*) FILTER (WHERE e.status = 'not_evaluated')::int AS not_evaluated,
           count(*) FILTER (WHERE e.status = 'draft')::int AS drafts,
           max(e.updated_at) AS last_saved_at
    FROM public.evaluations e
    WHERE e.evaluation_session_id = s.id AND e.evaluator_user_id = ea.evaluator_user_id
  ) ev ON true
  WHERE public.is_admin()
  ORDER BY s.league_age, ea.evaluator_type DESC NULLS LAST, 8;
$$;
REVOKE ALL ON FUNCTION public.admin_scoring_progress(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_scoring_progress(bigint) TO authenticated;
