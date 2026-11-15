-- Announcer role: calling bibs on evaluation day.
--
-- A per-season role for the person on the microphone. On evaluation day they open an age group, read out the
-- bibs, and tap each one as the player is called up to be evaluated (player_calls, one per player per event,
-- tap again to undo). That's a running double check that every child was seen. An announcer sees names, bibs,
-- ages, Here and Exempt only: never scores, notes, birthdates or reports. Admins and registrars can call too.
--
-- The calls feed (decided 2026-11-15):
--   * the scoring screen: "Called" on the list and a "Now up" strip with the latest bibs (session_calls);
--   * Scoring progress: players called per age group, and per scorer how many called players they haven't done;
--   * End-of-day check (admin_call_gaps): checked in but never called, called but missing a score from an
--     assigned scorer, and never checked in at all once the day has passed;
--   * the draft report: a "Not called" flag (only in age groups where calling was used);
--   * makeup days: players never called (and not scored) are listed again for check-in and calling.

-- ---------- role ----------
ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_role_name_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_name_check
  CHECK (role_name IN ('administrator', 'coach', 'independent_evaluator', 'registrar', 'announcer'));

CREATE FUNCTION public.is_announcer(p_season_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = (SELECT auth.uid()) AND ur.role_name = 'announcer' AND ur.season_id = p_season_id);
$$;

-- Admin, registrar or announcer for that season.
CREATE FUNCTION public.can_announce(p_season_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT public.can_register(p_season_id) OR public.is_announcer(p_season_id);
$$;
REVOKE ALL ON FUNCTION public.is_announcer(bigint), public.can_announce(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_announcer(bigint), public.can_announce(bigint) TO authenticated;

-- Announcers read their season (name, dates) so the app can show it. Players come only through announce_list.
CREATE POLICY seasons_read_announcer ON public.seasons FOR SELECT TO authenticated USING (public.is_announcer(id));

-- ---------- calls ----------
CREATE TABLE public.player_calls (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_season_id bigint NOT NULL REFERENCES public.player_seasons(id) ON DELETE CASCADE,
  event_id bigint NOT NULL REFERENCES public.evaluation_session_events(id) ON DELETE RESTRICT,
  called_at timestamptz NOT NULL DEFAULT now(),
  called_by uuid,
  UNIQUE (player_season_id, event_id)
);
CREATE INDEX player_calls_event_idx ON public.player_calls (event_id);
ALTER TABLE public.player_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.player_calls FROM PUBLIC, anon, authenticated;
-- No direct access: reads through the functions below, writes through toggle_call.

-- Called at any event of this age group?
CREATE FUNCTION private.called_in_session(p_player_season_id bigint, p_session_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.player_calls pc JOIN public.evaluation_session_events e ON e.id = pc.event_id
                 WHERE pc.player_season_id = p_player_season_id AND e.evaluation_session_id = p_session_id);
$$;
REVOKE ALL ON FUNCTION private.called_in_session(bigint, bigint) FROM PUBLIC, anon, authenticated;

-- Days with events this season, for the announcer's day picker.
CREATE FUNCTION public.announce_days(p_season_id bigint)
RETURNS TABLE (event_date date, has_primary boolean, has_makeup boolean, age_groups integer[])
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT e.event_date, bool_or(e.event_type = 'primary'), bool_or(e.event_type = 'makeup'),
         array_agg(DISTINCT es.league_age ORDER BY es.league_age)
  FROM public.evaluation_session_events e
  JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
  WHERE es.season_id = p_season_id AND es.league_age IS NOT NULL AND public.can_announce(p_season_id)
  GROUP BY e.event_date
  ORDER BY e.event_date;
$$;

-- Players to call on one day, by age group: everyone on the main day; on a makeup day, players not called and
-- not scored at an earlier event of their age group (and not excused from attending), plus anyone already called
-- at this event so it can be undone. Here = checked in at this event. No birthdates.
CREATE FUNCTION public.announce_list(p_season_id bigint, p_date date)
RETURNS TABLE (
  player_season_id bigint, first_name text, last_name text, league_age integer, evaluation_number integer,
  event_id bigint, event_type text, start_time time, end_time time, location text,
  checked_in_at timestamptz, called_at timestamptz, exempt_scope text
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
  SELECT ps.id, p.first_name, p.last_name, ps.league_age, ps.evaluation_number,
         d.event_id, d.event_type, d.start_time, d.end_time, d.location, c.checked_in_at, pc.called_at, x.scope
  FROM day_events d
  JOIN public.player_seasons ps ON ps.season_id = p_season_id AND ps.league_age = d.league_age
  JOIN public.players p ON p.id = ps.player_id
  LEFT JOIN public.player_checkins c ON c.player_season_id = ps.id AND c.event_id = d.event_id
  LEFT JOIN public.player_calls pc ON pc.player_season_id = ps.id AND pc.event_id = d.event_id
  LEFT JOIN public.player_exemptions x ON x.player_season_id = ps.id AND x.revoked_at IS NULL
  WHERE public.can_announce(p_season_id)
    AND (d.event_type = 'primary' OR pc.id IS NOT NULL OR c.id IS NOT NULL OR (
      COALESCE(x.scope, '') NOT IN ('attendance', 'both')
      AND NOT EXISTS (SELECT 1 FROM public.player_calls pc2
                      JOIN public.evaluation_session_events e2 ON e2.id = pc2.event_id
                      WHERE pc2.player_season_id = ps.id AND e2.evaluation_session_id = d.session_id AND e2.event_date < p_date)
      AND NOT EXISTS (SELECT 1 FROM public.evaluations ev
                      WHERE ev.player_season_id = ps.id AND ev.evaluation_session_id = d.session_id AND ev.status = 'submitted')))
  ORDER BY ps.league_age, ps.evaluation_number NULLS LAST, p.last_name, p.first_name;
$$;

-- Call a player at an event, or undo it. Returns true when the player is now called.
CREATE FUNCTION public.toggle_call(p_player_season_id bigint, p_event_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_reg record;
  v_deleted integer;
BEGIN
  SELECT ps.id, ps.season_id, ps.league_age, s.is_closed INTO v_reg
  FROM public.player_seasons ps JOIN public.seasons s ON s.id = ps.season_id
  WHERE ps.id = p_player_season_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Player registration not found.'; END IF;
  IF v_actor IS NULL OR NOT public.can_announce(v_reg.season_id) THEN
    RAISE EXCEPTION 'Only announcers, registrars and league admins call players.' USING ERRCODE = '42501';
  END IF;
  IF v_reg.is_closed THEN RAISE EXCEPTION 'This season is closed.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.evaluation_session_events e JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
                 WHERE e.id = p_event_id AND es.season_id = v_reg.season_id AND es.league_age = v_reg.league_age) THEN
    RAISE EXCEPTION 'That event is not for this player''s age group.';
  END IF;

  DELETE FROM public.player_calls WHERE player_season_id = p_player_season_id AND event_id = p_event_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    INSERT INTO public.player_calls (player_season_id, event_id, called_by) VALUES (p_player_season_id, p_event_id, v_actor);
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (v_actor, CASE WHEN v_deleted = 0 THEN 'player_called' ELSE 'player_call_undone' END,
          'player_seasons', p_player_season_id::text, jsonb_build_object('event_id', p_event_id));
  RETURN v_deleted = 0;
END;
$$;

-- Every call in an age group (any event), newest first: the scoring screen's "Called" and "Now up" (today's),
-- and the draft report's "Not called" flag. For whoever can score or call this age group, admins, and coaches
-- and evaluators of the season once the report is released.
CREATE FUNCTION public.session_calls(p_session_id bigint)
RETURNS TABLE (player_season_id bigint, called_at timestamptz, event_date date)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT pc.player_season_id, pc.called_at, e.event_date
  FROM public.player_calls pc
  JOIN public.evaluation_session_events e ON e.id = pc.event_id
  JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
  WHERE e.evaluation_session_id = p_session_id
    AND (public.is_admin() OR public.can_announce(es.season_id) OR public.can_access_evaluation_session(p_session_id)
         OR (es.published_at IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.user_roles ur WHERE ur.user_id = (SELECT auth.uid())
                 AND ur.role_name IN ('coach', 'independent_evaluator') AND ur.season_id = es.season_id)))
  ORDER BY pc.called_at DESC;
$$;

-- End-of-day check (admins): players who may have been missed, per age group.
--   not_here           the age group's main day has passed, check-in was used, and the player was never checked in,
--                      called or scored (and isn't exempt): needs a makeup.
--   here_not_called    calling was used in the age group; checked in but never called (not exempt from evaluation).
--   called_not_scored  called, but an assigned scorer has no saved or Not Evaluated score for them (drafts count
--                      as missing); missing_scorers names them.
CREATE FUNCTION public.admin_call_gaps(p_season_id bigint)
RETURNS TABLE (session_id bigint, league_age integer, player_season_id bigint, first_name text, last_name text,
               evaluation_number integer, gap text, missing_scorers text[])
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  WITH sess AS (
    SELECT es.id, es.league_age,
      EXISTS (SELECT 1 FROM public.player_calls pc JOIN public.evaluation_session_events e ON e.id = pc.event_id
              WHERE e.evaluation_session_id = es.id) AS uses_calls,
      EXISTS (SELECT 1 FROM public.player_checkins c JOIN public.evaluation_session_events e ON e.id = c.event_id
              WHERE e.evaluation_session_id = es.id) AS uses_checkin,
      EXISTS (SELECT 1 FROM public.evaluation_session_events e WHERE e.evaluation_session_id = es.id AND e.event_type = 'primary'
              AND e.event_date <= (now() AT TIME ZONE 'America/Los_Angeles')::date) AS day_passed
    FROM public.evaluation_sessions es
    WHERE es.season_id = p_season_id AND es.league_age IS NOT NULL
  ), reg AS (
    SELECT s.id AS session_id, s.league_age, s.uses_calls, s.uses_checkin, s.day_passed,
      ps.id AS psid, p.first_name, p.last_name, ps.evaluation_number, COALESCE(x.scope, '') AS scope,
      EXISTS (SELECT 1 FROM public.player_checkins c JOIN public.evaluation_session_events e ON e.id = c.event_id
              WHERE c.player_season_id = ps.id AND e.evaluation_session_id = s.id) AS here,
      private.called_in_session(ps.id, s.id) AS called,
      EXISTS (SELECT 1 FROM public.evaluations ev WHERE ev.player_season_id = ps.id AND ev.evaluation_session_id = s.id
              AND ev.status = 'submitted') AS scored,
      ARRAY(SELECT COALESCE(NULLIF(up.display_name, ''), u.email) || CASE WHEN ea.evaluator_type = 'coach' THEN ' (coach)' ELSE ' (evaluator)' END
            FROM public.evaluator_assignments ea
            JOIN auth.users u ON u.id = ea.evaluator_user_id
            LEFT JOIN public.user_profiles up ON up.user_id = ea.evaluator_user_id
            WHERE ea.evaluation_session_id = s.id
              AND NOT EXISTS (SELECT 1 FROM public.evaluations ev WHERE ev.evaluation_session_id = s.id
                              AND ev.player_season_id = ps.id AND ev.evaluator_user_id = ea.evaluator_user_id
                              AND ev.status IN ('submitted', 'not_evaluated'))
            ORDER BY ea.evaluator_type DESC, 1) AS missing
    FROM sess s
    JOIN public.player_seasons ps ON ps.season_id = p_season_id AND ps.league_age = s.league_age
    JOIN public.players p ON p.id = ps.player_id
    LEFT JOIN public.player_exemptions x ON x.player_season_id = ps.id AND x.revoked_at IS NULL
  )
  SELECT session_id, league_age, psid, first_name, last_name, evaluation_number, gap, missing_scorers
  FROM (
    SELECT r.*, 'not_here'::text AS gap, NULL::text[] AS missing_scorers FROM reg r
    WHERE r.day_passed AND r.uses_checkin AND NOT r.here AND NOT r.called AND NOT r.scored AND r.scope = ''
    UNION ALL
    SELECT r.*, 'here_not_called', NULL FROM reg r
    WHERE r.uses_calls AND r.here AND NOT r.called AND r.scope NOT IN ('evaluation', 'both')
    UNION ALL
    SELECT r.*, 'called_not_scored', r.missing FROM reg r
    WHERE r.called AND cardinality(r.missing) > 0
  ) g
  WHERE public.is_admin()
  ORDER BY league_age, gap, evaluation_number NULLS LAST, last_name;
$$;

REVOKE ALL ON FUNCTION public.announce_days(bigint), public.announce_list(bigint, date), public.toggle_call(bigint, bigint),
  public.session_calls(bigint), public.admin_call_gaps(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announce_days(bigint), public.announce_list(bigint, date), public.toggle_call(bigint, bigint),
  public.session_calls(bigint), public.admin_call_gaps(bigint) TO authenticated;

-- ---------- Scoring progress: players called, and per scorer the called players they haven't done ----------
DROP FUNCTION public.admin_scoring_progress(bigint);
CREATE FUNCTION public.admin_scoring_progress(p_season_id bigint)
 RETURNS TABLE(session_id bigint, league_age integer, session_status text, released boolean, players integer, checked_in_today integer,
               called integer, user_id uuid, scorer_name text, evaluator_type text, saved integer, not_evaluated integer, drafts integer,
               last_saved_at timestamp with time zone, called_not_done integer)
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
        WHERE e.evaluation_session_id = es.id AND e.event_date = (now() AT TIME ZONE 'America/Los_Angeles')::date) AS here,
      (SELECT count(DISTINCT pc.player_season_id)::int FROM public.player_calls pc
         JOIN public.evaluation_session_events e ON e.id = pc.event_id
        WHERE e.evaluation_session_id = es.id) AS called
    FROM public.evaluation_sessions es
    WHERE es.season_id = p_season_id AND es.league_age IS NOT NULL
  )
  SELECT s.id, s.league_age, s.status, s.released, s.players, s.here, s.called,
         ea.evaluator_user_id,
         COALESCE(NULLIF(up.display_name, ''), u.email),
         ea.evaluator_type,
         COALESCE(ev.saved, 0), COALESCE(ev.not_evaluated, 0), COALESCE(ev.drafts, 0), ev.last_saved_at,
         CASE WHEN ea.evaluator_user_id IS NULL THEN 0 ELSE (
           SELECT count(DISTINCT pc.player_season_id)::int FROM public.player_calls pc
             JOIN public.evaluation_session_events e ON e.id = pc.event_id
            WHERE e.evaluation_session_id = s.id
              AND NOT EXISTS (SELECT 1 FROM public.evaluations x WHERE x.evaluation_session_id = s.id
                              AND x.player_season_id = pc.player_season_id AND x.evaluator_user_id = ea.evaluator_user_id
                              AND x.status IN ('submitted', 'not_evaluated'))) END
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
  ORDER BY s.league_age, ea.evaluator_type DESC NULLS LAST, 9;
$function$;
REVOKE ALL ON FUNCTION public.admin_scoring_progress(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_scoring_progress(bigint) TO authenticated;

-- ---------- Makeup check-in: players never called (and not scored) come back ----------
-- Before: a makeup day left out anyone checked in at an earlier event. Now it leaves out anyone called at an
-- earlier event or already scored, so a child who came but was never called is listed for the makeup.
CREATE OR REPLACE FUNCTION public.checkin_list(p_season_id bigint, p_date date)
 RETURNS TABLE(player_season_id bigint, first_name text, last_name text, league_age integer, evaluation_number integer, is_coach_kid boolean, event_id bigint, event_type text, start_time time without time zone, end_time time without time zone, location text, checked_in_at timestamp with time zone, exempt_scope text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH day_events AS (
    SELECT DISTINCT ON (es.id) es.id AS session_id, es.league_age, e.id AS event_id, e.event_type, e.start_time, e.end_time, e.location
    FROM public.evaluation_session_events e
    JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
    WHERE es.season_id = p_season_id AND es.league_age IS NOT NULL AND e.event_date = p_date
    ORDER BY es.id, (e.event_type = 'primary') DESC, e.start_time
  )
  SELECT ps.id, p.first_name, p.last_name, ps.league_age, ps.evaluation_number, ps.is_coach_kid,
         d.event_id, d.event_type, d.start_time, d.end_time, d.location, c.checked_in_at, x.scope
  FROM day_events d
  JOIN public.player_seasons ps ON ps.season_id = p_season_id AND ps.league_age = d.league_age
  JOIN public.players p ON p.id = ps.player_id
  LEFT JOIN public.player_checkins c ON c.player_season_id = ps.id AND c.event_id = d.event_id
  LEFT JOIN public.player_exemptions x ON x.player_season_id = ps.id AND x.revoked_at IS NULL
  WHERE public.can_register(p_season_id)
    AND (d.event_type = 'primary' OR c.id IS NOT NULL OR (
      COALESCE(x.scope, '') NOT IN ('attendance', 'both')
      AND NOT EXISTS (SELECT 1 FROM public.player_calls pc2
                      JOIN public.evaluation_session_events e2 ON e2.id = pc2.event_id
                      WHERE pc2.player_season_id = ps.id AND e2.evaluation_session_id = d.session_id AND e2.event_date < p_date)
      AND NOT EXISTS (SELECT 1 FROM public.evaluations ev
                      WHERE ev.player_season_id = ps.id AND ev.evaluation_session_id = d.session_id AND ev.status = 'submitted')))
  ORDER BY ps.league_age, p.last_name, p.first_name;
$function$;

-- ---------- Who scores when: announcers too ----------
CREATE OR REPLACE FUNCTION public.registrar_timetable(p_season_id bigint)
 RETURNS TABLE(session_id bigint, league_age integer, status text, events jsonb, coaches text[], evaluators text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT es.id, es.league_age, es.status,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('type', e.event_type, 'date', e.event_date, 'start', e.start_time, 'end', e.end_time,
                                                  'location', e.location, 'notes', e.notes)
                               ORDER BY (e.event_type = 'primary') DESC, e.event_date, e.start_time)
              FROM public.evaluation_session_events e WHERE e.evaluation_session_id = es.id), '[]'::jsonb),
    COALESCE((SELECT array_agg(COALESCE(NULLIF(up.display_name, ''), u.email) ORDER BY COALESCE(NULLIF(up.display_name, ''), u.email))
              FROM public.evaluator_assignments ea JOIN auth.users u ON u.id = ea.evaluator_user_id
              LEFT JOIN public.user_profiles up ON up.user_id = ea.evaluator_user_id
              WHERE ea.evaluation_session_id = es.id AND ea.evaluator_type = 'coach'), '{}'),
    COALESCE((SELECT array_agg(COALESCE(NULLIF(up.display_name, ''), u.email) ORDER BY COALESCE(NULLIF(up.display_name, ''), u.email))
              FROM public.evaluator_assignments ea JOIN auth.users u ON u.id = ea.evaluator_user_id
              LEFT JOIN public.user_profiles up ON up.user_id = ea.evaluator_user_id
              WHERE ea.evaluation_session_id = es.id AND ea.evaluator_type = 'independent_evaluator'), '{}')
  FROM public.evaluation_sessions es
  WHERE es.season_id = p_season_id AND es.league_age IS NOT NULL AND public.can_announce(p_season_id)
  ORDER BY es.league_age;
$function$;

-- ---------- People: the new role ----------
CREATE OR REPLACE FUNCTION public.admin_grant_role(p_user_id uuid, p_role text, p_season_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_season bigint := CASE WHEN p_role = 'administrator' THEN NULL ELSE p_season_id END;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('administrator', 'coach', 'independent_evaluator', 'registrar', 'announcer') THEN
    RAISE EXCEPTION 'Unknown role.';
  END IF;
  IF p_role <> 'administrator' AND NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = p_season_id) THEN
    RAISE EXCEPTION 'Choose a season for coach, evaluator, registrar and announcer roles.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'Account not found.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_user_id AND ur.role_name = p_role AND ur.season_id IS NOT DISTINCT FROM v_season) THEN
    RETURN;
  END IF;

  INSERT INTO public.user_roles (user_id, role_name, season_id, created_by) VALUES (p_user_id, p_role, v_season, v_actor);
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'role_granted', 'user_roles', p_user_id::text, NULL, NULL,
          jsonb_build_object('role', p_role, 'season_id', v_season));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_people_not_signed_in(p_season_id bigint)
 RETURNS TABLE(user_id uuid, email text, display_name text, roles text[], invited_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT u.id, u.email::text, NULLIF(up.display_name, ''),
         array_agg(ur.role_name ORDER BY ur.role_name),
         COALESCE(u.invited_at, u.created_at)
  FROM public.user_roles ur
  JOIN auth.users u ON u.id = ur.user_id
  LEFT JOIN public.user_profiles up ON up.user_id = u.id
  WHERE ur.season_id = p_season_id
    AND ur.role_name IN ('coach', 'independent_evaluator', 'registrar', 'announcer')
    AND u.last_sign_in_at IS NULL
    AND NOT (u.banned_until IS NOT NULL AND u.banned_until > now())
    AND public.is_admin()
  GROUP BY u.id, u.email, up.display_name, u.invited_at, u.created_at
  ORDER BY COALESCE(NULLIF(up.display_name, ''), u.email);
$function$;

-- The roadmap counts announcers like registrars: in "not signed in", not in "unassigned".
CREATE OR REPLACE FUNCTION public.admin_season_roadmap(p_season_id bigint, p_today date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_season record;
  v_sessions jsonb;
  v_reg jsonb;
  v_imports jsonb;
  v_prior jsonb;
  v_people jsonb;
  v_first_primary date;
  v_last_event date;
  v_total int;
  v_open int;
  v_locked int;
  v_released int;
  v_stage text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  SELECT s.id, s.name, s.is_closed, s.start_date, s.show_prior_year_during_evaluations INTO v_season
  FROM public.seasons s WHERE s.id = p_season_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Season was not found.';
  END IF;

  -- Registrations
  SELECT jsonb_build_object(
    'total', count(*),
    'no_bib', count(*) FILTER (WHERE ps.evaluation_number IS NULL AND ps.league_age IS NOT NULL),
    'no_age', count(*) FILTER (WHERE ps.league_age IS NULL),
    'on_site', count(*) FILTER (WHERE ps.registration_source = 'on_site'))
  INTO v_reg
  FROM public.player_seasons ps WHERE ps.season_id = p_season_id;

  -- Imports waiting on the admin
  SELECT jsonb_build_object(
    'registration_batches', (SELECT count(*) FROM public.import_batches b WHERE b.season_id = p_season_id AND b.import_type = 'players'),
    'registration_rows_to_review', (
      SELECT count(*) FROM public.sports_connect_import_rows r
      JOIN public.import_batches b ON b.id = r.import_batch_id
      WHERE b.season_id = p_season_id
        AND r.review_state IN ('needs_review', 'ready_for_match_review', 'approved_new', 'approved_match', 'has_changes')),
    'bib_rows_held', (
      SELECT count(*) FROM public.bib_import_rows r
      JOIN public.import_batches b ON b.id = r.import_batch_id
      WHERE b.season_id = p_season_id AND r.status = 'held'))
  INTO v_imports;

  -- Prior-year ratings (pending rows are counted across batches, as the Prior-year page does)
  SELECT jsonb_build_object(
    'players_with_prior', (
      SELECT count(DISTINCT ps.id) FROM public.player_seasons ps
      JOIN public.historical_evaluations h ON h.player_id = ps.player_id
      WHERE ps.season_id = p_season_id AND h.source_season_id IS DISTINCT FROM p_season_id),
    'rows_pending', (
      SELECT count(*) FROM public.historical_evaluation_import_rows r
      WHERE r.review_state = 'pending_review' AND r.match_status <> 'invalid'),
    'shown_while_scoring', v_season.show_prior_year_during_evaluations)
  INTO v_prior;

  -- People with a role this season
  WITH people AS (
    SELECT ur.user_id, ur.role_name, u.last_sign_in_at,
           (u.banned_until IS NOT NULL AND u.banned_until > now()) AS disabled
    FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id
    WHERE ur.season_id = p_season_id AND ur.role_name IN ('coach', 'independent_evaluator', 'registrar', 'announcer')
  )
  SELECT jsonb_build_object(
    'coaches', count(*) FILTER (WHERE role_name = 'coach'),
    'evaluators', count(*) FILTER (WHERE role_name = 'independent_evaluator'),
    'not_signed_in', count(DISTINCT user_id) FILTER (WHERE last_sign_in_at IS NULL AND NOT disabled),
    'unassigned', count(*) FILTER (WHERE NOT disabled AND role_name NOT IN ('registrar', 'announcer') AND NOT EXISTS (
      SELECT 1 FROM public.evaluator_assignments ea
      JOIN public.evaluation_sessions es ON es.id = ea.evaluation_session_id
      WHERE ea.evaluator_user_id = people.user_id AND es.season_id = p_season_id)))
  INTO v_people FROM people;

  -- One entry per age group
  WITH sess AS (
    SELECT es.id, es.league_age, es.status, es.published_at
    FROM public.evaluation_sessions es WHERE es.season_id = p_season_id AND es.league_age IS NOT NULL
  ),
  players AS (
    SELECT s.id AS session_id, count(ps.id) AS players,
           count(ps.id) FILTER (WHERE ps.evaluation_number IS NULL) AS no_bib
    FROM sess s LEFT JOIN public.player_seasons ps ON ps.season_id = p_season_id AND ps.league_age = s.league_age
    GROUP BY s.id
  ),
  asg AS (
    SELECT s.id AS session_id,
           count(ea.id) FILTER (WHERE ea.evaluator_type = 'coach') AS coaches,
           count(ea.id) FILTER (WHERE ea.evaluator_type = 'independent_evaluator') AS evaluators
    FROM sess s LEFT JOIN public.evaluator_assignments ea ON ea.evaluation_session_id = s.id
    GROUP BY s.id
  ),
  ev AS (
    SELECT s.id AS session_id,
           count(e.id) FILTER (WHERE e.status = 'submitted') AS submitted,
           count(e.id) FILTER (WHERE e.status = 'draft') AS drafts,
           count(DISTINCT e.player_season_id) FILTER (WHERE e.status = 'submitted' AND e.evaluator_type = 'independent_evaluator') AS players_scored_by_evaluator,
           count(DISTINCT e.player_season_id) FILTER (WHERE e.status = 'submitted' AND e.evaluator_type = 'coach') AS players_scored_by_coach,
           count(DISTINCT e.player_season_id) FILTER (WHERE e.status IN ('submitted', 'not_evaluated')) AS players_touched
    FROM sess s LEFT JOIN public.evaluations e ON e.evaluation_session_id = s.id
    GROUP BY s.id
  ),
  evt AS (
    SELECT s.id AS session_id,
           min(x.event_date) FILTER (WHERE x.event_type = 'primary') AS primary_date,
           min(x.start_time) FILTER (WHERE x.event_type = 'primary') AS primary_start,
           count(x.id) FILTER (WHERE x.event_type = 'makeup') AS makeups,
           max(x.event_date) AS last_event_date
    FROM sess s LEFT JOIN public.evaluation_session_events x ON x.evaluation_session_id = s.id
    GROUP BY s.id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'league_age', s.league_age, 'status', s.status, 'released', s.published_at IS NOT NULL,
           'players', p.players, 'no_bib', p.no_bib,
           'coaches', a.coaches, 'evaluators', a.evaluators,
           'submitted', ev.submitted, 'drafts', ev.drafts,
           'players_scored_by_evaluator', ev.players_scored_by_evaluator,
           'players_scored_by_coach', ev.players_scored_by_coach,
           'players_touched', ev.players_touched,
           'primary_date', evt.primary_date, 'primary_start', evt.primary_start,
           'makeups', evt.makeups, 'last_event_date', evt.last_event_date)
         ORDER BY s.league_age), '[]'::jsonb),
         min(evt.primary_date), max(evt.last_event_date),
         count(*), count(*) FILTER (WHERE s.status = 'open'),
         count(*) FILTER (WHERE s.status = 'locked'), count(*) FILTER (WHERE s.published_at IS NOT NULL)
  INTO v_sessions, v_first_primary, v_last_event, v_total, v_open, v_locked, v_released
  FROM sess s
  JOIN players p ON p.session_id = s.id
  JOIN asg a ON a.session_id = s.id
  JOIN ev ON ev.session_id = s.id
  JOIN evt ON evt.session_id = s.id;

  v_stage := CASE
    WHEN v_season.is_closed OR (v_total > 0 AND v_released = v_total) THEN 'end'
    WHEN v_locked > 0 OR v_released > 0 OR (v_last_event IS NOT NULL AND p_today > v_last_event) THEN 'after'
    WHEN v_first_primary IS NOT NULL AND p_today BETWEEN v_first_primary AND v_last_event THEN 'day'
    WHEN v_open > 0 OR (v_first_primary IS NOT NULL AND v_first_primary - p_today <= 7) THEN 'week'
    ELSE 'before'
  END;

  RETURN jsonb_build_object(
    'season', jsonb_build_object('id', v_season.id, 'name', v_season.name, 'is_closed', v_season.is_closed),
    'stage', v_stage,
    'today', p_today,
    'first_primary_date', v_first_primary,
    'last_event_date', v_last_event,
    'registrations', v_reg,
    'imports', v_imports,
    'prior_year', v_prior,
    'people', v_people,
    'sessions', v_sessions);
END;
$function$;
