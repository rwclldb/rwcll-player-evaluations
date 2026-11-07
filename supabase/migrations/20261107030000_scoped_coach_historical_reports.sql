-- Scoped coach access to historical ratings for players on assigned teams.
-- Apply locally first. Historical tables remain admin-only; coaches access only these
-- narrowly scoped SECURITY DEFINER RPCs, never direct table reads.
BEGIN;

CREATE OR REPLACE FUNCTION public.coach_historical_report_roster(p_season_id bigint)
RETURNS TABLE (
  player_season_id bigint,
  player_id bigint,
  season_id bigint,
  league_age integer,
  evaluation_number integer,
  team_id bigint,
  team_name text,
  first_name text,
  last_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    ps.id,
    ps.player_id,
    ps.season_id,
    ps.league_age,
    ps.evaluation_number,
    t.id,
    t.name,
    p.first_name,
    p.last_name
  FROM public.player_seasons AS ps
  JOIN public.players AS p ON p.id = ps.player_id
  JOIN public.teams AS t
    ON t.id = ps.team_id
   AND t.season_id = ps.season_id
  WHERE ps.season_id = p_season_id
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1
        FROM public.team_coach_assignments AS tca
        WHERE tca.team_id = t.id
          AND tca.season_id = ps.season_id
          AND tca.coach_user_id = auth.uid()
      )
    )
  ORDER BY t.name NULLS LAST, p.last_name, p.first_name, ps.id;
$function$;

CREATE OR REPLACE FUNCTION public.coach_historical_report(p_player_season_id bigint)
RETURNS TABLE (
  historical_evaluation_id bigint,
  source_season_label text,
  source_division_name text,
  source_team_label text,
  source_coach_name text,
  coverage_note text,
  category_name text,
  score integer,
  rating_category_id bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_player_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT ps.player_id
    INTO v_player_id
  FROM public.player_seasons AS ps
  JOIN public.teams AS t
    ON t.id = ps.team_id
   AND t.season_id = ps.season_id
  WHERE ps.id = p_player_season_id
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1
        FROM public.team_coach_assignments AS tca
        WHERE tca.team_id = t.id
          AND tca.season_id = ps.season_id
          AND tca.coach_user_id = auth.uid()
      )
    );

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Player report is not available to this account'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    he.id,
    he.source_season_label,
    he.source_division_name,
    he.source_team_label,
    he.source_coach_name,
    he.coverage_note,
    COALESCE(rc.name, hr.category_name),
    hr.score,
    hr.rating_category_id
  FROM public.historical_evaluations AS he
  LEFT JOIN public.historical_ratings AS hr
    ON hr.historical_evaluation_id = he.id
  LEFT JOIN public.rating_categories AS rc
    ON rc.id = hr.rating_category_id
  WHERE he.player_id = v_player_id
  ORDER BY he.source_season_id DESC NULLS LAST, he.id, hr.rating_category_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.coach_historical_report_roster(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coach_historical_report(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_historical_report_roster(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.coach_historical_report(bigint) TO authenticated;

COMMENT ON FUNCTION public.coach_historical_report_roster(bigint) IS
  'Returns only player registrations on teams assigned to the authenticated coach; administrators may view all registrations in the requested season.';
COMMENT ON FUNCTION public.coach_historical_report(bigint) IS
  'Returns historical ratings only when the authenticated coach is assigned to the player current-season team; administrators may access all reports. Historical tables remain admin-only under RLS.';

COMMIT;
