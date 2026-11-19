-- Default must-draft ages (decided 2026-11-19): every age in Juniors (13 and 14: every 13-14 year-old plays
-- Juniors); the top age everywhere else (Majors 12, AAA 11). Used when a draft is first set up without an earlier
-- season to copy from, and for a division's pool before its draft exists. Admins can still change the ages per draft.
-- A coach's kid outside the division's ages (a 9-year-old in Majors) stays out of the pool unless added by hand
-- (confirmed 2026-11-19; unchanged here).

CREATE FUNCTION private.default_must_draft_ages(p_season_division_id bigint) RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT CASE
    WHEN sd.max_age IS NULL THEN '{}'::integer[]
    WHEN lower(d.name) = 'juniors' AND sd.min_age IS NOT NULL THEN ARRAY(SELECT generate_series(sd.min_age, sd.max_age))
    ELSE ARRAY[sd.max_age]
  END
  FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id WHERE sd.id = p_season_division_id;
$$;
REVOKE ALL ON FUNCTION private.default_must_draft_ages(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.division_pool(p_season_division_id bigint)
RETURNS TABLE (player_season_id bigint, reason text, must_draft boolean, requested text, from_division text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  WITH sd AS (
    SELECT sd.id, sd.season_id, sd.min_age, sd.max_age FROM public.season_divisions sd WHERE sd.id = p_season_division_id
  ),
  dr AS (SELECT d.* FROM public.drafts d WHERE d.season_division_id = p_season_division_id),
  must AS (
    SELECT COALESCE((SELECT must_draft_ages FROM dr), private.default_must_draft_ages(p_season_division_id)) AS ages,
           COALESCE((SELECT pool_by_age_only FROM dr), false) AS by_age
  ),
  staff AS (
    SELECT a.coach_user_id FROM public.team_coach_assignments a JOIN public.teams t ON t.id = a.team_id
    WHERE t.season_division_id = p_season_division_id AND a.assignment_role IN ('manager', 'coach')
  ),
  kids AS (SELECT DISTINCT l.player_season_id FROM public.coach_kid_links l WHERE l.parent_user_id IN (SELECT coach_user_id FROM staff)),
  req AS (SELECT * FROM private.season_requested_divisions((SELECT season_id FROM sd))),
  leftover AS (
    SELECT lo.player_season_id, min(dv.name) AS division
    FROM public.draft_leftovers lo JOIN public.drafts d ON d.id = lo.draft_id
    JOIN public.season_divisions s2 ON s2.id = d.season_division_id JOIN public.divisions dv ON dv.id = s2.division_id
    WHERE d.status = 'done' AND d.season_division_id <> p_season_division_id
    GROUP BY lo.player_season_id
  ),
  scored AS (
    SELECT ps.id, ps.league_age, req.source_division,
      (SELECT o.mode FROM public.division_pool_overrides o WHERE o.player_season_id = ps.id AND o.season_division_id = p_season_division_id) AS here,
      EXISTS (SELECT 1 FROM public.division_pool_overrides o WHERE o.player_season_id = ps.id AND o.season_division_id <> p_season_division_id AND o.mode = 'in') AS elsewhere,
      ps.id IN (SELECT player_season_id FROM kids) AS kid,
      req.season_division_id = p_season_division_id AS requested_here,
      lo.division AS from_div
    FROM public.player_seasons ps
    CROSS JOIN sd
    LEFT JOIN req ON req.player_season_id = ps.id
    LEFT JOIN leftover lo ON lo.player_season_id = ps.id
    WHERE ps.season_id = sd.season_id AND ps.team_id IS NULL
  ),
  decided AS (
    SELECT s.*, CASE
      WHEN s.here = 'out' THEN NULL
      WHEN s.here = 'in' THEN 'override_in'
      WHEN s.elsewhere THEN NULL
      WHEN s.league_age IS NULL OR s.league_age < (SELECT min_age FROM sd) OR s.league_age > (SELECT max_age FROM sd) THEN NULL
      WHEN s.kid THEN 'coach_kid'
      WHEN s.league_age = ANY (m.ages) THEN 'must_draft_age'
      WHEN m.by_age THEN 'by_age'
      WHEN s.requested_here THEN 'requested'
      WHEN s.from_div IS NOT NULL THEN 'from_above'
    END AS reason, m.ages
    FROM scored s CROSS JOIN must m
  )
  SELECT d.id, d.reason, d.kid OR COALESCE(d.league_age = ANY (d.ages), false), d.source_division, d.from_div
  FROM decided d WHERE d.reason IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_draft(p_season_division_id bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_sd public.season_divisions;
  v_prev public.drafts;
  v_id bigint;
BEGIN
  SELECT * INTO v_sd FROM public.season_divisions WHERE id = p_season_division_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Division not found.'; END IF;
  PERFORM private.assert_team_editor(v_sd.season_id);
  IF EXISTS (SELECT 1 FROM public.drafts WHERE season_division_id = p_season_division_id) THEN
    RAISE EXCEPTION 'This division already has a draft.';
  END IF;
  v_prev := private.previous_draft(p_season_division_id);
  IF v_prev.id IS NOT NULL THEN
    INSERT INTO public.drafts (season_id, season_division_id, pool_by_age_only, must_draft_ages, roster_size, order_type, age_order,
      coach_kid_rule, coach_kid_rounds, coach_kid_by_round, siblings_together, sibling_optional, pick_timer_seconds, copied_from_draft_id, created_by)
    VALUES (v_sd.season_id, p_season_division_id, v_prev.pool_by_age_only, v_prev.must_draft_ages, v_prev.roster_size, v_prev.order_type,
      v_prev.age_order, v_prev.coach_kid_rule, v_prev.coach_kid_rounds, v_prev.coach_kid_by_round, v_prev.siblings_together,
      v_prev.sibling_optional, v_prev.pick_timer_seconds, v_prev.id, auth.uid())
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.drafts (season_id, season_division_id, must_draft_ages, created_by)
    VALUES (v_sd.season_id, p_season_division_id, private.default_must_draft_ages(p_season_division_id), auth.uid())
    RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (auth.uid(), 'draft_created', 'drafts', v_id::text,
          (SELECT to_jsonb(d) FROM public.drafts d WHERE d.id = v_id) || jsonb_build_object('copied_from_draft_id', v_prev.id));
  RETURN v_id;
END $$;
