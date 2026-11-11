-- Draft reports, prior-year visibility switch, and season-wide bib uniqueness (decisions 2026-11-10).
--
-- * seasons.show_prior_year_during_evaluations: one switch per season (default off). When on, coaches
--   and independent evaluators see prior-year ratings on the evaluation screen. Changed only through
--   set_prior_year_visibility(), which is admin-only and audited.
-- * private.session_player_summary(session): the one place averages are computed.
--   Only submitted evaluations count; blanks are skipped (never zero); skill average = mean of
--   non-blank ratings; overall = mean of the available core skill averages; coach and independent
--   evaluator figures are never combined. Prior-year = all historical coach ratings linked to the player.
-- * draft_report(session): admin anytime; coaches only after the session is released.
--   Returns averages and counts only, never individual raters, plus the caller's own ratings.
-- * draft_report_sessions(): the age groups the caller may open in the draft report.
-- * prior_year_for_session(session): prior-year figures for the evaluation screen, if the season switch is
--   on and the caller is assigned to the session (admins always).
-- * Evaluation (bib) numbers become unique per season instead of per division.
--
-- Local only. Do not apply to hosted Supabase without explicit approval.

ALTER TABLE public.seasons
  ADD COLUMN IF NOT EXISTS show_prior_year_during_evaluations boolean NOT NULL DEFAULT false;

-- Bibs: unique across the whole season's evaluation.
DROP INDEX IF EXISTS public.player_seasons_unique_evaluation_number;
CREATE UNIQUE INDEX player_seasons_unique_season_evaluation_number
  ON public.player_seasons (season_id, evaluation_number)
  WHERE evaluation_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_prior_year_visibility(p_season_id bigint, p_visible boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before boolean;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_visible IS NULL THEN
    RAISE EXCEPTION 'Choose on or off.';
  END IF;

  SELECT show_prior_year_during_evaluations INTO v_before FROM public.seasons WHERE id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season was not found.';
  END IF;

  UPDATE public.seasons SET show_prior_year_during_evaluations = p_visible WHERE id = p_season_id;

  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'season_prior_year_visibility', 'seasons', p_season_id::text,
          CASE WHEN p_visible THEN 'Prior-year ratings shown during evaluations' ELSE 'Prior-year ratings hidden during evaluations' END,
          jsonb_build_object('show_prior_year_during_evaluations', v_before),
          jsonb_build_object('show_prior_year_during_evaluations', p_visible));
END;
$function$;

REVOKE ALL ON FUNCTION public.set_prior_year_visibility(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_prior_year_visibility(bigint, boolean) TO authenticated;

-- Shared calculation. In the private schema: not callable through the API.
CREATE OR REPLACE FUNCTION private.session_player_summary(p_session_id bigint, p_viewer uuid)
RETURNS TABLE (
  player_season_id bigint,
  evaluation_number integer,
  first_name text,
  last_name text,
  league_age integer,
  coach_overall numeric,
  coach_skills_rated integer,
  coach_evaluations integer,
  evaluator_overall numeric,
  evaluator_skills_rated integer,
  evaluator_evaluations integer,
  prior_overall numeric,
  prior_skills_rated integer,
  prior_ratings integer,
  skill_averages jsonb,
  my_evaluation jsonb,
  blank_core_skills integer,
  not_evaluated_marks integer,
  drafts_excluded integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH s AS (
    SELECT es.id, es.season_id, es.league_age FROM public.evaluation_sessions es WHERE es.id = p_session_id
  ),
  roster AS (
    SELECT ps.id, ps.player_id, ps.evaluation_number, p.first_name, p.last_name, ps.league_age
    FROM public.player_seasons ps
    JOIN public.players p ON p.id = ps.player_id
    JOIN s ON s.season_id = ps.season_id AND s.league_age = ps.league_age
  ),
  -- Per player, rater type, and skill: mean of submitted, non-blank ratings.
  cur AS (
    SELECT e.player_season_id, e.evaluator_type, rc.code, rc.category_group, avg(r.score)::numeric AS avg_score
    FROM public.evaluations e
    JOIN public.ratings r ON r.evaluation_id = e.id
    JOIN public.rating_categories rc ON rc.id = r.rating_category_id
    WHERE e.evaluation_session_id = p_session_id AND e.status = 'submitted'
    GROUP BY 1, 2, 3, 4
  ),
  cur_type AS (
    SELECT player_season_id, evaluator_type,
           avg(avg_score) FILTER (WHERE category_group = 'core') AS overall,
           count(*) FILTER (WHERE category_group = 'core')::int AS skills_rated,
           avg(avg_score) FILTER (WHERE category_group = 'pitching') AS pitching,
           avg(avg_score) FILTER (WHERE category_group = 'catching') AS catching,
           jsonb_object_agg(code, round(avg_score, 2)) AS skills
    FROM cur GROUP BY 1, 2
  ),
  hist AS (
    SELECT he.player_id, rc.code, rc.category_group, avg(hr.score)::numeric AS avg_score
    FROM public.historical_evaluations he
    JOIN public.historical_ratings hr ON hr.historical_evaluation_id = he.id
    JOIN public.rating_categories rc ON rc.id = hr.rating_category_id
    WHERE he.player_id IN (SELECT player_id FROM roster)
    GROUP BY 1, 2, 3
  ),
  hist_player AS (
    SELECT h.player_id,
           avg(avg_score) FILTER (WHERE category_group = 'core') AS overall,
           count(*) FILTER (WHERE category_group = 'core')::int AS skills_rated,
           avg(avg_score) FILTER (WHERE category_group = 'pitching') AS pitching,
           avg(avg_score) FILTER (WHERE category_group = 'catching') AS catching,
           jsonb_object_agg(code, round(avg_score, 2)) AS skills,
           (SELECT count(*) FROM public.historical_evaluations x WHERE x.player_id = h.player_id)::int AS n
    FROM hist h GROUP BY 1
  ),
  ev AS (
    SELECT e.player_season_id,
           count(*) FILTER (WHERE e.status = 'submitted' AND e.evaluator_type = 'coach')::int AS coach_n,
           count(*) FILTER (WHERE e.status = 'submitted' AND e.evaluator_type = 'independent_evaluator')::int AS eval_n,
           count(*) FILTER (WHERE e.status = 'not_evaluated')::int AS ne_n,
           count(*) FILTER (WHERE e.status = 'draft')::int AS draft_n,
           COALESCE(sum(CASE WHEN e.status = 'submitted' THEN 5 - (
             SELECT count(*) FROM public.ratings r JOIN public.rating_categories rc ON rc.id = r.rating_category_id
             WHERE r.evaluation_id = e.id AND rc.category_group = 'core') ELSE 0 END), 0)::int AS blank_core
    FROM public.evaluations e
    WHERE e.evaluation_session_id = p_session_id
    GROUP BY 1
  ),
  mine AS (
    SELECT e.player_season_id,
           jsonb_build_object('status', e.status, 'ratings',
             COALESCE((SELECT jsonb_object_agg(rc.code, r.score) FROM public.ratings r
                       JOIN public.rating_categories rc ON rc.id = r.rating_category_id
                       WHERE r.evaluation_id = e.id), '{}'::jsonb)) AS j
    FROM public.evaluations e
    WHERE e.evaluation_session_id = p_session_id AND e.evaluator_user_id = p_viewer
  )
  SELECT ro.id, ro.evaluation_number, ro.first_name, ro.last_name, ro.league_age,
         round(c.overall, 4), COALESCE(c.skills_rated, 0), COALESCE(ev.coach_n, 0),
         round(i.overall, 4), COALESCE(i.skills_rated, 0), COALESCE(ev.eval_n, 0),
         round(h.overall, 4), COALESCE(h.skills_rated, 0), COALESCE(h.n, 0),
         jsonb_build_object(
           'coach', COALESCE(c.skills, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('pitching', round(c.pitching, 2), 'catching', round(c.catching, 2))),
           'evaluator', COALESCE(i.skills, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('pitching', round(i.pitching, 2), 'catching', round(i.catching, 2))),
           'prior', COALESCE(h.skills, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('pitching', round(h.pitching, 2), 'catching', round(h.catching, 2)))
         ),
         mi.j,
         COALESCE(ev.blank_core, 0), COALESCE(ev.ne_n, 0), COALESCE(ev.draft_n, 0)
  FROM roster ro
  LEFT JOIN cur_type c ON c.player_season_id = ro.id AND c.evaluator_type = 'coach'
  LEFT JOIN cur_type i ON i.player_season_id = ro.id AND i.evaluator_type = 'independent_evaluator'
  LEFT JOIN hist_player h ON h.player_id = ro.player_id
  LEFT JOIN ev ON ev.player_season_id = ro.id
  LEFT JOIN mine mi ON mi.player_season_id = ro.id;
$function$;

REVOKE ALL ON FUNCTION private.session_player_summary(bigint, uuid) FROM PUBLIC, anon, authenticated;

-- Draft report: admin anytime; coaches (with a coach role in the season) only once released.
CREATE FUNCTION public.draft_report(p_session_id bigint)
RETURNS TABLE (
  player_season_id bigint, evaluation_number integer, first_name text, last_name text, league_age integer,
  coach_overall numeric, coach_skills_rated integer, coach_evaluations integer,
  evaluator_overall numeric, evaluator_skills_rated integer, evaluator_evaluations integer,
  prior_overall numeric, prior_skills_rated integer, prior_ratings integer,
  skill_averages jsonb, my_evaluation jsonb,
  blank_core_skills integer, not_evaluated_marks integer, drafts_excluded integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT es.id, es.season_id, es.published_at INTO v_session
  FROM public.evaluation_sessions es WHERE es.id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evaluation session was not found.';
  END IF;

  IF NOT public.is_admin() THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = v_actor AND ur.role_name = 'coach' AND ur.season_id = v_session.season_id
    ) THEN
      RAISE EXCEPTION 'Draft reports are available to coaches and administrators only.' USING ERRCODE = '42501';
    END IF;
    IF v_session.published_at IS NULL THEN
      RAISE EXCEPTION 'This age group''s draft report has not been released yet.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY SELECT * FROM private.session_player_summary(p_session_id, v_actor);
END;
$function$;

REVOKE ALL ON FUNCTION public.draft_report(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_report(bigint) TO authenticated;

-- Age groups the caller may open in the draft report.
CREATE OR REPLACE FUNCTION public.draft_report_sessions()
RETURNS TABLE (session_id bigint, season_id bigint, season_name text, league_age integer, status text, released boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT es.id, es.season_id, se.name, es.league_age, es.status, es.published_at IS NOT NULL
  FROM public.evaluation_sessions es
  JOIN public.seasons se ON se.id = es.season_id
  WHERE es.league_age IS NOT NULL
    AND (
      public.is_admin()
      OR (es.published_at IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid() AND ur.role_name = 'coach' AND ur.season_id = es.season_id))
    )
  ORDER BY se.start_date DESC NULLS LAST, es.league_age;
$function$;

REVOKE ALL ON FUNCTION public.draft_report_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_report_sessions() TO authenticated;

-- Prior-year figures for the evaluation screen.
CREATE OR REPLACE FUNCTION public.prior_year_for_session(p_session_id bigint)
RETURNS TABLE (player_season_id bigint, prior_overall numeric, prior_skills_rated integer, prior_ratings integer, prior_skills jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_visible boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT se.show_prior_year_during_evaluations INTO v_visible
  FROM public.evaluation_sessions es JOIN public.seasons se ON se.id = es.season_id
  WHERE es.id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evaluation session was not found.';
  END IF;

  IF NOT public.is_admin() THEN
    IF NOT public.can_access_evaluation_session(p_session_id) THEN
      RAISE EXCEPTION 'You are not assigned to this evaluation session.' USING ERRCODE = '42501';
    END IF;
    IF NOT v_visible THEN
      RETURN; -- switch is off: nothing to show
    END IF;
  END IF;

  RETURN QUERY
    SELECT x.player_season_id, x.prior_overall, x.prior_skills_rated, x.prior_ratings, x.skill_averages -> 'prior'
    FROM private.session_player_summary(p_session_id, auth.uid()) x
    WHERE x.prior_ratings > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.prior_year_for_session(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prior_year_for_session(bigint) TO authenticated;
