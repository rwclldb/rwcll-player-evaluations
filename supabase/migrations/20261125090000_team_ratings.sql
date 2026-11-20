-- End-of-season ratings by team managers (decided 2026-11-20). At the end of the season each team's Manager rates the
-- players on their team on the evaluation-day form: the five core skills (some may be left blank), optional pitching
-- and catching, or "Not rated". One rating per team and player. An admin opens and closes the window for the season.
-- The ratings are stored as prior-year ratings (historical_evaluations + historical_ratings), so next season's draft
-- report, scoring screen (when the prior-year switch is on) and Make teams use them with no import.
--
-- * team_rating_windows: one row per season once an admin has opened ratings (open while closed_at is null).
-- * historical_evaluations gains source_team_id, source_player_season_id, not_rated and updated_at; an in-app rating
--   has player_match_method 'team_roster'. One per team and player.
-- * admin_open_team_ratings / admin_close_team_ratings(season): admins, audited; refused in a closed season.
-- * admin_team_rating_progress(season): per team, players rated / not rated / to do (counts only), for admins.
-- * my_rating_teams(): the teams the signed-in person manages in open seasons where ratings were opened.
-- * team_rating_sheet(team): the team's players with the manager's saved ratings, for the manager or an admin.
-- * save_team_rating(team, registration, ratings, not_rated): the manager while the window is open, or an admin until
--   the season closes. The player must be on the team. Needs one core skill unless Not rated. Refused in preview.
-- * private.session_player_summary: prior-year averages now use only seasons that start before the viewed season
--   (ratings without a known season still count) and only ratings that have scores, so a season's own end-of-season
--   ratings never show as its prior year.
-- * admin_season_close_check gains team_ratings_open and team_players_unrated (warnings on the Season page).

-- ---------- window ----------
CREATE TABLE public.team_rating_windows (
  season_id bigint PRIMARY KEY REFERENCES public.seasons(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.team_rating_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_rating_windows FROM PUBLIC, anon, authenticated;

-- ---------- ratings: in-app columns on prior-year ratings ----------
ALTER TABLE public.historical_evaluations
  ADD COLUMN source_team_id bigint REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN source_player_season_id bigint REFERENCES public.player_seasons(id) ON DELETE SET NULL,
  ADD COLUMN not_rated boolean NOT NULL DEFAULT false,
  ADD COLUMN updated_at timestamptz;
CREATE UNIQUE INDEX historical_evaluations_team_player_uidx
  ON public.historical_evaluations (source_team_id, player_id) WHERE source_team_id IS NOT NULL;
ALTER TABLE public.historical_evaluations DROP CONSTRAINT historical_evaluations_player_match_method_check;
ALTER TABLE public.historical_evaluations ADD CONSTRAINT historical_evaluations_player_match_method_check
  CHECK (player_match_method IS NULL OR player_match_method = ANY (ARRAY['player_id', 'name_and_details', 'manual_review', 'legacy_unmatched', 'team_roster']));

-- ---------- helpers ----------
CREATE FUNCTION private.team_ratings_open(p_season_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_rating_windows w JOIN public.seasons s ON s.id = w.season_id
                 WHERE w.season_id = p_season_id AND w.closed_at IS NULL AND NOT s.is_closed);
$$;

CREATE FUNCTION private.is_team_manager(p_team_id bigint, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_coach_assignments a
                 WHERE a.team_id = p_team_id AND a.coach_user_id = p_user_id AND a.assignment_role = 'manager');
$$;
REVOKE ALL ON FUNCTION private.team_ratings_open(bigint), private.is_team_manager(bigint, uuid) FROM PUBLIC, anon, authenticated;

-- Per team: players on it now, how many have a rating from this team, how many are marked Not rated.
CREATE FUNCTION private.team_rating_counts(p_team_id bigint)
RETURNS TABLE(players integer, rated integer, not_rated integer, last_saved_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT count(ps.id)::int,
         count(h.id) FILTER (WHERE NOT h.not_rated)::int,
         count(h.id) FILTER (WHERE h.not_rated)::int,
         max(COALESCE(h.updated_at, h.created_at))
  FROM public.player_seasons ps
  LEFT JOIN public.historical_evaluations h ON h.source_team_id = p_team_id AND h.player_id = ps.player_id
  WHERE ps.team_id = p_team_id;
$$;
REVOKE ALL ON FUNCTION private.team_rating_counts(bigint) FROM PUBLIC, anon, authenticated;

-- ---------- open and close ----------
CREATE FUNCTION public.admin_open_team_ratings(p_season_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_season public.seasons;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only league admins can open end-of-season ratings.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_season FROM public.seasons WHERE id = p_season_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Season not found.'; END IF;
  IF v_season.is_closed THEN
    RAISE EXCEPTION 'This season is closed. Reopen it first to collect ratings.';
  END IF;
  INSERT INTO public.team_rating_windows (season_id, opened_at, opened_by)
  VALUES (p_season_id, now(), auth.uid())
  ON CONFLICT (season_id) DO UPDATE SET opened_at = now(), opened_by = auth.uid(), closed_at = NULL, closed_by = NULL;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id)
  VALUES (auth.uid(), 'team_ratings_opened', 'seasons', p_season_id::text);
END $$;

CREATE FUNCTION public.admin_close_team_ratings(p_season_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only league admins can close end-of-season ratings.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.team_rating_windows SET closed_at = now(), closed_by = auth.uid()
  WHERE season_id = p_season_id AND closed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'End-of-season ratings aren''t open for this season.'; END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (auth.uid(), 'team_ratings_closed', 'seasons', p_season_id::text,
          jsonb_build_object('ratings', (SELECT count(*) FROM public.historical_evaluations h JOIN public.teams t ON t.id = h.source_team_id
                                         WHERE t.season_id = p_season_id)));
END $$;

-- ---------- progress (admins) ----------
CREATE FUNCTION public.admin_team_rating_progress(p_season_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only league admins can see rating progress.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'season_closed', (SELECT is_closed FROM public.seasons WHERE id = p_season_id),
    'window', (SELECT jsonb_build_object('opened_at', w.opened_at, 'opened_by', private.person_name(w.opened_by),
                 'closed_at', w.closed_at, 'closed_by', private.person_name(w.closed_by), 'is_open', private.team_ratings_open(p_season_id))
               FROM public.team_rating_windows w WHERE w.season_id = p_season_id),
    'teams', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'team_id', t.id, 'team', t.name, 'division', d.name,
        'manager', (SELECT private.person_name(a.coach_user_id) FROM public.team_coach_assignments a WHERE a.team_id = t.id AND a.assignment_role = 'manager'),
        'manager_signed_in', (SELECT u.last_sign_in_at IS NOT NULL FROM public.team_coach_assignments a JOIN auth.users u ON u.id = a.coach_user_id
                              WHERE a.team_id = t.id AND a.assignment_role = 'manager'),
        'players', c.players, 'rated', c.rated, 'not_rated', c.not_rated, 'last_saved_at', c.last_saved_at)
        ORDER BY d.sort_order DESC, t.name)
      FROM public.teams t
      JOIN public.season_divisions sd ON sd.id = t.season_division_id JOIN public.divisions d ON d.id = sd.division_id
      CROSS JOIN LATERAL private.team_rating_counts(t.id) c
      WHERE t.season_id = p_season_id), '[]'::jsonb));
END $$;

-- ---------- the manager's side ----------
CREATE FUNCTION public.my_rating_teams() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id', t.id, 'team', t.name, 'division', d.name, 'season_id', s.id, 'season', s.name,
    'is_open', private.team_ratings_open(s.id), 'players', c.players, 'rated', c.rated, 'not_rated', c.not_rated)
    ORDER BY s.start_date DESC, d.sort_order DESC, t.name), '[]'::jsonb)
  FROM public.team_coach_assignments a
  JOIN public.teams t ON t.id = a.team_id
  JOIN public.season_divisions sd ON sd.id = t.season_division_id JOIN public.divisions d ON d.id = sd.division_id
  JOIN public.seasons s ON s.id = t.season_id AND NOT s.is_closed
  JOIN public.team_rating_windows w ON w.season_id = s.id
  CROSS JOIN LATERAL private.team_rating_counts(t.id) c
  WHERE a.coach_user_id = auth.uid() AND a.assignment_role = 'manager';
$$;

CREATE FUNCTION public.team_rating_sheet(p_team_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_team public.teams;
  v_admin boolean := public.is_admin();
BEGIN
  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id;
  IF NOT FOUND OR NOT (v_admin OR private.is_team_manager(p_team_id, auth.uid())) THEN
    RAISE EXCEPTION 'Only the team''s manager and league admins can rate this team.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_admin AND NOT EXISTS (SELECT 1 FROM public.team_rating_windows WHERE season_id = v_team.season_id) THEN
    RAISE EXCEPTION 'End-of-season ratings haven''t been opened yet.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'team_id', v_team.id, 'team', v_team.name, 'season_id', v_team.season_id,
    'season', (SELECT name FROM public.seasons WHERE id = v_team.season_id),
    'division', (SELECT d.name FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id WHERE sd.id = v_team.season_division_id),
    'manager', (SELECT private.person_name(a.coach_user_id) FROM public.team_coach_assignments a WHERE a.team_id = v_team.id AND a.assignment_role = 'manager'),
    'is_open', private.team_ratings_open(v_team.season_id),
    'can_save', CASE WHEN v_admin THEN NOT (SELECT is_closed FROM public.seasons WHERE id = v_team.season_id)
                     ELSE private.team_ratings_open(v_team.season_id) END,
    'players', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'player_season_id', ps.id, 'first_name', pl.first_name, 'last_name', pl.last_name,
        'bib', ps.evaluation_number, 'league_age', ps.league_age,
        'status', CASE WHEN h.id IS NULL THEN 'todo' WHEN h.not_rated THEN 'not_rated' ELSE 'rated' END,
        'saved_at', COALESCE(h.updated_at, h.created_at),
        'ratings', COALESCE((SELECT jsonb_object_agg(rc.code, hr.score) FROM public.historical_ratings hr
                             JOIN public.rating_categories rc ON rc.id = hr.rating_category_id
                             WHERE hr.historical_evaluation_id = h.id), '{}'::jsonb))
        ORDER BY pl.last_name, pl.first_name)
      FROM public.player_seasons ps
      JOIN public.players pl ON pl.id = ps.player_id
      LEFT JOIN public.historical_evaluations h ON h.source_team_id = v_team.id AND h.player_id = ps.player_id
      WHERE ps.team_id = v_team.id), '[]'::jsonb));
END $$;

CREATE FUNCTION public.save_team_rating(p_team_id bigint, p_player_season_id bigint, p_ratings jsonb, p_not_rated boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_team public.teams;
  v_season public.seasons;
  v_ps public.player_seasons;
  v_admin boolean := public.is_admin();
  v_manager uuid;
  v_he public.historical_evaluations;
  v_ratings jsonb := '{}'::jsonb;
  v_item record;
  v_score integer;
  v_core integer := 0;
  v_before jsonb;
BEGIN
  IF private.in_preview() THEN
    RAISE EXCEPTION 'Admin preview is read-only: nothing is saved.' USING ERRCODE = '42501';
  END IF;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_team FROM public.teams WHERE id = p_team_id;
  IF NOT FOUND OR NOT (v_admin OR private.is_team_manager(p_team_id, v_actor)) THEN
    RAISE EXCEPTION 'Only the team''s manager and league admins can rate this team.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_season FROM public.seasons WHERE id = v_team.season_id;
  IF v_season.is_closed THEN RAISE EXCEPTION 'This season is closed. Ratings can''t change.'; END IF;
  IF NOT v_admin AND NOT private.team_ratings_open(v_season.id) THEN
    RAISE EXCEPTION 'End-of-season ratings are closed. Ask a league admin to open them again.';
  END IF;
  SELECT * INTO v_ps FROM public.player_seasons WHERE id = p_player_season_id;
  IF NOT FOUND OR v_ps.team_id IS DISTINCT FROM p_team_id THEN
    RAISE EXCEPTION 'That player isn''t on this team.';
  END IF;

  -- Scores: known category codes, whole numbers 1-5; blanks (null or "") are skipped.
  IF NOT COALESCE(p_not_rated, false) THEN
    FOR v_item IN SELECT key, value FROM jsonb_each(COALESCE(p_ratings, '{}'::jsonb)) LOOP
      CONTINUE WHEN v_item.value = 'null'::jsonb OR v_item.value = '""'::jsonb;
      IF NOT EXISTS (SELECT 1 FROM public.rating_categories WHERE code = v_item.key) THEN
        RAISE EXCEPTION 'Unknown skill: %', v_item.key;
      END IF;
      BEGIN
        v_score := (v_item.value #>> '{}')::integer;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Scores are whole numbers from 1 to 5.';
      END;
      IF v_score NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Scores are whole numbers from 1 to 5.'; END IF;
      v_ratings := v_ratings || jsonb_build_object(v_item.key, v_score);
      IF EXISTS (SELECT 1 FROM public.rating_categories WHERE code = v_item.key AND category_group = 'core') THEN
        v_core := v_core + 1;
      END IF;
    END LOOP;
    IF v_core = 0 THEN
      RAISE EXCEPTION 'Rate at least one of the five core skills, or choose Not rated.';
    END IF;
  END IF;

  SELECT a.coach_user_id INTO v_manager FROM public.team_coach_assignments a WHERE a.team_id = p_team_id AND a.assignment_role = 'manager';
  SELECT * INTO v_he FROM public.historical_evaluations WHERE source_team_id = p_team_id AND player_id = v_ps.player_id FOR UPDATE;
  IF FOUND THEN
    SELECT jsonb_build_object('not_rated', v_he.not_rated, 'ratings',
             COALESCE((SELECT jsonb_object_agg(rc.code, hr.score) FROM public.historical_ratings hr
                       JOIN public.rating_categories rc ON rc.id = hr.rating_category_id WHERE hr.historical_evaluation_id = v_he.id), '{}'::jsonb))
      INTO v_before;
    DELETE FROM public.historical_ratings WHERE historical_evaluation_id = v_he.id;
    UPDATE public.historical_evaluations
    SET not_rated = COALESCE(p_not_rated, false), coverage_note = CASE WHEN p_not_rated THEN 'Not rated' END,
        source_player_season_id = v_ps.id, updated_at = now()
    WHERE id = v_he.id RETURNING * INTO v_he;
  ELSE
    INSERT INTO public.historical_evaluations (
      player_id, source_season_label, source_division_name, source_team_label, source_season_id,
      source_coach_user_id, source_coach_name, player_match_method, created_by, review_reason,
      source_team_id, source_player_season_id, not_rated, coverage_note, updated_at)
    VALUES (
      v_ps.player_id, v_season.name,
      (SELECT d.name FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id WHERE sd.id = v_team.season_division_id),
      v_team.name, v_season.id, COALESCE(v_manager, v_actor), private.person_name(COALESCE(v_manager, v_actor)), 'team_roster', v_actor,
      'Rated in the app at the end of the season', p_team_id, v_ps.id, COALESCE(p_not_rated, false),
      CASE WHEN p_not_rated THEN 'Not rated' END, now())
    RETURNING * INTO v_he;
  END IF;

  INSERT INTO public.historical_ratings (historical_evaluation_id, category_name, score, rating_category_id, source_category_code)
  SELECT v_he.id, rc.name, (r.value #>> '{}')::integer, rc.id, rc.code
  FROM jsonb_each(v_ratings) r JOIN public.rating_categories rc ON rc.code = r.key;

  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, before_data, after_data)
  VALUES (v_actor, 'team_rating_saved', 'historical_evaluations', v_he.id::text, v_before,
          jsonb_build_object('team_id', p_team_id, 'player_season_id', v_ps.id, 'not_rated', v_he.not_rated, 'ratings', v_ratings,
                             'by_admin', v_admin AND NOT private.is_team_manager(p_team_id, v_actor)));
  RETURN jsonb_build_object('status', CASE WHEN v_he.not_rated THEN 'not_rated' ELSE 'rated' END, 'saved_at', v_he.updated_at, 'ratings', v_ratings);
END $$;

REVOKE ALL ON FUNCTION public.admin_open_team_ratings(bigint), public.admin_close_team_ratings(bigint), public.admin_team_rating_progress(bigint),
  public.my_rating_teams(), public.team_rating_sheet(bigint), public.save_team_rating(bigint, bigint, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_open_team_ratings(bigint), public.admin_close_team_ratings(bigint), public.admin_team_rating_progress(bigint),
  public.my_rating_teams(), public.team_rating_sheet(bigint), public.save_team_rating(bigint, bigint, jsonb, boolean) TO authenticated;

-- ---------- prior-year averages: earlier seasons only, rated only ----------
CREATE OR REPLACE FUNCTION private.session_player_summary(p_session_id bigint, p_viewer uuid)
 RETURNS TABLE(player_season_id bigint, evaluation_number integer, first_name text, last_name text, league_age integer, coach_overall numeric, coach_skills_rated integer, coach_evaluations integer, evaluator_overall numeric, evaluator_skills_rated integer, evaluator_evaluations integer, prior_overall numeric, prior_skills_rated integer, prior_ratings integer, skill_averages jsonb, my_evaluation jsonb, blank_core_skills integer, not_evaluated_marks integer, drafts_excluded integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH s AS (
    SELECT es.id, es.season_id, es.league_age, se.start_date
    FROM public.evaluation_sessions es JOIN public.seasons se ON se.id = es.season_id
    WHERE es.id = p_session_id
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
  -- Prior-year ratings: from seasons that start before this one (or with no known season), with at least one score.
  hist_ev AS (
    SELECT he.id, he.player_id
    FROM public.historical_evaluations he
    LEFT JOIN public.seasons hs ON hs.id = he.source_season_id
    WHERE he.player_id IN (SELECT player_id FROM roster)
      AND (hs.id IS NULL OR hs.start_date < (SELECT start_date FROM s))
      AND EXISTS (SELECT 1 FROM public.historical_ratings x WHERE x.historical_evaluation_id = he.id)
  ),
  hist AS (
    SELECT he.player_id, rc.code, rc.category_group, avg(hr.score)::numeric AS avg_score
    FROM hist_ev he
    JOIN public.historical_ratings hr ON hr.historical_evaluation_id = he.id
    JOIN public.rating_categories rc ON rc.id = hr.rating_category_id
    GROUP BY 1, 2, 3
  ),
  hist_player AS (
    SELECT h.player_id,
           avg(avg_score) FILTER (WHERE category_group = 'core') AS overall,
           count(*) FILTER (WHERE category_group = 'core')::int AS skills_rated,
           avg(avg_score) FILTER (WHERE category_group = 'pitching') AS pitching,
           avg(avg_score) FILTER (WHERE category_group = 'catching') AS catching,
           jsonb_object_agg(code, round(avg_score, 2)) AS skills,
           (SELECT count(*) FROM hist_ev x WHERE x.player_id = h.player_id)::int AS n
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

-- ---------- season close checklist: ratings still open, players not rated ----------
CREATE OR REPLACE FUNCTION public.admin_season_close_check(p_season_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'open_age_groups', COALESCE((SELECT jsonb_agg(es.league_age ORDER BY es.league_age) FROM public.evaluation_sessions es
                                 WHERE es.season_id = p_season_id AND es.status = 'open' AND es.league_age IS NOT NULL), '[]'::jsonb),
    'setup_age_groups', COALESCE((SELECT jsonb_agg(es.league_age ORDER BY es.league_age) FROM public.evaluation_sessions es
                                  WHERE es.season_id = p_season_id AND es.status = 'setup' AND es.league_age IS NOT NULL), '[]'::jsonb),
    'unreleased_age_groups', COALESCE((SELECT jsonb_agg(es.league_age ORDER BY es.league_age) FROM public.evaluation_sessions es
                                       WHERE es.season_id = p_season_id AND es.status = 'locked' AND es.published_at IS NULL AND es.league_age IS NOT NULL), '[]'::jsonb),
    'import_rows_waiting', (SELECT count(*) FROM public.sports_connect_import_rows r JOIN public.import_batches b ON b.id = r.import_batch_id
                            WHERE b.season_id = p_season_id
                              AND r.review_state IN ('needs_review', 'ready_for_match_review', 'approved_new', 'approved_match', 'has_changes')),
    'bib_rows_held', (SELECT count(*) FROM public.bib_import_rows r JOIN public.import_batches b ON b.id = r.import_batch_id
                      WHERE b.season_id = p_season_id AND r.status = 'held'),
    'players_without_bib', (SELECT count(*) FROM public.player_seasons ps WHERE ps.season_id = p_season_id AND ps.evaluation_number IS NULL),
    'draft_evaluations', (SELECT count(*) FROM public.evaluations e JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
                          WHERE es.season_id = p_season_id AND e.status = 'draft'),
    'team_ratings_open', EXISTS (SELECT 1 FROM public.team_rating_windows w WHERE w.season_id = p_season_id AND w.closed_at IS NULL),
    'team_players_unrated', (SELECT count(*) FROM public.player_seasons ps
                             WHERE ps.season_id = p_season_id AND ps.team_id IS NOT NULL
                               AND NOT EXISTS (SELECT 1 FROM public.historical_evaluations h
                                               WHERE h.source_team_id = ps.team_id AND h.player_id = ps.player_id)))
  WHERE public.is_admin();
$function$;
