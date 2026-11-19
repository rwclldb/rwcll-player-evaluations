-- The draft room (draft step 3, decided 2026-11-19; docs/DRAFT-SPEC.md section 3).
--
-- * Slots: private.draft_slots(draft) lists every pick in order: rounds 1..(largest roster), teams by first-round
--   position, reversed on even rounds for a snake draft; a team with a smaller roster drops out of later rounds.
-- * Start (admin_start_draft): needs the order for every team and every age group in the division's range
--   released to coaches. It freezes each coach's kid's team and round (draft_kid_rounds.team_id; missing rounds
--   get the default: fixed rounds in order with the manager's kid first, otherwise the round from the kid's rank),
--   places "placed before the draft" kids in their team's slot of that round (open drafts), and goes live.
-- * A pick (admin_draft_pick, admins and registrars) puts the player on the team at once (player_seasons.team_id and
--   season_division_id), so they leave every pool. It is refused when the player isn't in the pool, is another
--   team's coach's kid, or a sibling decision is waiting. Two rules need a note to override:
--     open draft:   on a pick marked "must draft" (the last N open picks, N = must-draft players still available
--                   who aren't another team's reserved kid), only must-draft players;
--     oldest first: only the oldest age still available (reserved kids don't count).
-- * Automatic picks (private.draft_advance, after start, every pick and every decision), at the team's turn:
--     coach's kid due: fixed rounds / round per kid / placed before: the kid's round has come (oldest first: counted
--       from the round the kid's age opened); picked by a round: that round has come and the kid is still there;
--     a queued sibling.
-- * Siblings ("Siblings play together"): when a player is placed, each sibling in the same group who is still in
--   this pool is queued for the team's next pick if they must be drafted or the rule is "always take"; "always send
--   down" takes them out of this pool (noted override) and lists them as left over; "ask at the pick" waits for
--   admin_draft_sibling_decision (take or send down) before the next pick.
-- * No undo. Pause and resume (admin_pause_draft). Finish (admin_finish_draft) records everyone still in the pool
--   as left over (draft_leftovers), so they join the next division's pool when their age fits.
-- * The clock: drafts.clock_started_at is reset whenever the next pick comes up; the screen counts down
--   pick_timer_seconds from it. Nothing is picked automatically when it runs out.
-- * Who can watch (private.can_watch_draft): admins and registrars of the season, and the Manager and Coach of a
--   team in the division. Reads: draft_board(draft) (light, polled every few seconds) and draft_players(draft)
--   (ratings: evaluator, coach, coach with high/low dropped, prior year, the viewer's own scores, their stars and
--   private notes; same privacy as the draft report). my_drafts() lists the drafts a person can watch.

ALTER TABLE public.drafts
  ADD COLUMN started_at timestamptz,
  ADD COLUMN finished_at timestamptz,
  ADD COLUMN clock_started_at timestamptz;
ALTER TABLE public.draft_kid_rounds ADD COLUMN team_id bigint REFERENCES public.teams(id) ON DELETE CASCADE;
-- "Picked by a round" kids are reserved for their team with no round.
ALTER TABLE public.draft_kid_rounds ALTER COLUMN round DROP NOT NULL;

CREATE TABLE public.draft_picks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draft_id bigint NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  overall integer NOT NULL CHECK (overall >= 1),
  round integer NOT NULL,
  team_id bigint NOT NULL REFERENCES public.teams(id) ON DELETE RESTRICT,
  player_season_id bigint NOT NULL REFERENCES public.player_seasons(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('pick', 'coach_kid', 'sibling')),
  override_note text,
  made_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  made_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, overall),
  UNIQUE (draft_id, player_season_id)
);
CREATE TABLE public.draft_sibling_queue (
  draft_id bigint NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  player_season_id bigint NOT NULL REFERENCES public.player_seasons(id) ON DELETE CASCADE,
  team_id bigint NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  because_of bigint REFERENCES public.player_seasons(id) ON DELETE SET NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, player_season_id)
);
CREATE TABLE public.draft_sibling_asks (
  draft_id bigint NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  player_season_id bigint NOT NULL REFERENCES public.player_seasons(id) ON DELETE CASCADE,
  team_id bigint NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  because_of bigint REFERENCES public.player_seasons(id) ON DELETE SET NULL,
  asked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, player_season_id)
);
CREATE TABLE public.draft_tiers (
  draft_id bigint NOT NULL REFERENCES public.drafts(id) ON DELETE CASCADE,
  league_age integer NOT NULL,
  start_round integer NOT NULL,
  PRIMARY KEY (draft_id, league_age)
);
ALTER TABLE public.draft_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_sibling_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_sibling_asks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_tiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.draft_picks, public.draft_sibling_queue, public.draft_sibling_asks, public.draft_tiers FROM anon, authenticated;

-- A team in a started draft can't be deleted or have its staff list emptied by the Teams page.
CREATE FUNCTION private.team_in_started_draft(p_team_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.draft_teams x JOIN public.drafts d ON d.id = x.draft_id WHERE x.team_id = p_team_id AND d.status <> 'setup');
$$;
CREATE FUNCTION private.block_team_delete_in_draft() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  IF private.team_in_started_draft(OLD.id) THEN RAISE EXCEPTION 'This team is in a draft that has started.'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER teams_block_delete_in_draft BEFORE DELETE ON public.teams FOR EACH ROW EXECUTE FUNCTION private.block_team_delete_in_draft();

-- ---------- slots, pool and kids ----------
CREATE FUNCTION private.draft_slots(p_draft_id bigint)
RETURNS TABLE (overall integer, round integer, pick_in_round integer, team_id bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  WITH d AS (SELECT * FROM public.drafts WHERE id = p_draft_id),
  t AS (
    SELECT x.team_id, x.position, COALESCE(x.roster_size, d.roster_size) AS size
    FROM public.draft_teams x CROSS JOIN d WHERE x.draft_id = p_draft_id AND x.position IS NOT NULL
  ),
  r AS (SELECT generate_series(1, COALESCE((SELECT max(size) FROM t), 0)) AS round),
  s AS (
    SELECT r.round, t.team_id,
      CASE WHEN (SELECT order_type FROM d) = 'snake' AND r.round % 2 = 0 THEN -t.position ELSE t.position END AS k
    FROM r JOIN t ON t.size >= r.round
  )
  SELECT (row_number() OVER (ORDER BY s.round, s.k))::integer, s.round,
         (row_number() OVER (PARTITION BY s.round ORDER BY s.k))::integer, s.team_id
  FROM s;
$$;

-- Who is still available: the division's pool (players on a team are never in a pool).
CREATE FUNCTION private.draft_available(p_draft_id bigint)
RETURNS TABLE (player_season_id bigint, league_age integer, must_draft boolean, kid_team_id bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT p.player_season_id, ps.league_age, p.must_draft,
    (SELECT k.team_id FROM public.draft_kid_rounds k WHERE k.draft_id = p_draft_id AND k.player_season_id = p.player_season_id)
  FROM public.drafts d
  CROSS JOIN LATERAL private.division_pool(d.season_division_id) p
  JOIN public.player_seasons ps ON ps.id = p.player_season_id
  WHERE d.id = p_draft_id;
$$;

CREATE FUNCTION private.draft_next_slot(p_draft_id bigint)
RETURNS TABLE (overall integer, round integer, pick_in_round integer, team_id bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT s.* FROM private.draft_slots(p_draft_id) s
  WHERE NOT EXISTS (SELECT 1 FROM public.draft_picks p WHERE p.draft_id = p_draft_id AND p.overall = s.overall)
  ORDER BY s.overall LIMIT 1;
$$;

-- The oldest age still open in an oldest-first draft (reserved coach's kids don't hold an age open).
CREATE FUNCTION private.draft_tier_age(p_draft_id bigint) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT max(a.league_age) FROM private.draft_available(p_draft_id) a WHERE a.kid_team_id IS NULL;
$$;

-- Slots marked "must draft" in an open draft: the last N of the picks that will still be made, leaving out each
-- reserved kid's slot and each queued sibling's slot, where N = must-draft players available who aren't reserved kids.
CREATE FUNCTION private.draft_marked_slots(p_draft_id bigint) RETURNS integer[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts;
  v_avail integer;
  v_must integer;
  v_open integer[];
BEGIN
  SELECT * INTO v FROM public.drafts WHERE id = p_draft_id;
  IF v.age_order <> 'open' THEN RETURN '{}'; END IF;
  SELECT count(*), count(*) FILTER (WHERE must_draft AND kid_team_id IS NULL) INTO v_avail, v_must FROM private.draft_available(p_draft_id);
  IF v_must = 0 THEN RETURN '{}'; END IF;
  WITH remaining AS (
    SELECT s.* FROM private.draft_slots(p_draft_id) s
    WHERE NOT EXISTS (SELECT 1 FROM public.draft_picks p WHERE p.draft_id = p_draft_id AND p.overall = s.overall)
    ORDER BY s.overall LIMIT v_avail
  ),
  kid_slots AS (
    -- Each reserved kid takes their team's first remaining slot in or after their round.
    SELECT (SELECT min(r.overall) FROM remaining r WHERE r.team_id = k.team_id AND r.round >= COALESCE(k.round, 1)) AS overall
    FROM public.draft_kid_rounds k
    JOIN private.draft_available(p_draft_id) a ON a.player_season_id = k.player_season_id
    WHERE k.draft_id = p_draft_id AND v.coach_kid_rule <> 'by_round'
  ),
  -- A queued sibling takes their team's next free slot (after any kid's slot).
  sibling_slots AS (
    SELECT (SELECT min(r.overall) FROM remaining r WHERE r.team_id = q.team_id
              AND r.overall NOT IN (SELECT overall FROM kid_slots WHERE overall IS NOT NULL)) AS overall
    FROM public.draft_sibling_queue q WHERE q.draft_id = p_draft_id
  ),
  open_slots AS (
    SELECT r.overall FROM remaining r
    WHERE r.overall NOT IN (SELECT overall FROM kid_slots WHERE overall IS NOT NULL)
      AND r.overall NOT IN (SELECT overall FROM sibling_slots WHERE overall IS NOT NULL)
  )
  SELECT array_agg(overall ORDER BY overall) INTO v_open
  FROM (SELECT overall FROM open_slots ORDER BY overall DESC LIMIT v_must) x;
  RETURN COALESCE(v_open, '{}');
END $$;

-- ---------- placing a player ----------
CREATE FUNCTION private.draft_place(p_draft public.drafts, p_overall integer, p_round integer, p_team_id bigint,
  p_player_season_id bigint, p_kind text, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_sib record;
  v_group bigint;
BEGIN
  INSERT INTO public.draft_picks (draft_id, overall, round, team_id, player_season_id, kind, override_note, made_by)
  VALUES (p_draft.id, p_overall, p_round, p_team_id, p_player_season_id, p_kind, NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid());
  UPDATE public.player_seasons SET team_id = p_team_id, season_division_id = p_draft.season_division_id WHERE id = p_player_season_id;
  DELETE FROM public.draft_sibling_queue WHERE draft_id = p_draft.id AND player_season_id = p_player_season_id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, after_data)
  VALUES (auth.uid(), 'draft_pick', 'player_seasons', p_player_season_id::text, NULLIF(btrim(COALESCE(p_note, '')), ''),
          jsonb_build_object('draft_id', p_draft.id, 'overall', p_overall, 'round', p_round, 'team_id', p_team_id, 'kind', p_kind));

  IF p_draft.siblings_together THEN
    SELECT group_id INTO v_group FROM public.sibling_group_members WHERE player_season_id = p_player_season_id;
    FOR v_sib IN
      SELECT a.player_season_id, a.must_draft, a.kid_team_id
      FROM public.sibling_group_members m JOIN private.draft_available(p_draft.id) a ON a.player_season_id = m.player_season_id
      WHERE m.group_id = v_group AND m.player_season_id <> p_player_season_id
        AND NOT EXISTS (SELECT 1 FROM public.draft_sibling_queue q WHERE q.draft_id = p_draft.id AND q.player_season_id = m.player_season_id)
        AND NOT EXISTS (SELECT 1 FROM public.draft_sibling_asks q WHERE q.draft_id = p_draft.id AND q.player_season_id = m.player_season_id)
    LOOP
      CONTINUE WHEN v_sib.kid_team_id IS NOT NULL;  -- a reserved coach's kid goes to their parent's team anyway
      IF v_sib.must_draft OR p_draft.sibling_optional = 'always_take' THEN
        INSERT INTO public.draft_sibling_queue (draft_id, player_season_id, team_id, because_of) VALUES (p_draft.id, v_sib.player_season_id, p_team_id, p_player_season_id);
      ELSIF p_draft.sibling_optional = 'send_down' THEN
        PERFORM private.draft_send_down(p_draft, v_sib.player_season_id, 'Sibling rule: sent down');
      ELSE
        INSERT INTO public.draft_sibling_asks (draft_id, player_season_id, team_id, because_of) VALUES (p_draft.id, v_sib.player_season_id, p_team_id, p_player_season_id);
      END IF;
    END LOOP;
  END IF;
  UPDATE public.drafts SET clock_started_at = now(), updated_at = now() WHERE id = p_draft.id;
END $$;

-- Out of this pool (noted override) and on the left-over list, so they join the next division's pool.
CREATE FUNCTION private.draft_send_down(p_draft public.drafts, p_player_season_id bigint, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  INSERT INTO public.division_pool_overrides (season_id, season_division_id, player_season_id, mode, note, created_by)
  VALUES (p_draft.season_id, p_draft.season_division_id, p_player_season_id, 'out', p_note, auth.uid())
  ON CONFLICT (season_division_id, player_season_id) DO UPDATE SET mode = 'out', note = EXCLUDED.note, created_by = EXCLUDED.created_by, created_at = now();
  INSERT INTO public.draft_leftovers (draft_id, player_season_id) VALUES (p_draft.id, p_player_season_id) ON CONFLICT DO NOTHING;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, after_data)
  VALUES (auth.uid(), 'draft_sent_down', 'player_seasons', p_player_season_id::text, p_note, jsonb_build_object('draft_id', p_draft.id));
END $$;

-- Make every automatic pick that is due, in order, until a pick needs a person (or a sibling decision waits).
CREATE FUNCTION private.draft_advance(p_draft_id bigint) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts;
  v_slot record;
  v_tier integer;
  v_player bigint;
  v_kind text;
  v_made integer := 0;
BEGIN
  LOOP
    SELECT * INTO v FROM public.drafts WHERE id = p_draft_id;
    EXIT WHEN v.status <> 'live';
    EXIT WHEN EXISTS (SELECT 1 FROM public.draft_sibling_asks WHERE draft_id = p_draft_id);
    SELECT * INTO v_slot FROM private.draft_next_slot(p_draft_id);
    EXIT WHEN v_slot.overall IS NULL;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM private.draft_available(p_draft_id));
    IF v.age_order = 'oldest_first' THEN
      v_tier := private.draft_tier_age(p_draft_id);
      IF v_tier IS NOT NULL THEN
        INSERT INTO public.draft_tiers (draft_id, league_age, start_round) VALUES (p_draft_id, v_tier, v_slot.round) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    v_player := NULL;
    -- A coach's kid whose turn has come.
    SELECT a.player_season_id INTO v_player
    FROM private.draft_available(p_draft_id) a
    JOIN public.draft_kid_rounds k ON k.draft_id = p_draft_id AND k.player_season_id = a.player_season_id
    LEFT JOIN public.draft_tiers t ON t.draft_id = p_draft_id AND t.league_age = a.league_age
    WHERE k.team_id = v_slot.team_id
      AND CASE
        WHEN v.coach_kid_rule = 'by_round' THEN v_slot.round >= v.coach_kid_by_round
        WHEN k.round IS NULL THEN false
        WHEN v.age_order = 'oldest_first' THEN
          CASE WHEN t.start_round IS NOT NULL THEN v_slot.round >= t.start_round + k.round - 1
               ELSE a.league_age > COALESCE(v_tier, -1) AND v_slot.round >= k.round END
        ELSE v_slot.round >= k.round
      END
    ORDER BY k.round NULLS LAST, a.player_season_id LIMIT 1;
    v_kind := 'coach_kid';
    IF v_player IS NULL THEN
      SELECT q.player_season_id INTO v_player FROM public.draft_sibling_queue q
      JOIN private.draft_available(p_draft_id) a ON a.player_season_id = q.player_season_id
      WHERE q.draft_id = p_draft_id AND q.team_id = v_slot.team_id ORDER BY q.queued_at LIMIT 1;
      v_kind := 'sibling';
    END IF;
    EXIT WHEN v_player IS NULL;
    PERFORM private.draft_place(v, v_slot.overall, v_slot.round, v_slot.team_id, v_player, v_kind, NULL);
    v_made := v_made + 1;
  END LOOP;
  RETURN v_made;
END $$;

-- ---------- actions ----------
CREATE FUNCTION private.draft_for_run(p_draft_id bigint) RETURNS public.drafts
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts;
BEGIN
  SELECT * INTO v FROM public.drafts WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found.'; END IF;
  PERFORM private.assert_team_editor(v.season_id);
  RETURN v;
END $$;

CREATE FUNCTION public.admin_start_draft(p_draft_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts := private.draft_for_run(p_draft_id);
  v_sd public.season_divisions;
  v_teams integer;
  v_unreleased text;
  v_kid record;
  v_slot record;
BEGIN
  IF v.status <> 'setup' THEN RAISE EXCEPTION 'This draft has already started.'; END IF;
  SELECT * INTO v_sd FROM public.season_divisions WHERE id = v.season_division_id;
  SELECT count(*) INTO v_teams FROM public.teams WHERE season_division_id = v.season_division_id;
  IF v_teams = 0 THEN RAISE EXCEPTION 'Add the division''s teams first.'; END IF;
  IF EXISTS (SELECT 1 FROM public.teams t WHERE t.season_division_id = v.season_division_id
             AND NOT EXISTS (SELECT 1 FROM public.draft_teams x WHERE x.draft_id = v.id AND x.team_id = t.id AND x.position IS NOT NULL)) THEN
    RAISE EXCEPTION 'Set the first-round order for every team first.';
  END IF;
  SELECT string_agg(es.league_age::text, ', ' ORDER BY es.league_age) INTO v_unreleased FROM public.evaluation_sessions es
  WHERE es.season_id = v.season_id AND es.league_age BETWEEN v_sd.min_age AND v_sd.max_age AND es.published_at IS NULL;
  IF v_unreleased IS NOT NULL THEN
    RAISE EXCEPTION 'Release age group(s) % to coaches first (Sessions).', v_unreleased;
  END IF;

  -- Freeze each coach's kid's team and round.
  WITH sums AS (
    SELECT x.player_season_id, x.evaluator_overall, x.coach_overall FROM public.evaluation_sessions es
    CROSS JOIN LATERAL private.session_player_summary(es.id, NULL) x WHERE es.season_id = v.season_id
  ),
  ranked AS (
    SELECT p.player_season_id, row_number() OVER (ORDER BY s.evaluator_overall DESC NULLS LAST, s.coach_overall DESC NULLS LAST, p.player_season_id) AS rank
    FROM private.division_pool(v.season_division_id) p LEFT JOIN sums s ON s.player_season_id = p.player_season_id
  ),
  kids AS (
    SELECT l.player_season_id, t.id AS team_id,
      row_number() OVER (PARTITION BY t.id ORDER BY CASE a.assignment_role WHEN 'manager' THEN 1 ELSE 2 END, l.player_season_id) AS kid_order
    FROM public.coach_kid_links l
    JOIN public.team_coach_assignments a ON a.coach_user_id = l.parent_user_id AND a.assignment_role IN ('manager', 'coach')
    JOIN public.teams t ON t.id = a.team_id AND t.season_division_id = v.season_division_id
    WHERE l.player_season_id IN (SELECT player_season_id FROM ranked)
  ),
  one_team AS (SELECT DISTINCT ON (player_season_id) * FROM kids ORDER BY player_season_id, kid_order)
  INSERT INTO public.draft_kid_rounds (draft_id, player_season_id, round, team_id)
  SELECT v.id, k.player_season_id,
    CASE WHEN v.coach_kid_rule = 'by_round' THEN NULL ELSE
      -- A round set by hand, else the rule's default; a kid beyond the listed fixed rounds gets 40 (never automatic:
      -- the team picks them, and nobody else can).
      COALESCE((SELECT kr.round FROM public.draft_kid_rounds kr WHERE kr.draft_id = v.id AND kr.player_season_id = k.player_season_id),
        CASE WHEN v.coach_kid_rule = 'fixed_rounds' THEN v.coach_kid_rounds[k.kid_order]
             ELSE LEAST(40, CEIL((SELECT r.rank FROM ranked r WHERE r.player_season_id = k.player_season_id)::numeric / v_teams)::integer) END, 40) END,
    k.team_id
  FROM one_team k
  ON CONFLICT (draft_id, player_season_id) DO UPDATE SET round = EXCLUDED.round, team_id = EXCLUDED.team_id;

  UPDATE public.drafts SET status = 'live', started_at = now(), clock_started_at = now(), updated_at = now() WHERE id = v.id;
  SELECT * INTO v FROM public.drafts WHERE id = v.id;

  -- Placed before the draft (open drafts): each kid fills their team's slot in their round now.
  IF v.coach_kid_rule = 'before_draft' AND v.age_order = 'open' THEN
    FOR v_kid IN SELECT k.* FROM public.draft_kid_rounds k WHERE k.draft_id = v.id ORDER BY k.round, k.player_season_id LOOP
      SELECT s.* INTO v_slot FROM private.draft_slots(v.id) s
      WHERE s.team_id = v_kid.team_id AND s.round >= v_kid.round
        AND NOT EXISTS (SELECT 1 FROM public.draft_picks p WHERE p.draft_id = v.id AND p.overall = s.overall)
      ORDER BY s.overall LIMIT 1;
      IF v_slot.overall IS NOT NULL THEN
        PERFORM private.draft_place(v, v_slot.overall, v_slot.round, v_slot.team_id, v_kid.player_season_id, 'coach_kid', NULL);
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (auth.uid(), 'draft_started', 'drafts', v.id::text,
          jsonb_build_object('kids', (SELECT jsonb_agg(to_jsonb(k)) FROM public.draft_kid_rounds k WHERE k.draft_id = v.id)));
  PERFORM private.draft_advance(v.id);
END $$;

-- An admin or registrar makes the pick for the team on the clock. p_note overrides the must-draft or oldest-first rule.
CREATE FUNCTION public.admin_draft_pick(p_draft_id bigint, p_player_season_id bigint, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts := private.draft_for_run(p_draft_id);
  v_slot record;
  v_player record;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_tier integer;
  v_kind text := 'pick';
  v_auto integer;
BEGIN
  IF v.status = 'paused' THEN RAISE EXCEPTION 'The draft is paused.'; END IF;
  IF v.status <> 'live' THEN RAISE EXCEPTION 'The draft isn''t running.'; END IF;
  IF EXISTS (SELECT 1 FROM public.draft_sibling_asks WHERE draft_id = v.id) THEN
    RAISE EXCEPTION 'Decide about the waiting sibling first.';
  END IF;
  SELECT * INTO v_slot FROM private.draft_next_slot(v.id);
  IF v_slot.overall IS NULL THEN RAISE EXCEPTION 'Every pick has been made.'; END IF;
  SELECT * INTO v_player FROM private.draft_available(v.id) a WHERE a.player_season_id = p_player_season_id;
  IF v_player.player_season_id IS NULL THEN RAISE EXCEPTION 'That player isn''t available in this draft.'; END IF;
  IF v_player.kid_team_id IS NOT NULL AND v_player.kid_team_id <> v_slot.team_id THEN
    RAISE EXCEPTION 'That player is the coach''s kid of %; only that team can take them.', (SELECT name FROM public.teams WHERE id = v_player.kid_team_id);
  END IF;
  IF v_player.kid_team_id = v_slot.team_id THEN v_kind := 'coach_kid'; END IF;
  IF v_kind = 'pick' AND v.age_order = 'open' AND v_slot.overall = ANY (private.draft_marked_slots(v.id)) AND NOT v_player.must_draft THEN
    IF v_note IS NULL THEN RAISE EXCEPTION 'Only must-draft players can be picked now. Add a note to override.'; END IF;
  ELSIF v_kind = 'pick' AND v.age_order = 'oldest_first' AND v_player.league_age IS DISTINCT FROM private.draft_tier_age(v.id) THEN
    v_tier := private.draft_tier_age(v.id);
    IF v_note IS NULL THEN RAISE EXCEPTION 'This draft takes the %-year-olds first. Add a note to override.', v_tier; END IF;
  ELSE
    v_note := NULL;  -- no rule was overridden
  END IF;
  PERFORM private.draft_place(v, v_slot.overall, v_slot.round, v_slot.team_id, p_player_season_id, v_kind, v_note);
  v_auto := private.draft_advance(v.id);
  RETURN jsonb_build_object('overall', v_slot.overall, 'team_id', v_slot.team_id, 'automatic_picks', v_auto);
END $$;

-- Ask-at-the-pick sibling: take them with the team's next pick, or send them down.
CREATE FUNCTION public.admin_draft_sibling_decision(p_draft_id bigint, p_player_season_id bigint, p_take boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts := private.draft_for_run(p_draft_id);
  v_ask public.draft_sibling_asks;
BEGIN
  SELECT * INTO v_ask FROM public.draft_sibling_asks WHERE draft_id = v.id AND player_season_id = p_player_season_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No decision is waiting for that player.'; END IF;
  DELETE FROM public.draft_sibling_asks WHERE draft_id = v.id AND player_season_id = p_player_season_id;
  IF p_take THEN
    INSERT INTO public.draft_sibling_queue (draft_id, player_season_id, team_id, because_of) VALUES (v.id, p_player_season_id, v_ask.team_id, v_ask.because_of)
    ON CONFLICT DO NOTHING;
  ELSE
    PERFORM private.draft_send_down(v, p_player_season_id, 'Sibling rule: sent down at the pick');
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (auth.uid(), 'draft_sibling_decision', 'player_seasons', p_player_season_id::text,
          jsonb_build_object('draft_id', v.id, 'take', p_take, 'team_id', v_ask.team_id));
  UPDATE public.drafts SET updated_at = now() WHERE id = v.id;
  PERFORM private.draft_advance(v.id);
END $$;

CREATE FUNCTION public.admin_pause_draft(p_draft_id bigint, p_pause boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts := private.draft_for_run(p_draft_id);
BEGIN
  IF v.status NOT IN ('live', 'paused') THEN RAISE EXCEPTION 'The draft isn''t running.'; END IF;
  UPDATE public.drafts SET status = CASE WHEN p_pause THEN 'paused' ELSE 'live' END,
    clock_started_at = CASE WHEN p_pause THEN clock_started_at ELSE now() END, updated_at = now() WHERE id = v.id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id)
  VALUES (auth.uid(), CASE WHEN p_pause THEN 'draft_paused' ELSE 'draft_resumed' END, 'drafts', v.id::text);
  IF NOT p_pause THEN PERFORM private.draft_advance(v.id); END IF;
END $$;

-- Finish: everyone still in the pool is recorded as left over for the next division.
CREATE FUNCTION public.admin_finish_draft(p_draft_id bigint) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts := private.draft_for_run(p_draft_id);
  v_n integer;
BEGIN
  IF v.status NOT IN ('live', 'paused') THEN RAISE EXCEPTION 'The draft isn''t running.'; END IF;
  IF EXISTS (SELECT 1 FROM public.draft_sibling_asks WHERE draft_id = v.id) THEN RAISE EXCEPTION 'Decide about the waiting sibling first.'; END IF;
  INSERT INTO public.draft_leftovers (draft_id, player_season_id)
  SELECT v.id, a.player_season_id FROM private.draft_available(v.id) a ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.drafts SET status = 'done', finished_at = now(), updated_at = now() WHERE id = v.id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (auth.uid(), 'draft_finished', 'drafts', v.id::text,
          jsonb_build_object('picks', (SELECT count(*) FROM public.draft_picks WHERE draft_id = v.id), 'left_over', v_n));
  RETURN v_n;
END $$;

-- ---------- reads ----------
CREATE FUNCTION private.can_watch_draft(p_draft_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.drafts d WHERE d.id = p_draft_id AND (
      public.can_register(d.season_id)
      OR EXISTS (SELECT 1 FROM public.team_coach_assignments a JOIN public.teams t ON t.id = a.team_id
                 WHERE t.season_division_id = d.season_division_id AND a.coach_user_id = auth.uid() AND a.assignment_role IN ('manager', 'coach'))));
$$;

-- The board: everything that changes during the draft, small enough to poll every few seconds.
CREATE FUNCTION public.draft_board(p_draft_id bigint) RETURNS jsonb
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
                  'override_note', CASE WHEN v_runs THEN p.override_note END) END)
              ORDER BY s.overall), '[]')
              FROM private.draft_slots(v.id) s LEFT JOIN public.draft_picks p ON p.draft_id = v.id AND p.overall = s.overall),
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

-- The players: ratings and the viewer's own stars, notes and scores. Loaded once (and after pool changes).
CREATE FUNCTION public.draft_players(p_draft_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v public.drafts;
BEGIN
  IF NOT private.can_watch_draft(p_draft_id) THEN
    RAISE EXCEPTION 'Only this division''s managers and coaches, admins and registrars can watch this draft.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.drafts WHERE id = p_draft_id;
  RETURN (
    WITH ids AS (
      SELECT p.player_season_id, p.reason, p.must_draft, p.requested FROM private.division_pool(v.season_division_id) p
      UNION
      SELECT dp.player_season_id, 'picked', false, NULL FROM public.draft_picks dp WHERE dp.draft_id = v.id
    ),
    one AS (SELECT DISTINCT ON (player_season_id) * FROM ids ORDER BY player_season_id, (reason = 'picked')),
    -- One summary per age group (not per player).
    sums AS (
      SELECT x.* FROM public.evaluation_sessions es CROSS JOIN LATERAL private.session_player_summary(es.id, auth.uid()) x
      WHERE es.season_id = v.season_id AND es.league_age IN (SELECT ps.league_age FROM public.player_seasons ps WHERE ps.id IN (SELECT player_season_id FROM one))
    )
    SELECT COALESCE(jsonb_agg(private.player_brief(o.player_season_id) || jsonb_build_object(
      'reason', o.reason, 'must_draft', o.must_draft, 'requested', o.requested,
      'evaluator_overall', s.evaluator_overall, 'coach_overall', s.coach_overall,
      'coach_trimmed_overall', (s.skill_averages->>'coach_trimmed_overall')::numeric, 'prior_overall', s.prior_overall,
      'evaluations', COALESCE(s.coach_evaluations + s.evaluator_evaluations, 0),
      'my_overall', (SELECT round(avg(r.value::numeric), 4) FROM jsonb_each_text(s.my_evaluation->'ratings') r
                     WHERE s.my_evaluation->>'status' = 'submitted' AND r.key IN ('hitting', 'throwing', 'grounders', 'fly_balls', 'running_awareness')),
      'sibling_group', (SELECT m.group_id FROM public.sibling_group_members m WHERE m.player_season_id = o.player_season_id),
      'starred', EXISTS (SELECT 1 FROM public.player_stars st WHERE st.user_id = auth.uid() AND st.player_season_id = o.player_season_id),
      'my_note', (SELECT n.note_text FROM public.private_notes n WHERE n.author_user_id = auth.uid() AND n.player_season_id = o.player_season_id))
      ORDER BY s.evaluator_overall DESC NULLS LAST), '[]')
    FROM one o
    JOIN public.player_seasons ps ON ps.id = o.player_season_id
    LEFT JOIN sums s ON s.player_season_id = o.player_season_id
  );
END $$;

-- The drafts this person can watch (home page card).
CREATE FUNCTION public.my_drafts() RETURNS TABLE (draft_id bigint, season_division_id bigint, division text, season text, status text, started_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT d.id, d.season_division_id, dv.name, s.name, d.status, d.started_at
  FROM public.drafts d
  JOIN public.seasons s ON s.id = d.season_id AND NOT s.is_closed
  JOIN public.season_divisions sd ON sd.id = d.season_division_id JOIN public.divisions dv ON dv.id = sd.division_id
  WHERE private.can_watch_draft(d.id)
  ORDER BY dv.sort_order DESC;
$$;

-- draft_setup and drafts_overview: add the draft's status timestamps (unchanged otherwise; they read to_jsonb(drafts)).

REVOKE ALL ON FUNCTION public.admin_start_draft(bigint), public.admin_draft_pick(bigint, bigint, text),
  public.admin_draft_sibling_decision(bigint, bigint, boolean), public.admin_pause_draft(bigint, boolean), public.admin_finish_draft(bigint),
  public.draft_board(bigint), public.draft_players(bigint), public.my_drafts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_start_draft(bigint), public.admin_draft_pick(bigint, bigint, text),
  public.admin_draft_sibling_decision(bigint, bigint, boolean), public.admin_pause_draft(bigint, boolean), public.admin_finish_draft(bigint),
  public.draft_board(bigint), public.draft_players(bigint), public.my_drafts() TO authenticated;
REVOKE ALL ON FUNCTION private.team_in_started_draft(bigint), private.draft_slots(bigint), private.draft_available(bigint),
  private.draft_next_slot(bigint), private.draft_tier_age(bigint), private.draft_marked_slots(bigint),
  private.draft_place(public.drafts, integer, integer, bigint, bigint, text, text), private.draft_send_down(public.drafts, bigint, text),
  private.draft_advance(bigint), private.draft_for_run(bigint), private.can_watch_draft(bigint) FROM PUBLIC, anon, authenticated;
