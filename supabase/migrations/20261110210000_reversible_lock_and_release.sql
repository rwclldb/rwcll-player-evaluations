-- Two-step, reversible lock and release (decision 2026-11-10).
--
--   Open  --lock-->  Locked  --release-->  Released (locked + published_at set)
--   Open  <--unlock-- Locked <--unrelease-- Released
--
-- * Lock: evaluators can no longer change scores. Coaches still cannot see reports.
-- * Release: coaches can see the draft report for this age group. Requires Locked.
-- * Unrelease: coaches lose report access again. Session stays Locked.
-- * Unlock: evaluators can change scores again. Only allowed when not released.
-- Every change is audited. Stepping backwards (unlock, unrelease) requires a reason.
--
-- "Released" reuses the existing published_at / published_by columns. The existing check
-- constraint (published only while locked) already blocks unlocking a released session.
--
-- Local only. Do not apply to hosted Supabase without explicit approval.

-- 1. Workflow guard: allow unlock (when unreleased) and unrelease; keep every other protection.
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
    -- Locked -> open (unlock) is allowed only while not released; locked -> setup never.
    IF OLD.status = 'locked' AND NEW.status = 'setup' THEN
      RAISE EXCEPTION 'A locked evaluation session cannot return to setup. Unlock it first.';
    END IF;

    IF OLD.status = 'locked' AND NEW.status = 'open' AND NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'Unrelease the reports before unlocking this session.';
    END IF;

    -- Release metadata may be set or cleared as a whole, never rewritten in place.
    IF OLD.published_at IS NOT NULL AND NEW.published_at IS NOT NULL AND
       (NEW.published_at IS DISTINCT FROM OLD.published_at
        OR NEW.published_by IS DISTINCT FROM OLD.published_by) THEN
      RAISE EXCEPTION 'Release metadata cannot be rewritten. Unrelease first.';
    END IF;

    IF (
      NEW.season_id IS DISTINCT FROM OLD.season_id
      OR NEW.league_age IS DISTINCT FROM OLD.league_age
      OR NEW.season_division_id IS DISTINCT FROM OLD.season_division_id
    ) AND EXISTS (
      SELECT 1 FROM public.evaluations e WHERE e.evaluation_session_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'A session season, age, or division cannot change after evaluations exist.';
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

    SELECT e.evaluation_session_id INTO v_session_id
    FROM public.evaluations e
    WHERE e.id = v_eval_id;
  END IF;

  SELECT es.status, s.is_closed INTO v_status, v_closed
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
    ) INTO v_correction_authorized;

    IF NOT v_correction_authorized THEN
      RAISE EXCEPTION 'This evaluation session is locked or its season is closed.';
    END IF;

  ELSIF TG_OP = 'DELETE' AND (v_status <> 'open' OR v_closed) THEN
    RAISE EXCEPTION 'Records cannot be deleted from a locked session or closed season.';
  END IF;

  IF TG_TABLE_NAME = 'evaluations' AND TG_OP = 'UPDATE' THEN
    IF NEW.evaluation_session_id IS DISTINCT FROM OLD.evaluation_session_id
      OR NEW.season_division_id IS DISTINCT FROM OLD.season_division_id
      OR NEW.player_season_id IS DISTINCT FROM OLD.player_season_id
      OR NEW.evaluator_user_id IS DISTINCT FROM OLD.evaluator_user_id
      OR NEW.evaluator_type IS DISTINCT FROM OLD.evaluator_type
    THEN
      RAISE EXCEPTION 'Evaluation ownership and player/session linkage are immutable.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. One audited entry point for the four stage changes.
CREATE OR REPLACE FUNCTION public.change_evaluation_session_stage(
  p_session_id bigint,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
  v_session record;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_result text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  IF p_action IS NULL OR p_action NOT IN ('lock', 'unlock', 'release', 'unrelease') THEN
    RAISE EXCEPTION 'Action must be lock, unlock, release, or unrelease.';
  END IF;

  IF p_action IN ('unlock', 'unrelease') AND (v_reason IS NULL OR length(v_reason) < 5) THEN
    RAISE EXCEPTION 'Give a reason (at least 5 characters) for stepping back.';
  END IF;

  IF v_reason IS NOT NULL AND length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'Reason must be 1000 characters or fewer.';
  END IF;

  SELECT es.*, s.is_closed INTO v_session
  FROM public.evaluation_sessions es
  JOIN public.seasons s ON s.id = es.season_id
  WHERE es.id = p_session_id
  FOR UPDATE OF es;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evaluation session was not found.';
  END IF;

  IF v_session.is_closed THEN
    RAISE EXCEPTION 'Sessions in a closed season cannot change.';
  END IF;

  SELECT to_jsonb(es) INTO v_before FROM public.evaluation_sessions es WHERE es.id = p_session_id;

  IF p_action = 'lock' THEN
    IF v_session.status <> 'open' THEN
      RAISE EXCEPTION 'Only an Open session can be locked.';
    END IF;
    UPDATE public.evaluation_sessions SET status = 'locked', updated_at = now() WHERE id = p_session_id;
    v_result := 'locked';

  ELSIF p_action = 'unlock' THEN
    IF v_session.status <> 'locked' THEN
      RAISE EXCEPTION 'Only a Locked session can be unlocked.';
    END IF;
    IF v_session.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'Unrelease the reports before unlocking this session.';
    END IF;
    UPDATE public.evaluation_sessions SET status = 'open', updated_at = now() WHERE id = p_session_id;
    v_result := 'open';

  ELSIF p_action = 'release' THEN
    IF v_session.status <> 'locked' THEN
      RAISE EXCEPTION 'Lock the session before releasing reports.';
    END IF;
    IF v_session.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'Reports for this session are already released.';
    END IF;
    UPDATE public.evaluation_sessions
    SET published_at = now(), published_by = v_actor, updated_at = now()
    WHERE id = p_session_id;
    v_result := 'released';

  ELSE -- unrelease
    IF v_session.published_at IS NULL THEN
      RAISE EXCEPTION 'Reports for this session are not released.';
    END IF;
    UPDATE public.evaluation_sessions
    SET published_at = NULL, published_by = NULL, updated_at = now()
    WHERE id = p_session_id;
    v_result := 'locked';
  END IF;

  SELECT to_jsonb(es) INTO v_after FROM public.evaluation_sessions es WHERE es.id = p_session_id;

  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'evaluation_session_' || p_action, 'evaluation_sessions', p_session_id::text,
          COALESCE(v_reason, initcap(p_action) || ' session'), v_before, v_after);

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.change_evaluation_session_stage(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_evaluation_session_stage(bigint, text, text) TO authenticated;
