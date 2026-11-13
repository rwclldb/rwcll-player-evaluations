-- Coach trimmed mean (decided 2026-11-13): next to the normal coach average, the draft report shows a coach
-- average with each skill's single highest and single lowest coach score left out.
-- * Coaches only. Independent-evaluator and prior-year averages are unchanged.
-- * Per skill: trimmed only when 3 or more coaches scored that skill (otherwise nothing to trim, and the
--   per-skill trimmed value is omitted). One highest and one lowest score are dropped even when tied.
-- * Trimmed overall: mean over the core skills of (trimmed average where it exists, else the normal average).
--   Present only when at least one core skill was trimmed.
-- Returned inside skill_averages (no signature change, so draft_report is untouched):
--   skill_averages.coach_trimmed          { skill code: trimmed avg, pitching, catching }  (trimmed skills only)
--   skill_averages.coach_trimmed_overall  number, or absent
-- Only submitted evaluations count, as before.

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
  -- Coach scores ranked within each player and skill, lowest and highest first.
  coach_scores AS (
    SELECT e.player_season_id, rc.code, rc.category_group, r.score,
           row_number() OVER (PARTITION BY e.player_season_id, rc.code ORDER BY r.score, r.id) AS rn_low,
           row_number() OVER (PARTITION BY e.player_season_id, rc.code ORDER BY r.score DESC, r.id DESC) AS rn_high,
           count(*) OVER (PARTITION BY e.player_season_id, rc.code) AS n
    FROM public.evaluations e
    JOIN public.ratings r ON r.evaluation_id = e.id
    JOIN public.rating_categories rc ON rc.id = r.rating_category_id
    WHERE e.evaluation_session_id = p_session_id AND e.status = 'submitted' AND e.evaluator_type = 'coach'
  ),
  -- Per skill: trimmed mean when 3+ coaches scored it, else the plain mean (used only for the overall).
  coach_trim AS (
    SELECT player_season_id, code, category_group, max(n) >= 3 AS trimmed,
           CASE WHEN max(n) >= 3 THEN avg(score) FILTER (WHERE rn_low > 1 AND rn_high > 1) ELSE avg(score) END::numeric AS avg_score
    FROM coach_scores GROUP BY 1, 2, 3
  ),
  coach_trim_player AS (
    SELECT player_season_id,
           CASE WHEN bool_or(trimmed) FILTER (WHERE category_group = 'core')
                THEN avg(avg_score) FILTER (WHERE category_group = 'core') END AS overall,
           CASE WHEN bool_or(trimmed) FILTER (WHERE category_group = 'pitching')
                THEN avg(avg_score) FILTER (WHERE category_group = 'pitching') END AS pitching,
           CASE WHEN bool_or(trimmed) FILTER (WHERE category_group = 'catching')
                THEN avg(avg_score) FILTER (WHERE category_group = 'catching') END AS catching,
           COALESCE(jsonb_object_agg(code, round(avg_score, 2)) FILTER (WHERE trimmed), '{}'::jsonb) AS skills
    FROM coach_trim GROUP BY 1
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
           'prior', COALESCE(h.skills, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('pitching', round(h.pitching, 2), 'catching', round(h.catching, 2))),
           'coach_trimmed', COALESCE(t.skills, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('pitching', round(t.pitching, 2), 'catching', round(t.catching, 2)))
         ) || jsonb_strip_nulls(jsonb_build_object('coach_trimmed_overall', round(t.overall, 4))),
         mi.j,
         COALESCE(ev.blank_core, 0), COALESCE(ev.ne_n, 0), COALESCE(ev.draft_n, 0)
  FROM roster ro
  LEFT JOIN cur_type c ON c.player_season_id = ro.id AND c.evaluator_type = 'coach'
  LEFT JOIN cur_type i ON i.player_season_id = ro.id AND i.evaluator_type = 'independent_evaluator'
  LEFT JOIN coach_trim_player t ON t.player_season_id = ro.id
  LEFT JOIN hist_player h ON h.player_id = ro.player_id
  LEFT JOIN ev ON ev.player_season_id = ro.id
  LEFT JOIN mine mi ON mi.player_season_id = ro.id;
$function$;

REVOKE ALL ON FUNCTION private.session_player_summary(bigint, uuid) FROM PUBLIC, anon, authenticated;
