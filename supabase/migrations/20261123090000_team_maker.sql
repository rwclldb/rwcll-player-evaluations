-- Team maker (draft step 5, decided 2026-11-19 and 2026-11-22; docs/DRAFT-SPEC.md section 4).
-- Makes balanced teams for any division (RWCLL drafts most divisions and uses this for AA, and for Seniors when
-- there is more than one team). The balancing runs in the browser (lib/team-maker.ts); the database supplies the
-- players and saves the result.
--
-- * team_maker_data(season_division_id): the division's teams (staff names) and players: everyone in its pool who
--   isn't on a team, plus everyone already on its teams (they stay where they are), with the evaluator, coach and
--   prior-year overalls, LL age, sibling group, and the team of a coach's kid (kid of that team's Manager or Coach).
-- * admin_place_players(season_division_id, assignments, settings): admins and registrars place unplaced players on
--   the division's teams in one go. Refused while the division's draft is running, for a player who is already on a
--   team, or for a team in another division. Each placement is a roster move of kind "team_maker"; one audit entry
--   (teams_generated) keeps the settings used.
-- * Placement and the roster CSV say "Team maker" for these players.

ALTER TABLE public.roster_moves ADD COLUMN kind text NOT NULL DEFAULT 'move' CHECK (kind IN ('move', 'team_maker'));

CREATE FUNCTION public.team_maker_data(p_season_division_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_sd public.season_divisions;
BEGIN
  SELECT * INTO v_sd FROM public.season_divisions WHERE id = p_season_division_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Division not found.'; END IF;
  IF auth.uid() IS NULL OR NOT public.can_register(v_sd.season_id) THEN
    RAISE EXCEPTION 'Only admins and registrars can make teams.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    WITH ids AS (
      SELECT p.player_season_id FROM private.division_pool(p_season_division_id) p
      UNION
      SELECT ps.id FROM public.player_seasons ps JOIN public.teams t ON t.id = ps.team_id WHERE t.season_division_id = p_season_division_id
    ),
    sums AS (
      SELECT x.player_season_id, x.evaluator_overall, x.coach_overall, x.prior_overall
      FROM public.evaluation_sessions es CROSS JOIN LATERAL private.session_player_summary(es.id, NULL) x
      WHERE es.season_id = v_sd.season_id
        AND es.league_age IN (SELECT ps.league_age FROM public.player_seasons ps WHERE ps.id IN (SELECT player_season_id FROM ids))
    ),
    kids AS (
      SELECT DISTINCT ON (l.player_season_id) l.player_season_id, t.id AS team_id
      FROM public.coach_kid_links l
      JOIN public.team_coach_assignments a ON a.coach_user_id = l.parent_user_id AND a.assignment_role IN ('manager', 'coach')
      JOIN public.teams t ON t.id = a.team_id AND t.season_division_id = p_season_division_id
      ORDER BY l.player_season_id, CASE a.assignment_role WHEN 'manager' THEN 1 ELSE 2 END
    )
    SELECT jsonb_build_object(
      'division', jsonb_build_object('season_division_id', v_sd.id, 'season_id', v_sd.season_id, 'min_age', v_sd.min_age, 'max_age', v_sd.max_age,
        'name', (SELECT d.name FROM public.divisions d WHERE d.id = v_sd.division_id),
        'season', (SELECT name FROM public.seasons WHERE id = v_sd.season_id),
        'draft_status', (SELECT dr.status FROM public.drafts dr WHERE dr.season_division_id = v_sd.id)),
      'teams', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'staff', private.team_staff_json(t.id)) ORDER BY t.name), '[]')
                FROM public.teams t WHERE t.season_division_id = p_season_division_id),
      'players', (SELECT COALESCE(jsonb_agg(private.player_brief(i.player_season_id) || jsonb_build_object(
          'team_id', ps.team_id, 'evaluator_overall', s.evaluator_overall, 'coach_overall', s.coach_overall, 'prior_overall', s.prior_overall,
          'sibling_group', (SELECT m.group_id FROM public.sibling_group_members m WHERE m.player_season_id = i.player_season_id),
          'kid_team_id', k.team_id) ORDER BY i.player_season_id), '[]')
        FROM ids i JOIN public.player_seasons ps ON ps.id = i.player_season_id
        LEFT JOIN sums s ON s.player_season_id = i.player_season_id
        LEFT JOIN kids k ON k.player_season_id = i.player_season_id)
    )
  );
END $$;

-- p_assignments: [{player_season_id, team_id}]; p_settings: what the team maker balanced on (kept in the audit entry).
CREATE FUNCTION public.admin_place_players(p_season_division_id bigint, p_assignments jsonb, p_settings jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_sd public.season_divisions;
  v_row record;
  v_ps public.player_seasons;
  v_team public.teams;
  v_n integer := 0;
BEGIN
  SELECT * INTO v_sd FROM public.season_divisions WHERE id = p_season_division_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Division not found.'; END IF;
  PERFORM private.assert_team_editor(v_sd.season_id);
  IF EXISTS (SELECT 1 FROM public.drafts WHERE season_division_id = p_season_division_id AND status IN ('live', 'paused')) THEN
    RAISE EXCEPTION 'This division''s draft is running. Finish it first.';
  END IF;
  IF jsonb_typeof(p_assignments) <> 'array' OR jsonb_array_length(p_assignments) = 0 THEN RAISE EXCEPTION 'Nothing to place.'; END IF;
  FOR v_row IN SELECT * FROM jsonb_to_recordset(p_assignments) AS x(player_season_id bigint, team_id bigint) LOOP
    SELECT * INTO v_ps FROM public.player_seasons WHERE id = v_row.player_season_id FOR UPDATE;
    SELECT * INTO v_team FROM public.teams WHERE id = v_row.team_id;
    IF v_ps.id IS NULL OR v_ps.season_id <> v_sd.season_id THEN RAISE EXCEPTION 'Player % not found in this season.', v_row.player_season_id; END IF;
    IF v_team.id IS NULL OR v_team.season_division_id <> p_season_division_id THEN RAISE EXCEPTION 'A team isn''t in this division.'; END IF;
    IF v_ps.team_id IS NOT NULL THEN
      RAISE EXCEPTION '% % is already on a team. Load the team maker again.', (SELECT first_name FROM public.players WHERE id = v_ps.player_id), (SELECT last_name FROM public.players WHERE id = v_ps.player_id);
    END IF;
    UPDATE public.player_seasons SET team_id = v_team.id, season_division_id = p_season_division_id WHERE id = v_ps.id;
    INSERT INTO public.roster_moves (season_id, player_season_id, from_team_id, to_team_id, to_team_name, note, moved_by, kind)
    VALUES (v_sd.season_id, v_ps.id, NULL, v_team.id, v_team.name, 'Team maker', auth.uid(), 'team_maker');
    v_n := v_n + 1;
  END LOOP;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (auth.uid(), 'teams_generated', 'season_divisions', p_season_division_id::text,
          jsonb_build_object('placed', v_n, 'settings', COALESCE(p_settings, '{}'::jsonb)));
  RETURN v_n;
END $$;

-- Placement: team-maker placements read as such.
CREATE OR REPLACE FUNCTION private.placement(p_player_season_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT COALESCE(
    (SELECT CASE WHEN m.kind = 'team_maker' THEN jsonb_build_object('how', 'team_maker', 'at', m.moved_at)
                 ELSE jsonb_build_object('how', 'moved', 'note', m.note, 'at', m.moved_at, 'from', m.from_team_name) END
     FROM public.roster_moves m JOIN public.player_seasons ps ON ps.id = m.player_season_id
     WHERE m.player_season_id = p_player_season_id AND m.to_team_id = ps.team_id
       AND m.moved_at > COALESCE((SELECT max(dp.made_at) FROM public.draft_picks dp WHERE dp.player_season_id = p_player_season_id AND dp.team_id = ps.team_id), '-infinity')
     ORDER BY m.moved_at DESC, m.id DESC LIMIT 1),
    (SELECT jsonb_build_object('how', CASE dp.kind WHEN 'pick' THEN 'drafted' ELSE dp.kind END, 'round', dp.round, 'overall', dp.overall,
              'override', dp.override_note IS NOT NULL)
     FROM public.draft_picks dp JOIN public.player_seasons ps ON ps.id = dp.player_season_id
     WHERE dp.player_season_id = p_player_season_id AND dp.team_id = ps.team_id ORDER BY dp.made_at DESC LIMIT 1),
    jsonb_build_object('how', 'placed'));
$$;

REVOKE ALL ON FUNCTION public.team_maker_data(bigint), public.admin_place_players(bigint, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_maker_data(bigint), public.admin_place_players(bigint, jsonb, jsonb) TO authenticated;

-- The roster CSV: "Team maker" placements.
CREATE OR REPLACE FUNCTION public.season_roster_rows(p_season_id bigint)
RETURNS TABLE (season text, division text, team text, manager text, manager_email text, coach text, coach_email text,
  player_first_name text, player_last_name text, sports_connect_player_id text, registration_number text, bib integer,
  league_age integer, coach_kid boolean, sibling_group bigint, placed_by text, requested_division text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_admin boolean := public.is_admin();
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_register(p_season_id) THEN
    RAISE EXCEPTION 'Only admins and registrars can export team rosters.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH staff AS (
    SELECT a.team_id, a.assignment_role, private.person_name(a.coach_user_id) AS name,
           CASE WHEN v_admin THEN u.email::text END AS email
    FROM public.team_coach_assignments a JOIN auth.users u ON u.id = a.coach_user_id
    WHERE a.season_id = p_season_id AND a.assignment_role IN ('manager', 'coach')
  ),
  req AS (SELECT * FROM private.season_requested_divisions(p_season_id))
  SELECT s.name, d.name, t.name,
    (SELECT x.name FROM staff x WHERE x.team_id = t.id AND x.assignment_role = 'manager'),
    (SELECT x.email FROM staff x WHERE x.team_id = t.id AND x.assignment_role = 'manager'),
    (SELECT x.name FROM staff x WHERE x.team_id = t.id AND x.assignment_role = 'coach'),
    (SELECT x.email FROM staff x WHERE x.team_id = t.id AND x.assignment_role = 'coach'),
    pl.first_name, pl.last_name, ps.external_player_id, ps.external_registration_id, ps.evaluation_number, ps.league_age, ps.is_coach_kid,
    (SELECT m.group_id FROM public.sibling_group_members m WHERE m.player_season_id = ps.id),
    (SELECT CASE pc->>'how'
       WHEN 'drafted' THEN format('Draft round %s, pick %s', pc->>'round', pc->>'overall')
       WHEN 'coach_kid' THEN format('Coach''s kid (round %s)', pc->>'round')
       WHEN 'sibling' THEN format('Sibling (round %s)', pc->>'round')
       WHEN 'team_maker' THEN 'Team maker'
       WHEN 'moved' THEN 'Moved by admin: ' || (pc->>'note')
       ELSE 'Placed by admin' END FROM private.placement(ps.id) pc),
    (SELECT r.source_division FROM req r WHERE r.player_season_id = ps.id)
  FROM public.player_seasons ps
  JOIN public.players pl ON pl.id = ps.player_id
  JOIN public.teams t ON t.id = ps.team_id
  JOIN public.season_divisions sd ON sd.id = t.season_division_id JOIN public.divisions d ON d.id = sd.division_id
  JOIN public.seasons s ON s.id = ps.season_id
  WHERE ps.season_id = p_season_id
  ORDER BY d.sort_order DESC, t.name, pl.last_name, pl.first_name;
END $$;
