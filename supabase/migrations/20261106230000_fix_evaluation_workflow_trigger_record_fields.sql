
CREATE OR REPLACE FUNCTION public.guard_evaluation_workflow_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_session_id bigint;
  v_eval_id bigint;
  v_status text;
  v_closed boolean;
  v_correction_authorized boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'evaluation_sessions' THEN
    IF OLD.status = 'locked' AND NEW.status <> 'locked' THEN
      RAISE EXCEPTION 'A locked evaluation session cannot be reopened.';
    END IF;

    IF OLD.published_at IS NOT NULL AND
       (NEW.published_at IS DISTINCT FROM OLD.published_at
        OR NEW.published_by IS DISTINCT FROM OLD.published_by) THEN
      RAISE EXCEPTION 'Publication metadata is immutable.';
    END IF;

    IF (
      NEW.season_id IS DISTINCT FROM OLD.season_id
      OR NEW.league_age IS DISTINCT FROM OLD.league_age
      OR NEW.season_division_id IS DISTINCT FROM OLD.season_division_id
    ) AND EXISTS (
      SELECT 1
      FROM public.evaluations e
      WHERE e.evaluation_session_id = OLD.id
    ) THEN
      RAISE EXCEPTION
        'A session season, age, or division cannot change after evaluations exist.';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'evaluations' THEN
    IF TG_OP = 'DELETE' THEN
      v_eval_id := OLD.id;
      v_session_id := OLD.evaluation_session_id;
    ELSE
      v_eval_id := NEW.id;
      v_session_id := NEW.evaluation_session_id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_eval_id := OLD.evaluation_id;
    ELSE
      v_eval_id := NEW.evaluation_id;
    END IF;

    SELECT e.evaluation_session_id
    INTO v_session_id
    FROM public.evaluations e
    WHERE e.id = v_eval_id;
  END IF;

  SELECT es.status, s.is_closed
  INTO v_status, v_closed
  FROM public.evaluation_sessions es
  JOIN public.seasons s ON s.id = es.season_id
  WHERE es.id = v_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evaluation session was not found.';
  END IF;

  IF TG_OP <> 'DELETE' AND (v_status <> 'open' OR v_closed) THEN
    SELECT EXISTS (
      SELECT 1
      FROM private.evaluation_correction_authorizations a
      WHERE a.backend_pid = pg_catalog.pg_backend_pid()
        AND a.transaction_id = pg_catalog.txid_current()
        AND a.evaluation_id = v_eval_id
        AND a.actor_user_id = (SELECT auth.uid())
    )
    INTO v_correction_authorized;

    IF NOT v_correction_authorized THEN
      RAISE EXCEPTION
        'This evaluation session is locked or its season is closed.';
    END IF;

  ELSIF TG_OP = 'DELETE' AND (v_status <> 'open' OR v_closed) THEN
    RAISE EXCEPTION
      'Records cannot be deleted from a locked session or closed season.';
  END IF;

  -- Only evaluation rows have evaluation_session_id and
  -- the ownership/linkage fields checked here.
  IF TG_TABLE_NAME = 'evaluations' AND TG_OP = 'UPDATE' THEN
    IF NEW.evaluation_session_id IS DISTINCT FROM OLD.evaluation_session_id
      OR NEW.season_division_id IS DISTINCT FROM OLD.season_division_id
      OR NEW.player_season_id IS DISTINCT FROM OLD.player_season_id
      OR NEW.evaluator_user_id IS DISTINCT FROM OLD.evaluator_user_id
      OR NEW.evaluator_type IS DISTINCT FROM OLD.evaluator_type
    THEN
      RAISE EXCEPTION
        'Evaluation ownership and player/session linkage are immutable.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;
