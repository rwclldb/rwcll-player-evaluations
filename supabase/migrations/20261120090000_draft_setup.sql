-- Draft setup (draft step 2, decided 2026-11-19; docs/DRAFT-SPEC.md section 2).
--
-- * drafts: one per division per season, with the rule settings. A new draft copies the settings of the same
--   division's draft in the latest earlier season (never the order or kid rounds); otherwise defaults, with the
--   division's top age as the must-draft age. Status setup | live | paused | done (live/paused/done are used by
--   the draft room, step 3); settings, roster sizes and the order change only in setup.
-- * draft_teams: per draft and team, the first-round position and an optional roster size for that team. The
--   teams themselves come from the Teams page. The order comes from a random draw (admin_draw_draft_order) or is
--   set by hand (admin_set_draft_order); both are audited.
-- * draft_kid_rounds: the round a coach's kid fills for their parent's team (rules: fixed rounds, round per kid,
--   placed before the draft). Unset kids use the default (fixed rounds: the listed rounds in order, manager's kids
--   first; otherwise the round suggested from the kid's rank).
-- * division_pool_overrides: an admin or registrar puts a player into a division's pool or takes them out, with a
--   note (any time; audited). Moving a player to another division's pool is one call (admin_move_pool).
-- * draft_leftovers: undrafted players recorded when a draft finishes (filled by step 3). They join the pool of
--   any division whose age range fits ("From Majors").
-- * private.division_pool(season_division_id): who is in a division's pool and why. Not on a team; and
--     out override here, or in override elsewhere          -> out
--     in override here                                      -> override_in
--     outside the age range                                 -> out
--     linked kid of this division's Manager or Coach        -> coach_kid (must draft)
--     a must-draft age                                      -> must_draft_age (must draft)
--     "Pool by age only" switched on                        -> by_age
--     requested this division in Sports Connect             -> requested
--     left undrafted by another division's finished draft   -> from_above
--   The requested division is read from the latest Sports Connect row linked to the registration (exact name,
--   or the name followed by a space or dash, so "Softball Majors" is not Majors).
-- * Reads: drafts_overview(season), draft_setup(season_division_id). Admins and registrars of the season
--   (registrars run the draft like admins, ratings included; decided 2026-11-19).

-- ---------- tables ----------
CREATE TABLE public.drafts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id bigint NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  season_division_id bigint NOT NULL UNIQUE REFERENCES public.season_divisions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'live', 'paused', 'done')),
  pool_by_age_only boolean NOT NULL DEFAULT false,
  must_draft_ages integer[] NOT NULL DEFAULT '{}',
  roster_size integer NOT NULL DEFAULT 12 CHECK (roster_size BETWEEN 1 AND 40),
  order_type text NOT NULL DEFAULT 'snake' CHECK (order_type IN ('snake', 'straight')),
  age_order text NOT NULL DEFAULT 'open' CHECK (age_order IN ('open', 'oldest_first')),
  coach_kid_rule text NOT NULL DEFAULT 'fixed_rounds' CHECK (coach_kid_rule IN ('fixed_rounds', 'round_per_kid', 'by_round', 'before_draft')),
  coach_kid_rounds integer[] NOT NULL DEFAULT '{1,2}',
  coach_kid_by_round integer NOT NULL DEFAULT 2 CHECK (coach_kid_by_round BETWEEN 1 AND 40),
  siblings_together boolean NOT NULL DEFAULT true,
  sibling_optional text NOT NULL DEFAULT 'ask' CHECK (sibling_optional IN ('always_take', 'ask', 'send_down')),
  pick_timer_seconds integer CHECK (pick_timer_seconds IS NULL OR pick_timer_seconds BETWEEN 15 AND 1800),
  order_source text CHECK (order_source IN ('draw', 'manual')),
  order_set_at timestamptz,
  order_set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  copied_from_draft_id bigint REFERENCES public.drafts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.draft_teams (
  draft_id bigint NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  team_id bigint NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  position integer CHECK (position IS NULL OR position >= 1),
  roster_size integer CHECK (roster_size IS NULL OR roster_size BETWEEN 1 AND 40),
  PRIMARY KEY (draft_id, team_id),
  UNIQUE (draft_id, position)
);
CREATE TABLE public.draft_kid_rounds (
  draft_id bigint NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  player_season_id bigint NOT NULL REFERENCES public.player_seasons(id) ON DELETE CASCADE,
  round integer NOT NULL CHECK (round BETWEEN 1 AND 40),
  PRIMARY KEY (draft_id, player_season_id)
);
CREATE TABLE public.division_pool_overrides (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id bigint NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  season_division_id bigint NOT NULL REFERENCES public.season_divisions(id) ON DELETE CASCADE,
  player_season_id bigint NOT NULL REFERENCES public.player_seasons(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('in', 'out')),
  note text NOT NULL CHECK (length(btrim(note)) >= 3),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_division_id, player_season_id)
);
CREATE TABLE public.draft_leftovers (
  draft_id bigint NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  player_season_id bigint NOT NULL REFERENCES public.player_seasons(id) ON DELETE CASCADE,
  PRIMARY KEY (draft_id, player_season_id)
);
ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_kid_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.division_pool_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_leftovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.drafts, public.draft_teams, public.draft_kid_rounds, public.division_pool_overrides, public.draft_leftovers
  FROM anon, authenticated;

-- ---------- helpers ----------
CREATE FUNCTION private.draft_for_edit(p_draft_id bigint) RETURNS public.drafts
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts;
BEGIN
  SELECT * INTO v FROM public.drafts WHERE id = p_draft_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found.'; END IF;
  PERFORM private.assert_team_editor(v.season_id);
  IF v.status <> 'setup' THEN RAISE EXCEPTION 'This draft has started; its setup can''t change.'; END IF;
  RETURN v;
END $$;

-- Requested division per registration, from the latest Sports Connect row linked to it.
CREATE FUNCTION private.season_requested_divisions(p_season_id bigint)
RETURNS TABLE (player_season_id bigint, source_division text, season_division_id bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  WITH latest AS (
    SELECT DISTINCT ON (ps.id) ps.id, btrim(r.source_division) AS src
    FROM public.player_seasons ps
    JOIN public.sports_connect_import_rows r ON r.committed_player_season_id = ps.id OR r.existing_player_season_id = ps.id
    WHERE ps.season_id = p_season_id AND btrim(COALESCE(r.source_division, '')) <> ''
    ORDER BY ps.id, r.id DESC
  )
  SELECT l.id, l.src,
    (SELECT sd.id FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id
     WHERE sd.season_id = p_season_id
       AND (lower(l.src) = lower(d.name) OR lower(l.src) LIKE lower(d.name) || ' %' OR lower(l.src) LIKE lower(d.name) || '-%')
     ORDER BY length(d.name) DESC LIMIT 1)
  FROM latest l;
$$;

CREATE FUNCTION private.division_pool(p_season_division_id bigint)
RETURNS TABLE (player_season_id bigint, reason text, must_draft boolean, requested text, from_division text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  WITH sd AS (
    SELECT sd.id, sd.season_id, sd.min_age, sd.max_age FROM public.season_divisions sd WHERE sd.id = p_season_division_id
  ),
  dr AS (SELECT d.* FROM public.drafts d WHERE d.season_division_id = p_season_division_id),
  must AS (
    SELECT COALESCE((SELECT must_draft_ages FROM dr), ARRAY[(SELECT max_age FROM sd)]) AS ages,
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

-- Settings copied forward from the same division's draft in the latest earlier season.
CREATE FUNCTION private.previous_draft(p_season_division_id bigint) RETURNS public.drafts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT d.* FROM public.drafts d
  JOIN public.season_divisions old ON old.id = d.season_division_id
  JOIN public.seasons os ON os.id = d.season_id
  JOIN public.season_divisions cur ON cur.id = p_season_division_id AND cur.division_id = old.division_id
  JOIN public.seasons cs ON cs.id = cur.season_id
  WHERE d.season_id <> cur.season_id AND COALESCE(os.start_date, '-infinity') < COALESCE(cs.start_date, 'infinity')
  ORDER BY os.start_date DESC NULLS LAST, d.id DESC LIMIT 1;
$$;

-- ---------- writes ----------
CREATE FUNCTION public.admin_create_draft(p_season_division_id bigint) RETURNS bigint
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
    VALUES (v_sd.season_id, p_season_division_id, CASE WHEN v_sd.max_age IS NULL THEN '{}'::integer[] ELSE ARRAY[v_sd.max_age] END, auth.uid())
    RETURNING id INTO v_id;
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (auth.uid(), 'draft_created', 'drafts', v_id::text,
          (SELECT to_jsonb(d) FROM public.drafts d WHERE d.id = v_id) || jsonb_build_object('copied_from_draft_id', v_prev.id));
  RETURN v_id;
END $$;

-- Only while in setup. Removes the draft with its order, roster sizes and kid rounds (pool overrides stay).
CREATE FUNCTION public.admin_delete_draft(p_draft_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts := private.draft_for_edit(p_draft_id);
BEGIN
  DELETE FROM public.drafts WHERE id = p_draft_id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, before_data)
  VALUES (auth.uid(), 'draft_deleted', 'drafts', p_draft_id::text, to_jsonb(v));
END $$;

-- p_settings: any of pool_by_age_only, must_draft_ages, roster_size, order_type, age_order, coach_kid_rule,
-- coach_kid_rounds, coach_kid_by_round, siblings_together, sibling_optional, pick_timer_seconds (null = off).
CREATE FUNCTION public.admin_save_draft_settings(p_draft_id bigint, p_settings jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts := private.draft_for_edit(p_draft_id);
  n public.drafts;
  v_sd public.season_divisions;
  v_ages integer[];
  v_rounds integer[];
BEGIN
  SELECT * INTO v_sd FROM public.season_divisions WHERE id = v.season_division_id;
  n := v;
  IF p_settings ? 'pool_by_age_only' THEN n.pool_by_age_only := (p_settings->>'pool_by_age_only')::boolean; END IF;
  IF p_settings ? 'must_draft_ages' THEN
    SELECT COALESCE(array_agg(DISTINCT x::integer ORDER BY x::integer), '{}') INTO v_ages FROM jsonb_array_elements_text(p_settings->'must_draft_ages') x;
    IF EXISTS (SELECT 1 FROM unnest(v_ages) a WHERE a < v_sd.min_age OR a > v_sd.max_age) THEN
      RAISE EXCEPTION 'Must-draft ages have to be within the division''s ages (% to %).', v_sd.min_age, v_sd.max_age;
    END IF;
    n.must_draft_ages := v_ages;
  END IF;
  IF p_settings ? 'roster_size' THEN n.roster_size := (p_settings->>'roster_size')::integer; END IF;
  IF p_settings ? 'order_type' THEN n.order_type := p_settings->>'order_type'; END IF;
  IF p_settings ? 'age_order' THEN n.age_order := p_settings->>'age_order'; END IF;
  IF p_settings ? 'coach_kid_rule' THEN n.coach_kid_rule := p_settings->>'coach_kid_rule'; END IF;
  IF p_settings ? 'coach_kid_rounds' THEN
    SELECT COALESCE(array_agg(DISTINCT x::integer ORDER BY x::integer), '{}') INTO v_rounds FROM jsonb_array_elements_text(p_settings->'coach_kid_rounds') x;
    IF cardinality(v_rounds) = 0 OR EXISTS (SELECT 1 FROM unnest(v_rounds) r WHERE r < 1 OR r > 40) THEN
      RAISE EXCEPTION 'List at least one round for coach''s kids (1 to 40).';
    END IF;
    n.coach_kid_rounds := v_rounds;
  END IF;
  IF p_settings ? 'coach_kid_by_round' THEN n.coach_kid_by_round := (p_settings->>'coach_kid_by_round')::integer; END IF;
  IF p_settings ? 'siblings_together' THEN n.siblings_together := (p_settings->>'siblings_together')::boolean; END IF;
  IF p_settings ? 'sibling_optional' THEN n.sibling_optional := p_settings->>'sibling_optional'; END IF;
  IF p_settings ? 'pick_timer_seconds' THEN n.pick_timer_seconds := NULLIF(p_settings->>'pick_timer_seconds', '')::integer; END IF;
  IF to_jsonb(n) = to_jsonb(v) THEN RETURN false; END IF;
  UPDATE public.drafts SET pool_by_age_only = n.pool_by_age_only, must_draft_ages = n.must_draft_ages, roster_size = n.roster_size,
    order_type = n.order_type, age_order = n.age_order, coach_kid_rule = n.coach_kid_rule, coach_kid_rounds = n.coach_kid_rounds,
    coach_kid_by_round = n.coach_kid_by_round, siblings_together = n.siblings_together, sibling_optional = n.sibling_optional,
    pick_timer_seconds = n.pick_timer_seconds, updated_at = now()
  WHERE id = p_draft_id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, before_data, after_data)
  VALUES (auth.uid(), 'draft_settings_saved', 'drafts', p_draft_id::text, to_jsonb(v), to_jsonb(n));
  RETURN true;
END $$;

-- A team's roster size for this draft (NULL = the draft's size).
CREATE FUNCTION public.admin_set_draft_roster_size(p_draft_id bigint, p_team_id bigint, p_size integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts := private.draft_for_edit(p_draft_id);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = p_team_id AND season_division_id = v.season_division_id) THEN
    RAISE EXCEPTION 'That team isn''t in this division.';
  END IF;
  INSERT INTO public.draft_teams (draft_id, team_id, roster_size) VALUES (p_draft_id, p_team_id, p_size)
  ON CONFLICT (draft_id, team_id) DO UPDATE SET roster_size = EXCLUDED.roster_size;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (auth.uid(), 'draft_roster_size_set', 'drafts', p_draft_id::text, jsonb_build_object('team_id', p_team_id, 'roster_size', p_size));
END $$;

CREATE FUNCTION private.save_draft_order(p_draft public.drafts, p_team_ids bigint[], p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_order jsonb;
BEGIN
  IF cardinality(p_team_ids) = 0 THEN RAISE EXCEPTION 'Add the division''s teams first (Teams page).'; END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_team_ids) x) <> cardinality(p_team_ids)
     OR (SELECT array_agg(id ORDER BY id) FROM public.teams WHERE season_division_id = p_draft.season_division_id)
        IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(p_team_ids) x) THEN
    RAISE EXCEPTION 'The order must list every team in the division once.';
  END IF;
  UPDATE public.draft_teams SET position = NULL WHERE draft_id = p_draft.id;
  INSERT INTO public.draft_teams (draft_id, team_id, position)
  SELECT p_draft.id, t, i FROM unnest(p_team_ids) WITH ORDINALITY AS u(t, i)
  ON CONFLICT (draft_id, team_id) DO UPDATE SET position = EXCLUDED.position;
  UPDATE public.drafts SET order_source = p_source, order_set_at = now(), order_set_by = auth.uid(), updated_at = now() WHERE id = p_draft.id;
  SELECT jsonb_agg(jsonb_build_object('position', i, 'team_id', t, 'team', (SELECT name FROM public.teams WHERE id = t)) ORDER BY i)
  INTO v_order FROM unnest(p_team_ids) WITH ORDINALITY AS u(t, i);
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (auth.uid(), CASE p_source WHEN 'draw' THEN 'draft_order_drawn' ELSE 'draft_order_set' END, 'drafts', p_draft.id::text,
          jsonb_build_object('order', v_order));
  RETURN v_order;
END $$;

-- A random draw of the first-round order (every current team of the division). Drawing again replaces it (audited).
CREATE FUNCTION public.admin_draw_draft_order(p_draft_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts := private.draft_for_edit(p_draft_id);
BEGIN
  RETURN private.save_draft_order(v,
    COALESCE((SELECT array_agg(id ORDER BY random()) FROM public.teams WHERE season_division_id = v.season_division_id), '{}'), 'draw');
END $$;

-- The order set by hand (a draw held outside the app): team ids in first-round order.
CREATE FUNCTION public.admin_set_draft_order(p_draft_id bigint, p_team_ids bigint[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts := private.draft_for_edit(p_draft_id);
BEGIN
  RETURN private.save_draft_order(v, COALESCE(p_team_ids, '{}'), 'manual');
END $$;

-- The round a coach's kid fills (NULL = back to the default).
CREATE FUNCTION public.admin_set_kid_round(p_draft_id bigint, p_player_season_id bigint, p_round integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts := private.draft_for_edit(p_draft_id);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.coach_kid_links l JOIN public.team_coach_assignments a ON a.coach_user_id = l.parent_user_id
    JOIN public.teams t ON t.id = a.team_id
    WHERE l.player_season_id = p_player_season_id AND t.season_division_id = v.season_division_id AND a.assignment_role IN ('manager', 'coach')
  ) THEN
    RAISE EXCEPTION 'That player isn''t the kid of a manager or coach in this division.';
  END IF;
  IF p_round IS NULL THEN
    DELETE FROM public.draft_kid_rounds WHERE draft_id = p_draft_id AND player_season_id = p_player_season_id;
  ELSE
    IF p_round < 1 OR p_round > 40 THEN RAISE EXCEPTION 'Choose a round from 1 to 40.'; END IF;
    INSERT INTO public.draft_kid_rounds (draft_id, player_season_id, round) VALUES (p_draft_id, p_player_season_id, p_round)
    ON CONFLICT (draft_id, player_season_id) DO UPDATE SET round = EXCLUDED.round;
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (auth.uid(), 'draft_kid_round_set', 'drafts', p_draft_id::text, jsonb_build_object('player_season_id', p_player_season_id, 'round', p_round));
END $$;

-- Put a player into a division's pool ('in'), take them out ('out'), or clear the override (NULL). Any time;
-- a note is required. Players already on a team can't be moved here (use Move player, step 4).
CREATE FUNCTION public.admin_set_pool_override(p_season_division_id bigint, p_player_season_id bigint, p_mode text, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_sd public.season_divisions;
  v_ps public.player_seasons;
  v_before jsonb;
BEGIN
  SELECT * INTO v_sd FROM public.season_divisions WHERE id = p_season_division_id;
  SELECT * INTO v_ps FROM public.player_seasons WHERE id = p_player_season_id;
  IF v_sd.id IS NULL OR v_ps.id IS NULL OR v_sd.season_id <> v_ps.season_id THEN RAISE EXCEPTION 'Player or division not found.'; END IF;
  PERFORM private.assert_team_editor(v_sd.season_id);
  IF length(btrim(COALESCE(p_note, ''))) < 3 THEN RAISE EXCEPTION 'Add a short note saying why.'; END IF;
  IF p_mode IS NOT NULL AND p_mode NOT IN ('in', 'out') THEN RAISE EXCEPTION 'Unknown change.'; END IF;
  IF v_ps.team_id IS NOT NULL THEN RAISE EXCEPTION 'This player is already on a team.'; END IF;
  SELECT to_jsonb(o) INTO v_before FROM public.division_pool_overrides o
  WHERE o.season_division_id = p_season_division_id AND o.player_season_id = p_player_season_id;
  IF p_mode IS NULL THEN
    DELETE FROM public.division_pool_overrides WHERE season_division_id = p_season_division_id AND player_season_id = p_player_season_id;
  ELSE
    INSERT INTO public.division_pool_overrides (season_id, season_division_id, player_season_id, mode, note, created_by)
    VALUES (v_sd.season_id, p_season_division_id, p_player_season_id, p_mode, btrim(p_note), auth.uid())
    ON CONFLICT (season_division_id, player_season_id)
    DO UPDATE SET mode = EXCLUDED.mode, note = EXCLUDED.note, created_by = EXCLUDED.created_by, created_at = now();
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (auth.uid(), 'draft_pool_override_set', 'player_seasons', p_player_season_id::text, btrim(p_note), v_before,
          jsonb_build_object('season_division_id', p_season_division_id, 'mode', p_mode));
END $$;

-- Move a player from one division's pool to another's (out here, in there), with one note.
CREATE FUNCTION public.admin_move_pool(p_player_season_id bigint, p_from_season_division_id bigint, p_to_season_division_id bigint, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  IF p_from_season_division_id = p_to_season_division_id THEN RAISE EXCEPTION 'Choose a different division.'; END IF;
  PERFORM public.admin_set_pool_override(p_from_season_division_id, p_player_season_id, 'out', p_note);
  PERFORM public.admin_set_pool_override(p_to_season_division_id, p_player_season_id, 'in', p_note);
END $$;

-- ---------- reads ----------
CREATE FUNCTION private.assert_draft_viewer(p_season_id bigint) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR p_season_id IS NULL OR NOT public.can_register(p_season_id) THEN
    RAISE EXCEPTION 'Only admins and registrars can set up drafts.' USING ERRCODE = '42501';
  END IF;
END $$;

-- Every division of the season with its draft (if any) and pool numbers.
CREATE FUNCTION public.drafts_overview(p_season_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  PERFORM private.assert_draft_viewer(p_season_id);
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'season_division_id', sd.id, 'name', d.name, 'min_age', sd.min_age, 'max_age', sd.max_age,
      'draft', (SELECT jsonb_build_object('id', dr.id, 'status', dr.status, 'order_set', dr.order_set_at IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.season_division_id = sd.id
                                  AND NOT EXISTS (SELECT 1 FROM public.draft_teams x WHERE x.draft_id = dr.id AND x.team_id = t.id AND x.position IS NOT NULL)),
                  'roster_size', dr.roster_size)
                FROM public.drafts dr WHERE dr.season_division_id = sd.id),
      'teams', (SELECT count(*) FROM public.teams t WHERE t.season_division_id = sd.id),
      'pool', (SELECT count(*) FROM private.division_pool(sd.id)),
      'must_draft', (SELECT count(*) FILTER (WHERE must_draft) FROM private.division_pool(sd.id))
    ) ORDER BY d.sort_order, d.name), '[]')
    FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id
    WHERE sd.season_id = p_season_id
  );
END $$;

-- Everything the draft setup page shows for one division.
CREATE FUNCTION public.draft_setup(p_season_division_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_sd public.season_divisions;
  v_name text;
  v_draft public.drafts;
  v_teams integer;
BEGIN
  SELECT * INTO v_sd FROM public.season_divisions WHERE id = p_season_division_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Division not found.'; END IF;
  PERFORM private.assert_draft_viewer(v_sd.season_id);
  SELECT d.name INTO v_name FROM public.divisions d WHERE d.id = v_sd.division_id;
  SELECT * INTO v_draft FROM public.drafts WHERE season_division_id = p_season_division_id;
  SELECT count(*) INTO v_teams FROM public.teams WHERE season_division_id = p_season_division_id;

  RETURN (
  WITH setup_pool AS (SELECT * FROM private.division_pool(p_season_division_id)),
  -- Overall ratings for ranking: the same numbers as the draft report.
  setup_ratings AS (
    SELECT s.player_season_id, s.evaluator_overall, s.coach_overall, s.prior_overall, s.coach_evaluations + s.evaluator_evaluations AS evaluations
    FROM public.evaluation_sessions es
    CROSS JOIN LATERAL private.session_player_summary(es.id, auth.uid()) s
    WHERE es.season_id = v_sd.season_id AND es.league_age IN (
      SELECT ps.league_age FROM public.player_seasons ps WHERE ps.id IN (SELECT player_season_id FROM setup_pool))
  ),
  setup_rank AS (
    SELECT p.player_season_id, row_number() OVER (ORDER BY r.evaluator_overall DESC NULLS LAST, r.coach_overall DESC NULLS LAST, p.player_season_id) AS rank
    FROM setup_pool p LEFT JOIN setup_ratings r ON r.player_season_id = p.player_season_id
  ),
  -- Players who are also in another division's pool (for example an 11-year-old who asked for Majors is also
  -- must-draft in AAA, and drops there if Majors doesn't take them).
  other_pools AS (
    SELECT op.player_season_id, array_agg(d2.name ORDER BY d2.sort_order) AS names
    FROM public.season_divisions s2 JOIN public.divisions d2 ON d2.id = s2.division_id
    CROSS JOIN LATERAL private.division_pool(s2.id) op
    WHERE s2.season_id = v_sd.season_id AND s2.id <> p_season_division_id
    GROUP BY op.player_season_id
  ),
  kid_rows AS (
    SELECT l.player_season_id, l.parent_user_id, t.id AS team_id, t.name AS team, a.assignment_role,
      row_number() OVER (PARTITION BY t.id ORDER BY CASE a.assignment_role WHEN 'manager' THEN 1 ELSE 2 END, l.player_season_id) AS kid_order
    FROM public.coach_kid_links l
    JOIN public.team_coach_assignments a ON a.coach_user_id = l.parent_user_id AND a.assignment_role IN ('manager', 'coach')
    JOIN public.teams t ON t.id = a.team_id AND t.season_division_id = p_season_division_id
    WHERE l.season_id = v_sd.season_id
  )
  SELECT jsonb_build_object(
    'division', jsonb_build_object('season_division_id', v_sd.id, 'name', v_name, 'min_age', v_sd.min_age, 'max_age', v_sd.max_age,
                                   'season_id', v_sd.season_id, 'season', (SELECT name FROM public.seasons WHERE id = v_sd.season_id),
                                   'season_closed', (SELECT is_closed FROM public.seasons WHERE id = v_sd.season_id)),
    'draft', CASE WHEN v_draft.id IS NULL THEN NULL ELSE to_jsonb(v_draft) || jsonb_build_object(
               'copied_from', (SELECT s.name FROM public.drafts p JOIN public.seasons s ON s.id = p.season_id WHERE p.id = v_draft.copied_from_draft_id)) END,
    'previous', (SELECT jsonb_build_object('season', s.name) FROM public.seasons s WHERE s.id = (private.previous_draft(p_season_division_id)).season_id),
    'teams', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('team_id', t.id, 'name', t.name, 'position', x.position, 'roster_size', x.roster_size,
        'manager', (SELECT private.person_name(a.coach_user_id) FROM public.team_coach_assignments a WHERE a.team_id = t.id AND a.assignment_role = 'manager'),
        'coach', (SELECT private.person_name(a.coach_user_id) FROM public.team_coach_assignments a WHERE a.team_id = t.id AND a.assignment_role = 'coach'))
        ORDER BY x.position NULLS LAST, t.name), '[]')
      FROM public.teams t LEFT JOIN public.draft_teams x ON x.team_id = t.id AND x.draft_id = v_draft.id
      WHERE t.season_division_id = p_season_division_id),
    'pool', (
      SELECT COALESCE(jsonb_agg(private.player_brief(p.player_season_id) || jsonb_build_object(
        'reason', p.reason, 'must_draft', p.must_draft, 'requested', p.requested, 'from_division', p.from_division,
        'evaluator_overall', r.evaluator_overall, 'coach_overall', r.coach_overall, 'prior_overall', r.prior_overall,
        'evaluations', COALESCE(r.evaluations, 0), 'rank', k.rank,
        'also_in', (SELECT to_jsonb(x.names) FROM other_pools x WHERE x.player_season_id = p.player_season_id),
        'sibling_group', (SELECT m.group_id FROM public.sibling_group_members m WHERE m.player_season_id = p.player_season_id),
        'note', (SELECT o.note FROM public.division_pool_overrides o WHERE o.season_division_id = p_season_division_id AND o.player_season_id = p.player_season_id))
        ORDER BY k.rank), '[]')
      FROM setup_pool p LEFT JOIN setup_ratings r ON r.player_season_id = p.player_season_id
      LEFT JOIN setup_rank k ON k.player_season_id = p.player_season_id),
    'kids', (
      SELECT COALESCE(jsonb_agg(private.player_brief(q.player_season_id) || jsonb_build_object(
        'team_id', q.team_id, 'team', q.team, 'parent', private.person_name(q.parent_user_id), 'parent_role', q.assignment_role,
        'in_pool', EXISTS (SELECT 1 FROM setup_pool p WHERE p.player_season_id = q.player_season_id),
        'round', (SELECT kr.round FROM public.draft_kid_rounds kr WHERE kr.draft_id = v_draft.id AND kr.player_season_id = q.player_season_id),
        'suggested_round', (SELECT CEIL(k.rank::numeric / GREATEST(v_teams, 1))::integer FROM setup_rank k WHERE k.player_season_id = q.player_season_id),
        'kid_order', q.kid_order)
        ORDER BY q.team, q.kid_order), '[]')
      FROM kid_rows q),
    'overrides', (
      SELECT COALESCE(jsonb_agg(private.player_brief(o.player_season_id) || jsonb_build_object('mode', o.mode, 'note', o.note,
        'by', private.person_name(o.created_by), 'at', o.created_at) ORDER BY o.created_at DESC), '[]')
      FROM public.division_pool_overrides o WHERE o.season_division_id = p_season_division_id),
    'ages', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('league_age', es.league_age, 'status', es.status, 'released', es.published_at IS NOT NULL)
        ORDER BY es.league_age), '[]')
      FROM public.evaluation_sessions es WHERE es.season_id = v_sd.season_id AND es.league_age BETWEEN v_sd.min_age AND v_sd.max_age),
    'other_divisions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('season_division_id', s2.id, 'name', d2.name) ORDER BY d2.sort_order), '[]')
      FROM public.season_divisions s2 JOIN public.divisions d2 ON d2.id = s2.division_id
      WHERE s2.season_id = v_sd.season_id AND s2.id <> p_season_division_id),
    'players', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('player_season_id', ps.id, 'first_name', pl.first_name, 'last_name', pl.last_name,
        'league_age', ps.league_age, 'bib', ps.evaluation_number) ORDER BY pl.last_name, pl.first_name), '[]')
      FROM public.player_seasons ps JOIN public.players pl ON pl.id = ps.player_id
      WHERE ps.season_id = v_sd.season_id AND ps.team_id IS NULL
        AND ps.id NOT IN (SELECT player_season_id FROM setup_pool))
  ));
END $$;

REVOKE ALL ON FUNCTION public.admin_create_draft(bigint), public.admin_delete_draft(bigint), public.admin_save_draft_settings(bigint, jsonb),
  public.admin_set_draft_roster_size(bigint, bigint, integer), public.admin_draw_draft_order(bigint), public.admin_set_draft_order(bigint, bigint[]),
  public.admin_set_kid_round(bigint, bigint, integer), public.admin_set_pool_override(bigint, bigint, text, text),
  public.admin_move_pool(bigint, bigint, bigint, text), public.drafts_overview(bigint), public.draft_setup(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_draft(bigint), public.admin_delete_draft(bigint), public.admin_save_draft_settings(bigint, jsonb),
  public.admin_set_draft_roster_size(bigint, bigint, integer), public.admin_draw_draft_order(bigint), public.admin_set_draft_order(bigint, bigint[]),
  public.admin_set_kid_round(bigint, bigint, integer), public.admin_set_pool_override(bigint, bigint, text, text),
  public.admin_move_pool(bigint, bigint, bigint, text), public.drafts_overview(bigint), public.draft_setup(bigint) TO authenticated;
REVOKE ALL ON FUNCTION private.draft_for_edit(bigint), private.season_requested_divisions(bigint), private.division_pool(bigint),
  private.previous_draft(bigint), private.save_draft_order(public.drafts, bigint[], text), private.assert_draft_viewer(bigint)
  FROM PUBLIC, anon, authenticated;
