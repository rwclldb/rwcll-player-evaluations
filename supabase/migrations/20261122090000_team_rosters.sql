-- Team rosters (draft step 4, decided 2026-11-19; docs/DRAFT-SPEC.md section 5).
--
-- * admin_move_player(player, team | NULL, note): admins and registrars move a player to any team this season, or
--   back to the pool (NULL), any time, with a note. Recorded in roster_moves and the audit log.
--     - To a team: sets player_seasons.team_id and season_division_id. A draft pick stays on the board as history;
--       the board says where the player went.
--     - Back to the pool: clears the team. If the player was picked in a draft that is still running, the pick is
--       removed, so that slot opens again and is the next pick (how a wrong pick is fixed; no undo button).
-- * Rosters are released per division (roster_releases; admin_release_rosters, admins and registrars). After that,
--   each team's Manager, Coach and assistants see their team (my_team_rosters()).
-- * Reads: season_rosters(season) for the Team rosters page (coach emails only for admins), season_roster_rows(season)
--   for the CSV (one row per placed player; emails only for admins).
-- * draft_board now says where a drafted player was moved ("moved_to").

CREATE TABLE public.roster_moves (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id bigint NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  player_season_id bigint NOT NULL REFERENCES public.player_seasons(id) ON DELETE CASCADE,
  from_team_id bigint REFERENCES public.teams(id) ON DELETE SET NULL,
  to_team_id bigint REFERENCES public.teams(id) ON DELETE SET NULL,
  from_team_name text,
  to_team_name text,
  pick_removed boolean NOT NULL DEFAULT false,
  note text NOT NULL CHECK (length(btrim(note)) >= 3),
  moved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  moved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.roster_releases (
  season_division_id bigint PRIMARY KEY REFERENCES public.season_divisions(id) ON DELETE CASCADE,
  released_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.roster_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roster_moves, public.roster_releases FROM anon, authenticated;

-- How a player got onto their team, for the roster and the CSV.
CREATE FUNCTION private.placement(p_player_season_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('how', 'moved', 'note', m.note, 'at', m.moved_at, 'from', m.from_team_name)
     FROM public.roster_moves m JOIN public.player_seasons ps ON ps.id = m.player_season_id
     WHERE m.player_season_id = p_player_season_id AND m.to_team_id = ps.team_id
       AND m.moved_at > COALESCE((SELECT max(dp.made_at) FROM public.draft_picks dp WHERE dp.player_season_id = p_player_season_id AND dp.team_id = ps.team_id), '-infinity')
     ORDER BY m.moved_at DESC LIMIT 1),
    (SELECT jsonb_build_object('how', CASE dp.kind WHEN 'pick' THEN 'drafted' ELSE dp.kind END, 'round', dp.round, 'overall', dp.overall,
              'override', dp.override_note IS NOT NULL)
     FROM public.draft_picks dp JOIN public.player_seasons ps ON ps.id = dp.player_season_id
     WHERE dp.player_season_id = p_player_season_id AND dp.team_id = ps.team_id ORDER BY dp.made_at DESC LIMIT 1),
    jsonb_build_object('how', 'placed'));
$$;

CREATE FUNCTION public.admin_move_player(p_player_season_id bigint, p_to_team_id bigint, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_ps public.player_seasons;
  v_to public.teams;
  v_from_name text;
  v_note text := btrim(COALESCE(p_note, ''));
  v_pick record;
  v_removed boolean := false;
BEGIN
  SELECT * INTO v_ps FROM public.player_seasons WHERE id = p_player_season_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Player not found.'; END IF;
  PERFORM private.assert_team_editor(v_ps.season_id);
  IF length(v_note) < 3 THEN RAISE EXCEPTION 'Add a short note saying why.'; END IF;
  SELECT name INTO v_from_name FROM public.teams WHERE id = v_ps.team_id;

  IF p_to_team_id IS NULL THEN
    IF v_ps.team_id IS NULL THEN RAISE EXCEPTION 'This player isn''t on a team.'; END IF;
    UPDATE public.player_seasons SET team_id = NULL, season_division_id = NULL WHERE id = v_ps.id;
    -- A pick in a draft still running is removed: that slot opens again and comes up next.
    FOR v_pick IN SELECT dp.* FROM public.draft_picks dp JOIN public.drafts d ON d.id = dp.draft_id
                  WHERE dp.player_season_id = v_ps.id AND d.status IN ('live', 'paused') LOOP
      DELETE FROM public.draft_picks WHERE id = v_pick.id;
      UPDATE public.drafts SET clock_started_at = now(), updated_at = now() WHERE id = v_pick.draft_id;
      v_removed := true;
      INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data)
      VALUES (auth.uid(), 'draft_pick_removed', 'player_seasons', v_ps.id::text, v_note, to_jsonb(v_pick));
      PERFORM private.draft_advance(v_pick.draft_id);
    END LOOP;
  ELSE
    SELECT * INTO v_to FROM public.teams WHERE id = p_to_team_id;
    IF NOT FOUND OR v_to.season_id <> v_ps.season_id THEN RAISE EXCEPTION 'Team not found in this season.'; END IF;
    IF v_ps.team_id = v_to.id THEN RAISE EXCEPTION 'This player is already on %.', v_to.name; END IF;
    UPDATE public.player_seasons SET team_id = v_to.id, season_division_id = v_to.season_division_id WHERE id = v_ps.id;
    DELETE FROM public.draft_sibling_queue WHERE player_season_id = v_ps.id;
    DELETE FROM public.draft_sibling_asks WHERE player_season_id = v_ps.id;
    UPDATE public.drafts d SET updated_at = now() WHERE d.status IN ('live', 'paused')
      AND (d.season_division_id = v_to.season_division_id OR EXISTS (SELECT 1 FROM public.draft_picks dp WHERE dp.draft_id = d.id AND dp.player_season_id = v_ps.id));
  END IF;

  INSERT INTO public.roster_moves (season_id, player_season_id, from_team_id, to_team_id, from_team_name, to_team_name, pick_removed, note, moved_by)
  VALUES (v_ps.season_id, v_ps.id, v_ps.team_id, p_to_team_id, v_from_name, v_to.name, v_removed, v_note, auth.uid());
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (auth.uid(), 'roster_move', 'player_seasons', v_ps.id::text, v_note,
          jsonb_build_object('team_id', v_ps.team_id, 'team', v_from_name),
          jsonb_build_object('team_id', p_to_team_id, 'team', v_to.name, 'pick_removed', v_removed));
END $$;

CREATE FUNCTION public.admin_release_rosters(p_season_division_id bigint, p_release boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_sd public.season_divisions;
BEGIN
  SELECT * INTO v_sd FROM public.season_divisions WHERE id = p_season_division_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Division not found.'; END IF;
  PERFORM private.assert_team_editor(v_sd.season_id);
  IF p_release THEN
    INSERT INTO public.roster_releases (season_division_id, released_by) VALUES (p_season_division_id, auth.uid())
    ON CONFLICT (season_division_id) DO NOTHING;
  ELSE
    DELETE FROM public.roster_releases WHERE season_division_id = p_season_division_id;
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id)
  VALUES (auth.uid(), CASE WHEN p_release THEN 'rosters_released' ELSE 'rosters_unreleased' END, 'season_divisions', p_season_division_id::text);
END $$;

-- The Team rosters page: every division with its teams, staff, players and how they got there, the unplaced players
-- (with the pools they're in), and recent moves.
CREATE FUNCTION public.season_rosters(p_season_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_admin boolean := public.is_admin();
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_register(p_season_id) THEN
    RAISE EXCEPTION 'Only admins and registrars can see team rosters.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    WITH pools AS (
      SELECT p.player_season_id, array_agg(d.name ORDER BY d.sort_order) AS divisions
      FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id
      CROSS JOIN LATERAL private.division_pool(sd.id) p
      WHERE sd.season_id = p_season_id GROUP BY p.player_season_id
    )
    SELECT jsonb_build_object(
      'divisions', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'season_division_id', sd.id, 'name', d.name, 'min_age', sd.min_age, 'max_age', sd.max_age,
          'released_at', (SELECT r.released_at FROM public.roster_releases r WHERE r.season_division_id = sd.id),
          'draft_status', (SELECT dr.status FROM public.drafts dr WHERE dr.season_division_id = sd.id),
          'teams', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'id', t.id, 'name', t.name,
              'roster_size', (SELECT COALESCE(x.roster_size, dr.roster_size) FROM public.drafts dr LEFT JOIN public.draft_teams x ON x.draft_id = dr.id AND x.team_id = t.id
                              WHERE dr.season_division_id = sd.id),
              'staff', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', private.person_name(a.coach_user_id), 'role', a.assignment_role,
                          'email', CASE WHEN v_admin THEN (SELECT email FROM auth.users WHERE id = a.coach_user_id) END)
                          ORDER BY CASE a.assignment_role WHEN 'manager' THEN 1 WHEN 'coach' THEN 2 ELSE 3 END), '[]')
                        FROM public.team_coach_assignments a WHERE a.team_id = t.id),
              'players', (SELECT COALESCE(jsonb_agg(private.player_brief(ps.id) || jsonb_build_object('placement', private.placement(ps.id),
                            'sibling_group', (SELECT m.group_id FROM public.sibling_group_members m WHERE m.player_season_id = ps.id))
                            ORDER BY pl.last_name, pl.first_name), '[]')
                          FROM public.player_seasons ps JOIN public.players pl ON pl.id = ps.player_id WHERE ps.team_id = t.id)
            ) ORDER BY t.name), '[]')
            FROM public.teams t WHERE t.season_division_id = sd.id)
        ) ORDER BY d.sort_order DESC), '[]')
        FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id WHERE sd.season_id = p_season_id),
      'unplaced', (
        SELECT COALESCE(jsonb_agg(private.player_brief(ps.id) || jsonb_build_object('pools', to_jsonb(po.divisions))
          ORDER BY ps.league_age DESC, pl.last_name, pl.first_name), '[]')
        FROM public.player_seasons ps JOIN public.players pl ON pl.id = ps.player_id
        LEFT JOIN pools po ON po.player_season_id = ps.id
        WHERE ps.season_id = p_season_id AND ps.team_id IS NULL AND ps.league_age IS NOT NULL),
      'moves', (
        SELECT COALESCE(jsonb_agg(private.player_brief(m.player_season_id) || jsonb_build_object('from', m.from_team_name, 'to', m.to_team_name,
          'note', m.note, 'by', private.person_name(m.moved_by), 'at', m.moved_at, 'pick_removed', m.pick_removed) ORDER BY m.moved_at DESC), '[]')
        FROM (SELECT * FROM public.roster_moves WHERE season_id = p_season_id ORDER BY moved_at DESC LIMIT 100) m)
    )
  );
END $$;

-- The CSV: one row per placed player. Plain column names, to rename for Sports Connect later.
CREATE FUNCTION public.season_roster_rows(p_season_id bigint)
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

-- Managers, coaches and assistants: their team(s), once the division's rosters are released.
CREATE FUNCTION public.my_team_rosters() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'team_id', t.id, 'team', t.name, 'division', d.name, 'season', s.name, 'role', a.assignment_role,
    'staff', (SELECT jsonb_agg(jsonb_build_object('name', private.person_name(b.coach_user_id), 'role', b.assignment_role)
                ORDER BY CASE b.assignment_role WHEN 'manager' THEN 1 WHEN 'coach' THEN 2 ELSE 3 END)
              FROM public.team_coach_assignments b WHERE b.team_id = t.id),
    'players', (SELECT COALESCE(jsonb_agg(jsonb_build_object('first_name', pl.first_name, 'last_name', pl.last_name, 'bib', ps.evaluation_number,
                  'league_age', ps.league_age) ORDER BY pl.last_name, pl.first_name), '[]')
                FROM public.player_seasons ps JOIN public.players pl ON pl.id = ps.player_id WHERE ps.team_id = t.id)
  ) ORDER BY d.sort_order DESC, t.name), '[]')
  FROM public.team_coach_assignments a
  JOIN public.teams t ON t.id = a.team_id
  JOIN public.season_divisions sd ON sd.id = t.season_division_id JOIN public.divisions d ON d.id = sd.division_id
  JOIN public.seasons s ON s.id = t.season_id AND NOT s.is_closed
  JOIN public.roster_releases r ON r.season_division_id = sd.id
  WHERE a.coach_user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.admin_move_player(bigint, bigint, text), public.admin_release_rosters(bigint, boolean),
  public.season_rosters(bigint), public.season_roster_rows(bigint), public.my_team_rosters() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_move_player(bigint, bigint, text), public.admin_release_rosters(bigint, boolean),
  public.season_rosters(bigint), public.season_roster_rows(bigint), public.my_team_rosters() TO authenticated;
REVOKE ALL ON FUNCTION private.placement(bigint) FROM PUBLIC, anon, authenticated;

-- ---------- draft_board: where a drafted player was moved ----------
CREATE OR REPLACE FUNCTION public.draft_board(p_draft_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts;
  v_runs boolean;
  v_next record;
  v_marked integer[];
BEGIN
  IF NOT private.can_watch_draft(p_draft_id) THEN
    RAISE EXCEPTION 'Only this division''s managers and coaches, admins and registrars can watch this draft.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.drafts WHERE id = p_draft_id;
  v_runs := public.can_register(v.season_id);
  SELECT * INTO v_next FROM private.draft_next_slot(p_draft_id);
  v_marked := CASE WHEN v.status IN ('live', 'paused') THEN private.draft_marked_slots(p_draft_id) ELSE '{}' END;
  RETURN jsonb_build_object(
    'draft', jsonb_build_object('id', v.id, 'status', v.status, 'order_type', v.order_type, 'age_order', v.age_order,
      'coach_kid_rule', v.coach_kid_rule, 'pick_timer_seconds', v.pick_timer_seconds, 'started_at', v.started_at,
      'finished_at', v.finished_at, 'clock_started_at', v.clock_started_at, 'updated_at', v.updated_at,
      'season_division_id', v.season_division_id,
      'division', (SELECT d.name FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id WHERE sd.id = v.season_division_id),
      'season', (SELECT name FROM public.seasons WHERE id = v.season_id)),
    'can_run', v_runs,
    'now', now(),
    'my_team_ids', (SELECT COALESCE(jsonb_agg(DISTINCT a.team_id), '[]') FROM public.team_coach_assignments a JOIN public.teams t ON t.id = a.team_id
                    WHERE t.season_division_id = v.season_division_id AND a.coach_user_id = auth.uid() AND a.assignment_role IN ('manager', 'coach')),
    'teams', (SELECT COALESCE(jsonb_agg(jsonb_build_object('team_id', t.id, 'name', t.name, 'position', x.position,
                'roster_size', COALESCE(x.roster_size, v.roster_size),
                'manager', (SELECT private.person_name(a.coach_user_id) FROM public.team_coach_assignments a WHERE a.team_id = t.id AND a.assignment_role = 'manager'),
                'coach', (SELECT private.person_name(a.coach_user_id) FROM public.team_coach_assignments a WHERE a.team_id = t.id AND a.assignment_role = 'coach'))
              ORDER BY x.position NULLS LAST, t.name), '[]')
              FROM public.teams t LEFT JOIN public.draft_teams x ON x.team_id = t.id AND x.draft_id = v.id
              WHERE t.season_division_id = v.season_division_id),
    'slots', (SELECT COALESCE(jsonb_agg(jsonb_build_object('overall', s.overall, 'round', s.round, 'pick_in_round', s.pick_in_round, 'team_id', s.team_id,
                'marked', s.overall = ANY (v_marked),
                'pick', CASE WHEN p.id IS NULL THEN NULL ELSE private.player_brief(p.player_season_id) || jsonb_build_object(
                  'kind', p.kind, 'made_at', p.made_at, 'override', p.override_note IS NOT NULL,
                  'override_note', CASE WHEN v_runs THEN p.override_note END,
                  'moved_to', CASE WHEN cur.team_id IS DISTINCT FROM p.team_id THEN COALESCE((SELECT name FROM public.teams WHERE id = cur.team_id), 'the pool') END) END)
              ORDER BY s.overall), '[]')
              FROM private.draft_slots(v.id) s LEFT JOIN public.draft_picks p ON p.draft_id = v.id AND p.overall = s.overall
              LEFT JOIN public.player_seasons cur ON cur.id = p.player_season_id),
    'next', CASE WHEN v_next.overall IS NULL THEN NULL ELSE jsonb_build_object('overall', v_next.overall, 'round', v_next.round,
              'pick_in_round', v_next.pick_in_round, 'team_id', v_next.team_id,
              'must_only', v_next.overall = ANY (v_marked)) END,
    'tier_age', CASE WHEN v.age_order = 'oldest_first' AND v.status IN ('live', 'paused') THEN private.draft_tier_age(v.id) END,
    'available', (SELECT COALESCE(jsonb_agg(a.player_season_id), '[]') FROM private.draft_available(v.id) a),
    'must_left', (SELECT count(*) FROM private.draft_available(v.id) a WHERE a.must_draft),
    'reserved', (SELECT COALESCE(jsonb_object_agg(k.player_season_id, k.team_id), '{}') FROM public.draft_kid_rounds k WHERE k.draft_id = v.id AND k.team_id IS NOT NULL),
    'queued', (SELECT COALESCE(jsonb_agg(jsonb_build_object('player_season_id', q.player_season_id, 'team_id', q.team_id)), '[]') FROM public.draft_sibling_queue q WHERE q.draft_id = v.id),
    'asks', (SELECT COALESCE(jsonb_agg(private.player_brief(q.player_season_id) || jsonb_build_object('team_id', q.team_id,
               'because_of', private.player_brief(q.because_of))), '[]') FROM public.draft_sibling_asks q WHERE q.draft_id = v.id)
  );
END $$;

-- ---------- season backup: draft picks, roster moves and releases ----------
CREATE OR REPLACE FUNCTION public.admin_season_backup(p_season_id bigint)
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
    'coach_kid_links', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.coach_kid_links t WHERE t.season_id = p_season_id),
    'sibling_groups', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.sibling_groups t WHERE t.season_id = p_season_id),
    'sibling_group_members', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.player_season_id), '[]') FROM public.sibling_group_members t
                               WHERE t.group_id IN (SELECT id FROM public.sibling_groups WHERE season_id = p_season_id)),
    'draft_picks', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.draft_picks t WHERE t.draft_id IN (SELECT id FROM public.drafts WHERE season_id = p_season_id)),
    'roster_moves', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM public.roster_moves t WHERE t.season_id = p_season_id),
    'roster_releases', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.season_division_id), '[]') FROM public.roster_releases t
                        WHERE t.season_division_id IN (SELECT id FROM public.season_divisions WHERE season_id = p_season_id)),
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
