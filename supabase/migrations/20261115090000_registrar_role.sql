-- Registrar role (part 1: evaluation day).
--
-- A per-season role for the people who run registration and check-in. A registrar can:
--   * read the season's registrations and player names (to print rosters, check players in, add walk-ups)
--   * check players in at an age group's event (player_checkins), and undo a check-in
--   * set or change a bib (set_registration_bib) and add walk-up players (admin_add_onsite_registration)
--   * see who scores which age group and when (registrar_timetable)
-- A registrar never sees scores, notes or draft reports, and can't change people, roles, sessions or
-- assignments. Check-in is in person only: registrars and admins, never coaches or evaluators.
--
-- Coaches and evaluators see a "here" marker on the scoring list for players checked in today
-- (session_checked_in_today).

-- ---------- role ----------
ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_role_name_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_name_check
  CHECK (role_name IN ('administrator', 'coach', 'independent_evaluator', 'registrar'));

CREATE FUNCTION public.is_registrar(p_season_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = (SELECT auth.uid()) AND ur.role_name = 'registrar' AND ur.season_id = p_season_id);
$$;

-- Registrar in any season that is still open (used to read player names for walk-up matching).
CREATE FUNCTION public.is_registrar_any()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.seasons s ON s.id = ur.season_id
                 WHERE ur.user_id = (SELECT auth.uid()) AND ur.role_name = 'registrar' AND NOT s.is_closed);
$$;

-- Admin, or registrar for that season.
CREATE FUNCTION public.can_register(p_season_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT public.is_admin() OR public.is_registrar(p_season_id);
$$;
REVOKE ALL ON FUNCTION public.is_registrar(bigint), public.is_registrar_any(), public.can_register(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_registrar(bigint), public.is_registrar_any(), public.can_register(bigint) TO authenticated;

-- Read access: registrations, player names and seasons. No scores, notes or sessions.
CREATE POLICY player_seasons_read_registrar ON public.player_seasons FOR SELECT TO authenticated
  USING (public.is_registrar(season_id));
CREATE POLICY players_read_registrar ON public.players FOR SELECT TO authenticated
  USING (public.is_registrar_any());
CREATE POLICY seasons_read_registrar ON public.seasons FOR SELECT TO authenticated
  USING (public.is_registrar(id));

-- ---------- check-ins ----------
CREATE TABLE public.player_checkins (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_season_id bigint NOT NULL REFERENCES public.player_seasons(id) ON DELETE CASCADE,
  event_id bigint NOT NULL REFERENCES public.evaluation_session_events(id) ON DELETE RESTRICT,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_in_by uuid,
  UNIQUE (player_season_id, event_id)
);
ALTER TABLE public.player_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY player_checkins_read ON public.player_checkins FOR SELECT TO authenticated
  USING (public.can_register((SELECT ps.season_id FROM public.player_seasons ps WHERE ps.id = player_season_id)));
-- Writes only through toggle_checkin.
GRANT SELECT ON public.player_checkins TO authenticated;

-- Days with events this season, for the check-in day picker.
CREATE FUNCTION public.checkin_days(p_season_id bigint)
RETURNS TABLE (event_date date, has_primary boolean, has_makeup boolean, age_groups integer[])
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT e.event_date, bool_or(e.event_type = 'primary'), bool_or(e.event_type = 'makeup'),
         array_agg(DISTINCT es.league_age ORDER BY es.league_age)
  FROM public.evaluation_session_events e
  JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
  WHERE es.season_id = p_season_id AND es.league_age IS NOT NULL AND public.can_register(p_season_id)
  GROUP BY e.event_date
  ORDER BY e.event_date;
$$;

-- Players to check in on one day: every registered player whose age group has an event that day.
-- On a makeup event, players already checked in at an earlier event of their age group, or already scored,
-- are left out (unless they were checked in at this event, so it can be undone).
CREATE FUNCTION public.checkin_list(p_season_id bigint, p_date date)
RETURNS TABLE (
  player_season_id bigint, first_name text, last_name text, date_of_birth date, league_age integer,
  evaluation_number integer, is_coach_kid boolean, event_id bigint, event_type text,
  start_time time, end_time time, location text, checked_in_at timestamptz
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
         d.event_id, d.event_type, d.start_time, d.end_time, d.location, c.checked_in_at
  FROM day_events d
  JOIN public.player_seasons ps ON ps.season_id = p_season_id AND ps.league_age = d.league_age
  JOIN public.players p ON p.id = ps.player_id
  LEFT JOIN public.player_checkins c ON c.player_season_id = ps.id AND c.event_id = d.event_id
  WHERE public.can_register(p_season_id)
    AND (d.event_type = 'primary' OR c.id IS NOT NULL OR (
      NOT EXISTS (SELECT 1 FROM public.player_checkins c2
                  JOIN public.evaluation_session_events e2 ON e2.id = c2.event_id
                  WHERE c2.player_season_id = ps.id AND e2.evaluation_session_id = d.session_id AND e2.event_date < p_date)
      AND NOT EXISTS (SELECT 1 FROM public.evaluations ev
                      WHERE ev.player_season_id = ps.id AND ev.evaluation_session_id = d.session_id AND ev.status = 'submitted')))
  ORDER BY ps.league_age, p.last_name, p.first_name;
$$;

-- Check a player in at an event, or undo it. Returns true when the player is now checked in.
CREATE FUNCTION public.toggle_checkin(p_player_season_id bigint, p_event_id bigint)
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
  IF v_actor IS NULL OR NOT public.can_register(v_reg.season_id) THEN
    RAISE EXCEPTION 'Only registrars and league admins check players in.' USING ERRCODE = '42501';
  END IF;
  IF v_reg.is_closed THEN RAISE EXCEPTION 'This season is closed.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.evaluation_session_events e JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
                 WHERE e.id = p_event_id AND es.season_id = v_reg.season_id AND es.league_age = v_reg.league_age) THEN
    RAISE EXCEPTION 'That event is not for this player''s age group.';
  END IF;

  DELETE FROM public.player_checkins WHERE player_season_id = p_player_season_id AND event_id = p_event_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    INSERT INTO public.player_checkins (player_season_id, event_id, checked_in_by) VALUES (p_player_season_id, p_event_id, v_actor);
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (v_actor, CASE WHEN v_deleted = 0 THEN 'player_checked_in' ELSE 'player_check_in_undone' END,
          'player_seasons', p_player_season_id::text, jsonb_build_object('event_id', p_event_id));
  RETURN v_deleted = 0;
END;
$$;

-- Give or change a player's bib (registrar or admin). Audited; bibs are unique in the season.
CREATE FUNCTION public.set_registration_bib(p_player_season_id bigint, p_bib integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_reg record;
  v_owner text;
BEGIN
  SELECT ps.id, ps.season_id, ps.evaluation_number, s.is_closed INTO v_reg
  FROM public.player_seasons ps JOIN public.seasons s ON s.id = ps.season_id
  WHERE ps.id = p_player_season_id
  FOR UPDATE OF ps;
  IF NOT FOUND THEN RAISE EXCEPTION 'Player registration not found.'; END IF;
  IF v_actor IS NULL OR NOT public.can_register(v_reg.season_id) THEN
    RAISE EXCEPTION 'Only registrars and league admins set bibs.' USING ERRCODE = '42501';
  END IF;
  IF v_reg.is_closed THEN RAISE EXCEPTION 'This season is closed.'; END IF;
  IF p_bib IS NULL OR p_bib < 1 THEN RAISE EXCEPTION 'Bib numbers are positive whole numbers.'; END IF;
  IF p_bib IS NOT DISTINCT FROM v_reg.evaluation_number THEN RETURN; END IF;
  v_owner := private.bib_owner_label(v_reg.season_id, p_bib, p_player_season_id);
  IF v_owner IS NOT NULL THEN RAISE EXCEPTION 'Bib % is already used by % this season.', p_bib, v_owner; END IF;
  UPDATE public.player_seasons SET evaluation_number = p_bib WHERE id = p_player_season_id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'registration_bib_set', 'player_seasons', p_player_season_id::text, 'Set at check-in',
          jsonb_build_object('evaluation_number', v_reg.evaluation_number), jsonb_build_object('evaluation_number', p_bib));
END;
$$;

-- Who scores which age group, and when (registrars and admins). Names only; no scores.
CREATE FUNCTION public.registrar_timetable(p_season_id bigint)
RETURNS TABLE (session_id bigint, league_age integer, status text, events jsonb, coaches text[], evaluators text[])
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
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
  WHERE es.season_id = p_season_id AND es.league_age IS NOT NULL AND public.can_register(p_season_id)
  ORDER BY es.league_age;
$$;

-- "Here" marker on the scoring list: players in this age group checked in at any of its events today (Pacific).
CREATE FUNCTION public.session_checked_in_today(p_session_id bigint)
RETURNS SETOF bigint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT DISTINCT c.player_season_id
  FROM public.player_checkins c
  JOIN public.evaluation_session_events e ON e.id = c.event_id
  JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
  WHERE e.evaluation_session_id = p_session_id
    AND e.event_date = (now() AT TIME ZONE 'America/Los_Angeles')::date
    AND (public.can_access_evaluation_session(p_session_id) OR public.can_register(es.season_id));
$$;

REVOKE ALL ON FUNCTION public.checkin_days(bigint), public.checkin_list(bigint, date), public.toggle_checkin(bigint, bigint),
  public.set_registration_bib(bigint, integer), public.registrar_timetable(bigint), public.session_checked_in_today(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkin_days(bigint), public.checkin_list(bigint, date), public.toggle_checkin(bigint, bigint),
  public.set_registration_bib(bigint, integer), public.registrar_timetable(bigint), public.session_checked_in_today(bigint) TO authenticated;

-- ---- generated: existing functions patched below ----
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
  IF p_role NOT IN ('administrator', 'coach', 'independent_evaluator', 'registrar') THEN
    RAISE EXCEPTION 'Unknown role.';
  END IF;
  IF p_role <> 'administrator' AND NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = p_season_id) THEN
    RAISE EXCEPTION 'Choose a season for coach, evaluator and registrar roles.';
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

CREATE OR REPLACE FUNCTION public.admin_add_onsite_registration(p_season_id bigint, p_player_id bigint, p_first_name text, p_last_name text, p_date_of_birth date, p_league_age integer, p_evaluation_number integer, p_reason text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_player_id bigint := p_player_id;
  v_ps_id bigint;
  v_owner text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  -- Registrars add walk-ups too.
  IF v_actor IS NULL OR NOT public.can_register(p_season_id) THEN
    RAISE EXCEPTION 'Only registrars and league admins add walk-up players.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = p_season_id AND NOT s.is_closed) THEN
    RAISE EXCEPTION 'Choose an open season.';
  END IF;
  IF p_league_age IS NULL OR p_league_age < 4 OR p_league_age > 18 THEN
    RAISE EXCEPTION 'Choose the player''s age group (league age 4 to 18).';
  END IF;
  IF p_evaluation_number IS NOT NULL AND p_evaluation_number < 1 THEN
    RAISE EXCEPTION 'Bib numbers must be positive whole numbers.';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Give a reason (at least 5 characters), for example "Walk-up at evaluations".';
  END IF;

  IF v_player_id IS NULL THEN
    IF btrim(COALESCE(p_first_name, '')) = '' OR btrim(COALESCE(p_last_name, '')) = '' THEN
      RAISE EXCEPTION 'First and last name are required.';
    END IF;
    INSERT INTO public.players (first_name, last_name, date_of_birth)
    VALUES (btrim(p_first_name), btrim(p_last_name), p_date_of_birth)
    RETURNING id INTO v_player_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = v_player_id) THEN
    RAISE EXCEPTION 'The selected player was not found.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.player_seasons ps WHERE ps.player_id = v_player_id AND ps.season_id = p_season_id) THEN
    RAISE EXCEPTION 'That player is already registered this season. Find them on the Players page instead.';
  END IF;

  IF p_evaluation_number IS NOT NULL THEN
    v_owner := private.bib_owner_label(p_season_id, p_evaluation_number, NULL);
    IF v_owner IS NOT NULL THEN
      RAISE EXCEPTION 'Bib % is already used by % this season.', p_evaluation_number, v_owner;
    END IF;
  END IF;

  INSERT INTO public.player_seasons (player_id, season_id, season_division_id, league_age, evaluation_number,
                                     registration_payment_status, registration_source, league_age_source)
  VALUES (v_player_id, p_season_id, NULL, p_league_age, p_evaluation_number, 'UNKNOWN', 'on_site', 'admin')
  RETURNING id INTO v_ps_id;

  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'registration_added_on_site', 'player_seasons', v_ps_id::text, v_reason, NULL,
          jsonb_build_object('player_id', v_player_id, 'reused_existing_player', p_player_id IS NOT NULL,
                             'season_id', p_season_id, 'league_age', p_league_age, 'evaluation_number', p_evaluation_number));
  RETURN v_ps_id;
END;
$function$;
