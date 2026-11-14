-- Exemptions: an explicit decision that a player doesn't have to attend evaluations, doesn't have to be evaluated,
-- or both. Never inferred from an absence or an injury (injured players still attend).
--
-- * One active exemption per registration (player_exemptions). It records the scope, a reason, an optional
--   "approved by" name (when someone other than the recorder decided, e.g. the league president), who recorded it
--   and when. Replacing or removing one keeps the old row (revoked_at/revoked_by/revoke_reason). All audited.
-- * Admins and registrars for the season record and remove them (set_player_exemption, revoke_player_exemption)
--   and see the details (registration_exemption).
-- * Everyone who can see the age group sees only that the player is exempt and the scope (session_exemptions):
--   coaches and evaluators on the scoring screen and the released draft report, registrars on check-in.
-- * Effects: check-in shows the scope; players exempt from attendance aren't on makeup-day lists (checkin_list).
--   Scoring Progress leaves players exempt from evaluation out of the "of N players" count.

CREATE TABLE public.player_exemptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_season_id bigint NOT NULL REFERENCES public.player_seasons(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('attendance', 'evaluation', 'both')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 1000),
  approved_by_name text CHECK (approved_by_name IS NULL OR char_length(approved_by_name) <= 200),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text
);
CREATE UNIQUE INDEX player_exemptions_one_active ON public.player_exemptions (player_season_id) WHERE revoked_at IS NULL;
ALTER TABLE public.player_exemptions ENABLE ROW LEVEL SECURITY;
-- Reads and writes only through the functions below.

-- Record (or replace) a player's exemption.
CREATE FUNCTION public.set_player_exemption(p_player_season_id bigint, p_scope text, p_reason text, p_approved_by_name text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_reg record;
  v_old record;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_approver text := NULLIF(btrim(COALESCE(p_approved_by_name, '')), '');
BEGIN
  SELECT ps.id, ps.season_id, s.is_closed INTO v_reg
  FROM public.player_seasons ps JOIN public.seasons s ON s.id = ps.season_id WHERE ps.id = p_player_season_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Player registration not found.'; END IF;
  IF v_actor IS NULL OR NOT public.can_register(v_reg.season_id) THEN
    RAISE EXCEPTION 'Only league admins and registrars record exemptions.' USING ERRCODE = '42501';
  END IF;
  IF v_reg.is_closed THEN RAISE EXCEPTION 'This season is closed.'; END IF;
  IF p_scope NOT IN ('attendance', 'evaluation', 'both') THEN RAISE EXCEPTION 'Choose what the exemption covers.'; END IF;
  IF char_length(v_reason) < 5 THEN RAISE EXCEPTION 'Give a reason (at least 5 characters).'; END IF;

  SELECT * INTO v_old FROM public.player_exemptions WHERE player_season_id = p_player_season_id AND revoked_at IS NULL FOR UPDATE;
  IF FOUND THEN
    UPDATE public.player_exemptions SET revoked_at = now(), revoked_by = v_actor, revoke_reason = 'Replaced by a new exemption'
    WHERE id = v_old.id;
  END IF;
  INSERT INTO public.player_exemptions (player_season_id, scope, reason, approved_by_name, recorded_by)
  VALUES (p_player_season_id, p_scope, v_reason, v_approver, v_actor);
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'player_exemption_set', 'player_seasons', p_player_season_id::text, v_reason,
          CASE WHEN v_old.id IS NULL THEN NULL ELSE jsonb_build_object('scope', v_old.scope, 'reason', v_old.reason, 'approved_by_name', v_old.approved_by_name) END,
          jsonb_build_object('scope', p_scope, 'approved_by_name', v_approver));
END;
$$;

CREATE FUNCTION public.revoke_player_exemption(p_player_season_id bigint, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_season bigint;
  v_old record;
BEGIN
  SELECT ps.season_id INTO v_season FROM public.player_seasons ps WHERE ps.id = p_player_season_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Player registration not found.'; END IF;
  IF v_actor IS NULL OR NOT public.can_register(v_season) THEN
    RAISE EXCEPTION 'Only league admins and registrars record exemptions.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.seasons WHERE id = v_season AND is_closed) THEN RAISE EXCEPTION 'This season is closed.'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'Give a reason (at least 5 characters).'; END IF;
  SELECT * INTO v_old FROM public.player_exemptions WHERE player_season_id = p_player_season_id AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This player has no exemption.'; END IF;
  UPDATE public.player_exemptions SET revoked_at = now(), revoked_by = v_actor, revoke_reason = btrim(p_reason) WHERE id = v_old.id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'player_exemption_revoked', 'player_seasons', p_player_season_id::text, btrim(p_reason),
          jsonb_build_object('scope', v_old.scope, 'reason', v_old.reason, 'approved_by_name', v_old.approved_by_name), NULL);
END;
$$;

-- Full details of a registration's active exemption (admins and registrars).
CREATE FUNCTION public.registration_exemption(p_player_season_id bigint)
RETURNS TABLE (scope text, reason text, approved_by_name text, recorded_by_name text, recorded_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT x.scope, x.reason, x.approved_by_name, COALESCE(NULLIF(up.display_name, ''), u.email), x.recorded_at
  FROM public.player_exemptions x
  JOIN public.player_seasons ps ON ps.id = x.player_season_id
  LEFT JOIN auth.users u ON u.id = x.recorded_by
  LEFT JOIN public.user_profiles up ON up.user_id = x.recorded_by
  WHERE x.player_season_id = p_player_season_id AND x.revoked_at IS NULL AND public.can_register(ps.season_id);
$$;

-- Active exemptions in a season (admins and registrars): for the Players list and check-in.
CREATE FUNCTION public.season_exemptions(p_season_id bigint)
RETURNS TABLE (player_season_id bigint, scope text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT x.player_season_id, x.scope
  FROM public.player_exemptions x JOIN public.player_seasons ps ON ps.id = x.player_season_id
  WHERE ps.season_id = p_season_id AND x.revoked_at IS NULL AND public.can_register(p_season_id);
$$;

-- Who is exempt in an age group, and from what (no reason or approver), for anyone who can see that age group:
-- admins and registrars, the people scoring it, and coaches and evaluators once its draft report is released.
CREATE FUNCTION public.session_exemptions(p_session_id bigint)
RETURNS TABLE (player_season_id bigint, scope text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT x.player_season_id, x.scope
  FROM public.evaluation_sessions es
  JOIN public.player_seasons ps ON ps.season_id = es.season_id AND ps.league_age = es.league_age
  JOIN public.player_exemptions x ON x.player_season_id = ps.id AND x.revoked_at IS NULL
  WHERE es.id = p_session_id
    AND (public.can_register(es.season_id) OR public.can_access_evaluation_session(es.id)
         OR (es.published_at IS NOT NULL AND (public.has_season_role('coach', es.season_id) OR public.has_season_role('independent_evaluator', es.season_id))));
$$;

REVOKE ALL ON FUNCTION public.set_player_exemption(bigint, text, text, text), public.revoke_player_exemption(bigint, text),
  public.registration_exemption(bigint), public.season_exemptions(bigint), public.session_exemptions(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_player_exemption(bigint, text, text, text), public.revoke_player_exemption(bigint, text),
  public.registration_exemption(bigint), public.season_exemptions(bigint), public.session_exemptions(bigint) TO authenticated;

-- ---------- check-in: return the scope; makeup days leave out players exempt from attendance ----------
DROP FUNCTION public.checkin_list(bigint, date);
CREATE FUNCTION public.checkin_list(p_season_id bigint, p_date date)
RETURNS TABLE (
  player_season_id bigint, first_name text, last_name text, date_of_birth date, league_age integer,
  evaluation_number integer, is_coach_kid boolean, event_id bigint, event_type text,
  start_time time, end_time time, location text, checked_in_at timestamptz, exempt_scope text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  WITH day_events AS (
    SELECT DISTINCT ON (es.id) es.id AS session_id, es.league_age, e.id AS event_id, e.event_type, e.start_time, e.end_time, e.location
    FROM public.evaluation_session_events e
    JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
    WHERE es.season_id = p_season_id AND es.league_age IS NOT NULL AND e.event_date = p_date
    ORDER BY es.id, (e.event_type = 'primary') DESC, e.start_time
  )
  SELECT ps.id, p.first_name, p.last_name, p.date_of_birth, ps.league_age, ps.evaluation_number, ps.is_coach_kid,
         d.event_id, d.event_type, d.start_time, d.end_time, d.location, c.checked_in_at, x.scope
  FROM day_events d
  JOIN public.player_seasons ps ON ps.season_id = p_season_id AND ps.league_age = d.league_age
  JOIN public.players p ON p.id = ps.player_id
  LEFT JOIN public.player_checkins c ON c.player_season_id = ps.id AND c.event_id = d.event_id
  LEFT JOIN public.player_exemptions x ON x.player_season_id = ps.id AND x.revoked_at IS NULL
  WHERE public.can_register(p_season_id)
    AND (d.event_type = 'primary' OR c.id IS NOT NULL OR (
      COALESCE(x.scope, '') NOT IN ('attendance', 'both')
      AND NOT EXISTS (SELECT 1 FROM public.player_checkins c2
                      JOIN public.evaluation_session_events e2 ON e2.id = c2.event_id
                      WHERE c2.player_season_id = ps.id AND e2.evaluation_session_id = d.session_id AND e2.event_date < p_date)
      AND NOT EXISTS (SELECT 1 FROM public.evaluations ev
                      WHERE ev.player_season_id = ps.id AND ev.evaluation_session_id = d.session_id AND ev.status = 'submitted')))
  ORDER BY ps.league_age, p.last_name, p.first_name;
$$;
REVOKE ALL ON FUNCTION public.checkin_list(bigint, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkin_list(bigint, date) TO authenticated;

-- ---- generated: admin_scoring_progress counts players not exempt from evaluation ----
CREATE OR REPLACE FUNCTION public.admin_scoring_progress(p_season_id bigint)
 RETURNS TABLE(session_id bigint, league_age integer, session_status text, released boolean, players integer, checked_in_today integer, user_id uuid, scorer_name text, evaluator_type text, saved integer, not_evaluated integer, drafts integer, last_saved_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH s AS (
    SELECT es.id, es.league_age, es.status, es.published_at IS NOT NULL AS released,
      (SELECT count(*)::int FROM public.player_seasons ps WHERE ps.season_id = es.season_id AND ps.league_age = es.league_age
         AND NOT EXISTS (SELECT 1 FROM public.player_exemptions x WHERE x.player_season_id = ps.id AND x.revoked_at IS NULL
                         AND x.scope IN ('evaluation', 'both'))) AS players,
      (SELECT count(DISTINCT c.player_season_id)::int FROM public.player_checkins c
         JOIN public.evaluation_session_events e ON e.id = c.event_id
        WHERE e.evaluation_session_id = es.id AND e.event_date = (now() AT TIME ZONE 'America/Los_Angeles')::date) AS here
    FROM public.evaluation_sessions es
    WHERE es.season_id = p_season_id AND es.league_age IS NOT NULL
  )
  SELECT s.id, s.league_age, s.status, s.released, s.players, s.here,
         ea.evaluator_user_id,
         COALESCE(NULLIF(up.display_name, ''), u.email),
         ea.evaluator_type,
         COALESCE(ev.saved, 0), COALESCE(ev.not_evaluated, 0), COALESCE(ev.drafts, 0), ev.last_saved_at
  FROM s
  LEFT JOIN public.evaluator_assignments ea ON ea.evaluation_session_id = s.id
  LEFT JOIN auth.users u ON u.id = ea.evaluator_user_id
  LEFT JOIN public.user_profiles up ON up.user_id = ea.evaluator_user_id
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE e.status = 'submitted')::int AS saved,
           count(*) FILTER (WHERE e.status = 'not_evaluated')::int AS not_evaluated,
           count(*) FILTER (WHERE e.status = 'draft')::int AS drafts,
           max(e.updated_at) AS last_saved_at
    FROM public.evaluations e
    WHERE e.evaluation_session_id = s.id AND e.evaluator_user_id = ea.evaluator_user_id
  ) ev ON true
  WHERE public.is_admin()
  ORDER BY s.league_age, ea.evaluator_type DESC NULLS LAST, 8;
$function$;
