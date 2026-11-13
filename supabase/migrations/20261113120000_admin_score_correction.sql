-- Admin score correction (decided 2026-11-13).
-- Admins can view and change any coach's or evaluator's individual scores from Data Review, in Open, Locked or
-- Released age groups (the page warns when coaches can already see the report). Not in a closed season.
-- * admin_save_evaluation_correction(evaluation, ratings, answers, status, reason): replaces that evaluation's
--   ratings, experience answers and status in one step. A reason is required; the before and after are audited
--   ('evaluation_admin_corrected'). The scorer is not notified. The original submitted time is kept.
-- * The workflow guard now also lets an authorized correction remove a single rating or answer in a locked
--   session (it already allowed inserts and updates). Deleting the evaluation itself stays blocked.
-- The older admin_correct_evaluation (2026-11-03, required all 5 core skills, could not clear a score) is no
-- longer used by the app.

-- ---------- workflow guard (same as 20261110210000 except the DELETE branch) ----------
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
    -- An authorized admin correction (admin_save_evaluation_correction) may remove a rating or answer from a
    -- locked session. Never the evaluation itself, and never in a closed season.
    IF TG_TABLE_NAME = 'evaluations' OR v_closed OR NOT EXISTS (
      SELECT 1
      FROM private.evaluation_correction_authorizations a
      WHERE a.backend_pid = pg_catalog.pg_backend_pid()
        AND a.transaction_id = pg_catalog.txid_current()
        AND a.evaluation_id = v_eval_id
        AND a.actor_user_id = (SELECT auth.uid())
    ) THEN
      RAISE EXCEPTION 'Records cannot be deleted from a locked session or closed season.';
    END IF;
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

-- ---------- snapshot used for the audit entry ----------
CREATE OR REPLACE FUNCTION private.evaluation_snapshot(p_evaluation_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'status', e.status,
    'ratings', COALESCE((SELECT jsonb_object_agg(rc.code, r.score ORDER BY rc.sort_order) FROM public.ratings r
                         JOIN public.rating_categories rc ON rc.id = r.rating_category_id WHERE r.evaluation_id = e.id), '{}'::jsonb),
    'answers', COALESCE((SELECT jsonb_object_agg(a.question_code, a.answer) FROM public.experience_answers a
                         WHERE a.evaluation_id = e.id), '{}'::jsonb))
  FROM public.evaluations e WHERE e.id = p_evaluation_id;
$function$;

REVOKE ALL ON FUNCTION private.evaluation_snapshot(bigint) FROM PUBLIC, anon, authenticated;

-- ---------- the correction ----------
-- p_ratings: {"hitting": 4, "throwing": null, ...}  (null or missing = not scored)
-- p_answers: {"pitched_before": "yes", ...}
-- p_status:  submitted | not_evaluated | draft
-- Returns false when nothing changed (no audit entry).
CREATE OR REPLACE FUNCTION public.admin_save_evaluation_correction(
  p_evaluation_id bigint,
  p_ratings jsonb,
  p_answers jsonb,
  p_status text,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_eval record;
  v_before jsonb;
  v_after jsonb;
  v_item record;
  v_category_id bigint;
  v_reason text := btrim(COALESCE(p_reason, ''));
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Give a reason for the correction (at least 5 characters).';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('submitted', 'not_evaluated', 'draft') THEN
    RAISE EXCEPTION 'Status must be submitted, not_evaluated, or draft.';
  END IF;
  IF jsonb_typeof(COALESCE(p_ratings, '{}'::jsonb)) <> 'object' OR jsonb_typeof(COALESCE(p_answers, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Ratings and answers must be JSON objects.';
  END IF;

  SELECT e.id, e.status, e.submitted_at, e.evaluation_session_id, e.player_season_id, e.evaluator_user_id, e.evaluator_type,
         s.is_closed
  INTO v_eval
  FROM public.evaluations e
  JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
  JOIN public.seasons s ON s.id = es.season_id
  WHERE e.id = p_evaluation_id
  FOR UPDATE OF e;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evaluation not found.';
  END IF;
  IF v_eval.is_closed THEN
    RAISE EXCEPTION 'This season is closed. Reopen it before correcting scores.';
  END IF;
  IF p_status = 'not_evaluated' AND EXISTS (
    SELECT 1 FROM jsonb_each(COALESCE(p_ratings, '{}'::jsonb)) WHERE value <> 'null'::jsonb
  ) THEN
    RAISE EXCEPTION 'Clear all scores before marking the player Not Evaluated.';
  END IF;

  v_before := private.evaluation_snapshot(p_evaluation_id);

  INSERT INTO private.evaluation_correction_authorizations (backend_pid, transaction_id, evaluation_id, actor_user_id)
  VALUES (pg_catalog.pg_backend_pid(), pg_catalog.txid_current(), p_evaluation_id, v_actor)
  ON CONFLICT DO NOTHING;

  -- Same order as save_evaluation: work in draft, rewrite, then apply the final status.
  UPDATE public.evaluations SET status = 'draft', submitted_at = NULL, updated_at = now() WHERE id = p_evaluation_id;

  DELETE FROM public.ratings WHERE evaluation_id = p_evaluation_id;
  FOR v_item IN SELECT key AS code, value AS score FROM jsonb_each(COALESCE(p_ratings, '{}'::jsonb)) LOOP
    CONTINUE WHEN v_item.score = 'null'::jsonb;
    IF jsonb_typeof(v_item.score) <> 'number' OR v_item.score::text !~ '^[1-5]$' THEN
      RAISE EXCEPTION 'Score for % must be a whole number from 1 to 5.', v_item.code;
    END IF;
    SELECT rc.id INTO v_category_id FROM public.rating_categories rc WHERE rc.code = v_item.code;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown skill: %', v_item.code;
    END IF;
    INSERT INTO public.ratings (evaluation_id, rating_category_id, score)
    VALUES (p_evaluation_id, v_category_id, (v_item.score::text)::integer);
  END LOOP;

  DELETE FROM public.experience_answers WHERE evaluation_id = p_evaluation_id;
  FOR v_item IN SELECT key AS code, value AS answer FROM jsonb_each(COALESCE(p_answers, '{}'::jsonb)) LOOP
    IF v_item.code NOT IN ('pitched_before', 'caught_before', 'interested_in_pitching', 'interested_in_catching')
       OR jsonb_typeof(v_item.answer) <> 'string' OR (v_item.answer #>> '{}') NOT IN ('yes', 'no', 'unknown') THEN
      RAISE EXCEPTION 'Invalid experience answer for %.', v_item.code;
    END IF;
    INSERT INTO public.experience_answers (evaluation_id, question_code, answer)
    VALUES (p_evaluation_id, v_item.code, v_item.answer #>> '{}');
  END LOOP;

  IF p_status <> 'draft' THEN
    -- validate_evaluation_status enforces: submitted needs a core score, not evaluated has none.
    UPDATE public.evaluations
    SET status = p_status, submitted_at = CASE WHEN p_status = 'submitted' THEN v_eval.submitted_at END, updated_at = now()
    WHERE id = p_evaluation_id;
  END IF;

  DELETE FROM private.evaluation_correction_authorizations
  WHERE backend_pid = pg_catalog.pg_backend_pid() AND transaction_id = pg_catalog.txid_current()
    AND evaluation_id = p_evaluation_id AND actor_user_id = v_actor;

  v_after := private.evaluation_snapshot(p_evaluation_id);
  IF v_after = v_before THEN
    RETURN false;
  END IF;

  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'evaluation_admin_corrected', 'evaluations', p_evaluation_id::text, v_reason,
          v_before || jsonb_build_object('session_id', v_eval.evaluation_session_id, 'player_season_id', v_eval.player_season_id,
                                         'evaluator_user_id', v_eval.evaluator_user_id, 'evaluator_type', v_eval.evaluator_type),
          v_after);
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_save_evaluation_correction(bigint, jsonb, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_evaluation_correction(bigint, jsonb, jsonb, text, text) TO authenticated;
