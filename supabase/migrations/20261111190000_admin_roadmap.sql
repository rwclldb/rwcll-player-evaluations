-- Admin roadmap and "your schedule" (decided 2026-11-11).
-- * admin_season_roadmap(season, today): everything the admin home page needs to show which stage the
--   season is in and the live status of each step, in one call. Read-only. Admin only.
--   Stages: before (Before evaluations), week (Evaluation week), day (Evaluation day),
--   after (After evaluations), end (End of season). The suggested stage is worked out from the data:
--     end    season closed, or every age group released
--     after  any age group locked or released, or every scheduled event is in the past
--     day    today falls between the first primary event and the last event
--     week   any age group open, or the first primary event is within 7 days
--     before otherwise
--   p_today exists so tests can pin the date.
-- * my_evaluation_schedule(): for coaches and evaluators, the age groups of open seasons where they hold a
--   role, whether they are assigned, the session stage, and the scheduled events. Only their own rows.

CREATE OR REPLACE FUNCTION public.admin_season_roadmap(p_season_id bigint, p_today date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_season record;
  v_sessions jsonb;
  v_reg jsonb;
  v_imports jsonb;
  v_prior jsonb;
  v_people jsonb;
  v_first_primary date;
  v_last_event date;
  v_total int;
  v_open int;
  v_locked int;
  v_released int;
  v_stage text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  SELECT s.id, s.name, s.is_closed, s.start_date, s.show_prior_year_during_evaluations INTO v_season
  FROM public.seasons s WHERE s.id = p_season_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season was not found.';
  END IF;

  -- Registrations
  SELECT jsonb_build_object(
    'total', count(*),
    'no_bib', count(*) FILTER (WHERE ps.evaluation_number IS NULL AND ps.league_age IS NOT NULL),
    'no_age', count(*) FILTER (WHERE ps.league_age IS NULL),
    'on_site', count(*) FILTER (WHERE ps.registration_source = 'on_site'))
  INTO v_reg
  FROM public.player_seasons ps WHERE ps.season_id = p_season_id;

  -- Imports waiting on the admin
  SELECT jsonb_build_object(
    'registration_batches', (SELECT count(*) FROM public.import_batches b WHERE b.season_id = p_season_id AND b.import_type = 'players'),
    'registration_rows_to_review', (
      SELECT count(*) FROM public.sports_connect_import_rows r
      JOIN public.import_batches b ON b.id = r.import_batch_id
      WHERE b.season_id = p_season_id
        AND r.review_state IN ('needs_review', 'ready_for_match_review', 'approved_new', 'approved_match')),
    'bib_rows_held', (
      SELECT count(*) FROM public.bib_import_rows r
      JOIN public.import_batches b ON b.id = r.import_batch_id
      WHERE b.season_id = p_season_id AND r.status = 'held'))
  INTO v_imports;

  -- Prior-year ratings (pending rows are counted across batches, as the Prior-year page does)
  SELECT jsonb_build_object(
    'players_with_prior', (
      SELECT count(DISTINCT ps.id) FROM public.player_seasons ps
      JOIN public.historical_evaluations h ON h.player_id = ps.player_id
      WHERE ps.season_id = p_season_id AND h.source_season_id IS DISTINCT FROM p_season_id),
    'rows_pending', (
      SELECT count(*) FROM public.historical_evaluation_import_rows r
      WHERE r.review_state = 'pending_review' AND r.match_status <> 'invalid'),
    'shown_while_scoring', v_season.show_prior_year_during_evaluations)
  INTO v_prior;

  -- People with a role this season
  WITH people AS (
    SELECT ur.user_id, ur.role_name, u.last_sign_in_at,
           (u.banned_until IS NOT NULL AND u.banned_until > now()) AS disabled
    FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id
    WHERE ur.season_id = p_season_id AND ur.role_name IN ('coach', 'independent_evaluator')
  )
  SELECT jsonb_build_object(
    'coaches', count(*) FILTER (WHERE role_name = 'coach'),
    'evaluators', count(*) FILTER (WHERE role_name = 'independent_evaluator'),
    'not_signed_in', count(*) FILTER (WHERE last_sign_in_at IS NULL AND NOT disabled),
    'unassigned', count(*) FILTER (WHERE NOT disabled AND NOT EXISTS (
      SELECT 1 FROM public.evaluator_assignments ea
      JOIN public.evaluation_sessions es ON es.id = ea.evaluation_session_id
      WHERE ea.evaluator_user_id = people.user_id AND es.season_id = p_season_id)))
  INTO v_people FROM people;

  -- One entry per age group
  WITH sess AS (
    SELECT es.id, es.league_age, es.status, es.published_at
    FROM public.evaluation_sessions es WHERE es.season_id = p_season_id AND es.league_age IS NOT NULL
  ),
  players AS (
    SELECT s.id AS session_id, count(ps.id) AS players,
           count(ps.id) FILTER (WHERE ps.evaluation_number IS NULL) AS no_bib
    FROM sess s LEFT JOIN public.player_seasons ps ON ps.season_id = p_season_id AND ps.league_age = s.league_age
    GROUP BY s.id
  ),
  asg AS (
    SELECT s.id AS session_id,
           count(ea.id) FILTER (WHERE ea.evaluator_type = 'coach') AS coaches,
           count(ea.id) FILTER (WHERE ea.evaluator_type = 'independent_evaluator') AS evaluators
    FROM sess s LEFT JOIN public.evaluator_assignments ea ON ea.evaluation_session_id = s.id
    GROUP BY s.id
  ),
  ev AS (
    SELECT s.id AS session_id,
           count(e.id) FILTER (WHERE e.status = 'submitted') AS submitted,
           count(e.id) FILTER (WHERE e.status = 'draft') AS drafts,
           count(DISTINCT e.player_season_id) FILTER (WHERE e.status = 'submitted' AND e.evaluator_type = 'independent_evaluator') AS players_scored_by_evaluator,
           count(DISTINCT e.player_season_id) FILTER (WHERE e.status = 'submitted' AND e.evaluator_type = 'coach') AS players_scored_by_coach,
           count(DISTINCT e.player_season_id) FILTER (WHERE e.status IN ('submitted', 'not_evaluated')) AS players_touched
    FROM sess s LEFT JOIN public.evaluations e ON e.evaluation_session_id = s.id
    GROUP BY s.id
  ),
  evt AS (
    SELECT s.id AS session_id,
           min(x.event_date) FILTER (WHERE x.event_type = 'primary') AS primary_date,
           min(x.start_time) FILTER (WHERE x.event_type = 'primary') AS primary_start,
           count(x.id) FILTER (WHERE x.event_type = 'makeup') AS makeups,
           max(x.event_date) AS last_event_date
    FROM sess s LEFT JOIN public.evaluation_session_events x ON x.evaluation_session_id = s.id
    GROUP BY s.id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'league_age', s.league_age, 'status', s.status, 'released', s.published_at IS NOT NULL,
           'players', p.players, 'no_bib', p.no_bib,
           'coaches', a.coaches, 'evaluators', a.evaluators,
           'submitted', ev.submitted, 'drafts', ev.drafts,
           'players_scored_by_evaluator', ev.players_scored_by_evaluator,
           'players_scored_by_coach', ev.players_scored_by_coach,
           'players_touched', ev.players_touched,
           'primary_date', evt.primary_date, 'primary_start', evt.primary_start,
           'makeups', evt.makeups, 'last_event_date', evt.last_event_date)
         ORDER BY s.league_age), '[]'::jsonb),
         min(evt.primary_date), max(evt.last_event_date),
         count(*), count(*) FILTER (WHERE s.status = 'open'),
         count(*) FILTER (WHERE s.status = 'locked'), count(*) FILTER (WHERE s.published_at IS NOT NULL)
  INTO v_sessions, v_first_primary, v_last_event, v_total, v_open, v_locked, v_released
  FROM sess s
  JOIN players p ON p.session_id = s.id
  JOIN asg a ON a.session_id = s.id
  JOIN ev ON ev.session_id = s.id
  JOIN evt ON evt.session_id = s.id;

  v_stage := CASE
    WHEN v_season.is_closed OR (v_total > 0 AND v_released = v_total) THEN 'end'
    WHEN v_locked > 0 OR v_released > 0 OR (v_last_event IS NOT NULL AND p_today > v_last_event) THEN 'after'
    WHEN v_first_primary IS NOT NULL AND p_today BETWEEN v_first_primary AND v_last_event THEN 'day'
    WHEN v_open > 0 OR (v_first_primary IS NOT NULL AND v_first_primary - p_today <= 7) THEN 'week'
    ELSE 'before'
  END;

  RETURN jsonb_build_object(
    'season', jsonb_build_object('id', v_season.id, 'name', v_season.name, 'is_closed', v_season.is_closed),
    'stage', v_stage,
    'today', p_today,
    'first_primary_date', v_first_primary,
    'last_event_date', v_last_event,
    'registrations', v_reg,
    'imports', v_imports,
    'prior_year', v_prior,
    'people', v_people,
    'sessions', v_sessions);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_season_roadmap(bigint, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_season_roadmap(bigint, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_evaluation_schedule()
RETURNS TABLE (
  season_id bigint, season_name text, role_name text, session_id bigint, league_age integer,
  assigned boolean, session_status text, released boolean, events jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT s.id, s.name, ur.role_name, es.id, es.league_age,
         EXISTS (SELECT 1 FROM public.evaluator_assignments ea
                 WHERE ea.evaluation_session_id = es.id AND ea.evaluator_user_id = auth.uid()),
         es.status, es.published_at IS NOT NULL,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
                     'type', x.event_type, 'date', x.event_date, 'start', x.start_time, 'end', x.end_time,
                     'location', x.location) ORDER BY x.event_date, x.start_time)
                   FROM public.evaluation_session_events x WHERE x.evaluation_session_id = es.id), '[]'::jsonb)
  FROM public.user_roles ur
  JOIN public.seasons s ON s.id = ur.season_id AND NOT s.is_closed
  JOIN public.evaluation_sessions es ON es.season_id = s.id AND es.league_age IS NOT NULL
  WHERE ur.user_id = auth.uid() AND ur.role_name IN ('coach', 'independent_evaluator')
  ORDER BY s.start_date DESC NULLS LAST, es.league_age;
$function$;

REVOKE ALL ON FUNCTION public.my_evaluation_schedule() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_evaluation_schedule() TO authenticated;
