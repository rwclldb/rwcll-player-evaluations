-- Test dates (decided 2026-11-20). For testing before, during and after evaluation day without a fake clock: an admin
-- moves every event of a season by the same number of days so that a chosen day is today (Pacific), and later puts
-- the real dates back. The app shows the tool only when ENABLE_TEST_TOOLS=true; here it is admin-only and audited,
-- and it never touches a closed season.
--
-- * test_date_backups: the season's real event dates, saved the first time the tool moves them (one row per season).
--   Every later move is counted from these, so pressing buttons again never drifts the schedule.
-- * admin_test_set_dates(season, mode): modes
--     'evaluation_day' - the earliest main (primary) event is today;
--     'makeup_day'     - the earliest makeup event is today (main events are before it);
--     'week_before'    - the earliest main event is a week from today;
--     'after'          - the last event was yesterday.
--   Returns the number of days moved. Age-group status (Setup / Open / Locked) doesn't change.
-- * admin_test_restore_dates(season): puts the saved dates back and forgets them.
-- * admin_test_dates_status(season): the events with their real and current dates, and whether dates are moved.
-- * admin_test_dates_moved(): seasons whose dates are moved right now (the admin header's warning strip).
-- * The roadmap stage still goes by the age groups first (any locked = After evaluations, all released = the end), so
--   dates only change it while age groups are in Setup or Open.
-- * guard_evaluation_session_event_write: lets these functions change events of any age-group status (they set a
--   transaction-local flag); everything else still needs Setup, and a closed season is always refused.

CREATE TABLE public.test_date_backups (
  season_id bigint PRIMARY KEY REFERENCES public.seasons(id) ON DELETE CASCADE,
  events jsonb NOT NULL,              -- [{id, event_date}] as they were before the first move
  saved_at timestamptz NOT NULL DEFAULT now(),
  saved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  mode text,
  shifted_days integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.test_date_backups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.test_date_backups FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_evaluation_session_event_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_session_id bigint;
  v_status text;
  v_season_closed boolean;
BEGIN
  v_session_id := CASE WHEN TG_OP = 'DELETE'
    THEN OLD.evaluation_session_id ELSE NEW.evaluation_session_id END;

  SELECT es.status, s.is_closed
    INTO v_status, v_season_closed
  FROM public.evaluation_sessions es
  JOIN public.seasons s ON s.id = es.season_id
  WHERE es.id = v_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evaluation session was not found.';
  END IF;

  -- Test dates move event dates in any status (only an UPDATE of the date, set by admin_test_* below).
  IF v_season_closed OR (v_status <> 'setup' AND NOT (TG_OP = 'UPDATE' AND current_setting('rwcll.test_dates', true) = 'on')) THEN
    RAISE EXCEPTION 'Event schedules can only be changed while the session is in setup and the season is open.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE FUNCTION private.league_today() RETURNS date
LANGUAGE sql STABLE SET search_path TO 'pg_catalog' AS $$
  SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date;
$$;
REVOKE ALL ON FUNCTION private.league_today() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.assert_test_dates_admin(p_season_id bigint) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only league admins can use test dates.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.seasons WHERE id = p_season_id) THEN RAISE EXCEPTION 'Season not found.'; END IF;
  IF (SELECT is_closed FROM public.seasons WHERE id = p_season_id) THEN
    RAISE EXCEPTION 'This season is closed. Test dates only work on an open season.';
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.assert_test_dates_admin(bigint) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_test_set_dates(p_season_id bigint, p_mode text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_backup public.test_date_backups;
  v_anchor date;
  v_target date;
  v_days integer;
  v_moved integer;
BEGIN
  PERFORM private.assert_test_dates_admin(p_season_id);
  IF p_mode NOT IN ('evaluation_day', 'makeup_day', 'week_before', 'after') THEN
    RAISE EXCEPTION 'Unknown test date: %', p_mode;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.evaluation_session_events e JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
                 WHERE es.season_id = p_season_id) THEN
    RAISE EXCEPTION 'This season has no evaluation dates yet. Add them on Sessions first.';
  END IF;

  -- Save the real dates the first time; later moves are counted from them.
  SELECT * INTO v_backup FROM public.test_date_backups WHERE season_id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.test_date_backups (season_id, events, saved_by)
    SELECT p_season_id, jsonb_agg(jsonb_build_object('id', e.id, 'event_date', e.event_date) ORDER BY e.id), auth.uid()
    FROM public.evaluation_session_events e JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
    WHERE es.season_id = p_season_id
    RETURNING * INTO v_backup;
  END IF;

  -- Real dates (from the backup; events added since then use their current date).
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.test_real_dates (id bigint PRIMARY KEY, event_type text, real_date date) ON COMMIT DROP;
  TRUNCATE pg_temp.test_real_dates;
  INSERT INTO pg_temp.test_real_dates
  SELECT e.id, e.event_type, COALESCE((b.x->>'event_date')::date, e.event_date)
  FROM public.evaluation_session_events e
  JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
  LEFT JOIN LATERAL (SELECT x FROM jsonb_array_elements(v_backup.events) x WHERE (x->>'id')::bigint = e.id) b ON true
  WHERE es.season_id = p_season_id;

  v_target := private.league_today();
  IF p_mode = 'evaluation_day' THEN
    SELECT min(real_date) INTO v_anchor FROM pg_temp.test_real_dates WHERE event_type = 'primary';
  ELSIF p_mode = 'makeup_day' THEN
    SELECT min(real_date) INTO v_anchor FROM pg_temp.test_real_dates WHERE event_type = 'makeup';
    IF v_anchor IS NULL THEN RAISE EXCEPTION 'This season has no makeup dates. Add one on Sessions first.'; END IF;
  ELSIF p_mode = 'week_before' THEN
    SELECT min(real_date) INTO v_anchor FROM pg_temp.test_real_dates WHERE event_type = 'primary';
    v_target := v_target + 7;
  ELSE
    SELECT max(real_date) INTO v_anchor FROM pg_temp.test_real_dates;
    v_target := v_target - 1;
  END IF;
  IF v_anchor IS NULL THEN RAISE EXCEPTION 'This season has no main evaluation dates. Add them on Sessions first.'; END IF;
  v_days := v_target - v_anchor;

  PERFORM set_config('rwcll.test_dates', 'on', true);
  UPDATE public.evaluation_session_events e SET event_date = r.real_date + v_days
  FROM pg_temp.test_real_dates r WHERE r.id = e.id AND e.event_date IS DISTINCT FROM r.real_date + v_days;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  PERFORM set_config('rwcll.test_dates', 'off', true);

  UPDATE public.test_date_backups SET mode = p_mode, shifted_days = v_days, updated_at = now() WHERE season_id = p_season_id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (auth.uid(), 'test_dates_set', 'seasons', p_season_id::text,
          jsonb_build_object('mode', p_mode, 'shifted_days', v_days, 'events_moved', v_moved, 'today', private.league_today()));
  RETURN v_days;
END $$;

CREATE FUNCTION public.admin_test_restore_dates(p_season_id bigint) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_backup public.test_date_backups;
  v_moved integer;
BEGIN
  PERFORM private.assert_test_dates_admin(p_season_id);
  SELECT * INTO v_backup FROM public.test_date_backups WHERE season_id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The dates of this season haven''t been moved.'; END IF;
  PERFORM set_config('rwcll.test_dates', 'on', true);
  UPDATE public.evaluation_session_events e SET event_date = (x->>'event_date')::date
  FROM jsonb_array_elements(v_backup.events) x
  WHERE e.id = (x->>'id')::bigint AND e.event_date IS DISTINCT FROM (x->>'event_date')::date;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  PERFORM set_config('rwcll.test_dates', 'off', true);
  DELETE FROM public.test_date_backups WHERE season_id = p_season_id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, after_data)
  VALUES (auth.uid(), 'test_dates_restored', 'seasons', p_season_id::text, jsonb_build_object('events_moved', v_moved));
  RETURN v_moved;
END $$;

CREATE FUNCTION public.admin_test_dates_status(p_season_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
DECLARE
  v_backup public.test_date_backups;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only league admins can use test dates.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_backup FROM public.test_date_backups WHERE season_id = p_season_id;
  RETURN jsonb_build_object(
    'today', private.league_today(),
    'moved', v_backup.season_id IS NOT NULL,
    'mode', v_backup.mode, 'shifted_days', v_backup.shifted_days,
    'saved_at', v_backup.saved_at, 'saved_by', CASE WHEN v_backup.saved_by IS NOT NULL THEN private.person_name(v_backup.saved_by) END,
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'league_age', es.league_age, 'status', es.status, 'event_type', e.event_type,
               'event_date', e.event_date, 'start_time', e.start_time,
               'real_date', COALESCE((SELECT (x->>'event_date')::date FROM jsonb_array_elements(v_backup.events) x WHERE (x->>'id')::bigint = e.id), e.event_date))
             ORDER BY e.event_date, e.start_time, es.league_age)
      FROM public.evaluation_session_events e JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
      WHERE es.season_id = p_season_id), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.admin_test_set_dates(bigint, text), public.admin_test_restore_dates(bigint), public.admin_test_dates_status(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_test_set_dates(bigint, text), public.admin_test_restore_dates(bigint), public.admin_test_dates_status(bigint) TO authenticated;

-- Seasons whose dates are moved right now (for a warning strip in the admin header while test tools are on).
CREATE FUNCTION public.admin_test_dates_moved() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('season_id', b.season_id, 'season', s.name, 'mode', b.mode, 'shifted_days', b.shifted_days) ORDER BY s.start_date DESC), '[]'::jsonb)
  FROM public.test_date_backups b JOIN public.seasons s ON s.id = b.season_id
  WHERE public.is_admin();
$$;
REVOKE ALL ON FUNCTION public.admin_test_dates_moved() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_test_dates_moved() TO authenticated;
