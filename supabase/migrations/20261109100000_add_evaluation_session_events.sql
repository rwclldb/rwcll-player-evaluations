BEGIN;

-- Event scheduling for age-based evaluation sessions.
-- Enforce the agreed age range for age-based sessions while preserving null ages
-- on legacy division-based sessions. NOT VALID avoids blocking deployment if an
-- old test database already contains out-of-range legacy data; new writes are checked.
ALTER TABLE public.evaluation_sessions
  ADD CONSTRAINT evaluation_sessions_league_age_range_check
  CHECK (league_age IS NULL OR league_age BETWEEN 7 AND 16) NOT VALID;

-- One primary event per session; any number of makeup events.
CREATE TABLE public.evaluation_session_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evaluation_session_id bigint NOT NULL
    REFERENCES public.evaluation_sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN ('primary', 'makeup')),
  event_date date NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  location text NOT NULL CHECK (length(btrim(location)) > 0),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evaluation_session_events_time_range_check CHECK (end_time > start_time)
);

CREATE UNIQUE INDEX evaluation_session_events_one_primary_per_session
  ON public.evaluation_session_events (evaluation_session_id)
  WHERE event_type = 'primary';

CREATE INDEX evaluation_session_events_session_date_idx
  ON public.evaluation_session_events (evaluation_session_id, event_date, start_time);

ALTER TABLE public.evaluation_session_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evaluation_session_events FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.evaluation_session_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.evaluation_session_events_id_seq TO authenticated;

CREATE POLICY evaluation_session_events_admin_manage
  ON public.evaluation_session_events
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY evaluation_session_events_assigned_read
  ON public.evaluation_session_events
  FOR SELECT TO authenticated
  USING (public.can_access_evaluation_session(evaluation_session_id));

-- Keep event details immutable once a session is open or its season is closed.
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

  IF v_status <> 'setup' OR v_season_closed THEN
    RAISE EXCEPTION 'Event schedules can only be changed while the session is in setup and the season is open.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER evaluation_session_events_guard_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.evaluation_session_events
  FOR EACH ROW EXECUTE FUNCTION public.guard_evaluation_session_event_write();

-- Opening is blocked at the database layer unless the session has a primary event
-- and at least one evaluator assignment. Server actions also check these conditions
-- to provide a useful UI error message.
CREATE OR REPLACE FUNCTION public.require_scheduled_evaluator_before_session_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_season_closed boolean;
BEGIN
  IF OLD.status = 'setup' AND NEW.status = 'open' THEN
    SELECT s.is_closed
      INTO v_season_closed
    FROM public.seasons s
    WHERE s.id = NEW.season_id;

    IF v_season_closed IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'A session in a closed season cannot be opened.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.evaluation_session_events e
      WHERE e.evaluation_session_id = NEW.id
        AND e.event_type = 'primary'
    ) THEN
      RAISE EXCEPTION 'A primary evaluation event must be scheduled before opening the session.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.evaluator_assignments a
      WHERE a.evaluation_session_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'At least one evaluator must be assigned before opening the session.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER evaluation_sessions_require_scheduled_evaluator
  BEFORE UPDATE OF status ON public.evaluation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.require_scheduled_evaluator_before_session_open();

COMMIT;
