-- Independent evaluators may open released draft reports (decided 2026-11-11), like coaches.
-- Before release only admins can. Evaluator identities stay hidden from everyone but admins.
-- Also adds my_season_roles() so pages can tell a coach from an evaluator.

CREATE OR REPLACE FUNCTION public.draft_report(p_session_id bigint)
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
      WHERE ur.user_id = v_actor AND ur.role_name IN ('coach', 'independent_evaluator') AND ur.season_id = v_session.season_id
    ) THEN
      RAISE EXCEPTION 'Draft reports are available to this season''s coaches, evaluators, and administrators only.' USING ERRCODE = '42501';
    END IF;
    IF v_session.published_at IS NULL THEN
      RAISE EXCEPTION 'This age group''s draft report has not been released yet.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY SELECT * FROM private.session_player_summary(p_session_id, v_actor);
END;
$function$;

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
            WHERE ur.user_id = auth.uid() AND ur.role_name IN ('coach', 'independent_evaluator') AND ur.season_id = es.season_id))
    )
  ORDER BY se.start_date DESC NULLS LAST, es.league_age;
$function$;

-- Released evaluator notes now reach this season's evaluators too, labelled like they are for coaches.
CREATE OR REPLACE FUNCTION public.player_notes(p_session_id bigint)
RETURNS TABLE (player_season_id bigint, kind text, note_text text, author_label text, is_mine boolean, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH s AS (
    SELECT es.id, es.season_id, es.league_age, es.published_at IS NOT NULL AS released
    FROM public.evaluation_sessions es
    WHERE es.id = p_session_id AND es.league_age IS NOT NULL
  ),
  viewer AS (
    SELECT auth.uid() AS uid,
           public.is_admin() AS admin,
           EXISTS (SELECT 1 FROM public.user_roles ur, s
                   WHERE ur.user_id = auth.uid() AND ur.role_name IN ('coach', 'independent_evaluator')
                     AND ur.season_id = s.season_id) AS reader
  )
  SELECT pn.player_season_id, 'private', pn.note_text, 'You', true, pn.updated_at
  FROM public.private_notes pn
  JOIN public.player_seasons ps ON ps.id = pn.player_season_id
  JOIN s ON s.season_id = ps.season_id AND s.league_age = ps.league_age
  CROSS JOIN viewer v
  WHERE pn.author_user_id = v.uid
  UNION ALL
  SELECT e.player_season_id, 'shared', n.note_text,
         CASE
           WHEN n.author_user_id = v.uid THEN 'You'
           WHEN v.admin THEN COALESCE(NULLIF(btrim(up.display_name), ''), au.email::text, 'Independent evaluator')
           ELSE 'Independent evaluator'
         END,
         n.author_user_id = v.uid, n.updated_at
  FROM public.evaluator_notes n
  JOIN public.evaluations e ON e.id = n.evaluation_id
  JOIN s ON s.id = e.evaluation_session_id
  CROSS JOIN viewer v
  LEFT JOIN public.user_profiles up ON up.user_id = n.author_user_id
  LEFT JOIN auth.users au ON au.id = n.author_user_id
  WHERE e.evaluator_type = 'independent_evaluator'
    AND (
      n.author_user_id = v.uid
      OR v.admin
      OR (v.reader AND s.released AND e.status IN ('submitted', 'not_evaluated'))
    )
  ORDER BY 1, 2, 6;
$function$;

-- The caller's own season roles (user_roles itself is admin-only).
CREATE OR REPLACE FUNCTION public.my_season_roles()
RETURNS TABLE (role_name text, season_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT ur.role_name, ur.season_id FROM public.user_roles ur WHERE ur.user_id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.my_season_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_season_roles() TO authenticated;
