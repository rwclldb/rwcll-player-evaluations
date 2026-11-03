-- RWCLL Player Evaluations: restore private correction authorization infrastructure
-- Apply after the baseline, RLS event-trigger, and secure workflow migrations.
-- Intended for local migration testing only; review before any hosted use.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;
ALTER SCHEMA private OWNER TO postgres;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.evaluation_correction_authorizations (
  backend_pid integer NOT NULL,
  transaction_id bigint NOT NULL,
  evaluation_id bigint NOT NULL,
  actor_user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT evaluation_correction_authorizations_pkey
    PRIMARY KEY (backend_pid, transaction_id, evaluation_id, actor_user_id)
);
ALTER TABLE private.evaluation_correction_authorizations OWNER TO postgres;
ALTER TABLE private.evaluation_correction_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.evaluation_correction_authorizations
  FROM PUBLIC, anon, authenticated;

-- The marker is required for corrections to locked sessions/closed seasons.
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
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'evaluations' THEN
    v_eval_id := COALESCE(NEW.id, OLD.id);
    v_session_id := COALESCE(NEW.evaluation_session_id, OLD.evaluation_session_id);
  ELSE
    v_eval_id := COALESCE(NEW.evaluation_id, OLD.evaluation_id);
    SELECT e.evaluation_session_id INTO v_session_id
    FROM public.evaluations e WHERE e.id = v_eval_id;
  END IF;

  SELECT es.status, s.is_closed INTO v_status, v_closed
  FROM public.evaluation_sessions es
  JOIN public.season_divisions sd ON sd.id = es.season_division_id
  JOIN public.seasons s ON s.id = sd.season_id
  WHERE es.id = v_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evaluation session was not found.';
  END IF;

  IF TG_OP <> 'DELETE' AND (v_status <> 'open' OR v_closed) THEN
    SELECT EXISTS (
      SELECT 1 FROM private.evaluation_correction_authorizations a
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

  IF TG_TABLE_NAME = 'evaluations' AND TG_OP <> 'INSERT' AND (
    NEW.evaluation_session_id IS DISTINCT FROM OLD.evaluation_session_id OR
    NEW.season_division_id IS DISTINCT FROM OLD.season_division_id OR
    NEW.player_season_id IS DISTINCT FROM OLD.player_season_id OR
    NEW.evaluator_user_id IS DISTINCT FROM OLD.evaluator_user_id OR
    NEW.evaluator_type IS DISTINCT FROM OLD.evaluator_type
  ) THEN
    RAISE EXCEPTION 'Evaluation ownership and player/session linkage are immutable.';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_evaluation_workflow_write()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_correct_evaluation(
  p_evaluation_id bigint,
  p_status text,
  p_ratings jsonb,
  p_answers jsonb,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_eval public.evaluations%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_item jsonb;
  v_category_id bigint;
  v_score integer;
  v_question text;
  v_answer text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required.'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 8 THEN
    RAISE EXCEPTION 'A correction reason of at least 8 characters is required.';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('draft','submitted','not_evaluated') THEN
    RAISE EXCEPTION 'Invalid evaluation status.';
  END IF;
  IF p_ratings IS NOT NULL AND jsonb_typeof(p_ratings) <> 'array' THEN
    RAISE EXCEPTION 'Ratings must be a JSON array.';
  END IF;
  IF p_answers IS NOT NULL AND jsonb_typeof(p_answers) <> 'array' THEN
    RAISE EXCEPTION 'Answers must be a JSON array.';
  END IF;

  SELECT * INTO v_eval FROM public.evaluations WHERE id = p_evaluation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evaluation not found.'; END IF;

  SELECT jsonb_build_object(
    'evaluation', to_jsonb(v_eval),
    'ratings', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)
                         FROM public.ratings r WHERE r.evaluation_id = v_eval.id),'[]'::jsonb),
    'answers', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)
                         FROM public.experience_answers a WHERE a.evaluation_id = v_eval.id),'[]'::jsonb)
  ) INTO v_before;

  INSERT INTO private.evaluation_correction_authorizations
    (backend_pid, transaction_id, evaluation_id, actor_user_id)
  VALUES (pg_catalog.pg_backend_pid(), pg_catalog.txid_current(), v_eval.id, (SELECT auth.uid()));

  -- Empty arrays are no-ops. Adding ratings to a not_evaluated record requires
  -- an explicit final status that can legally contain ratings.
  IF v_eval.status = 'not_evaluated' AND p_ratings IS NOT NULL
     AND jsonb_array_length(p_ratings) > 0 THEN
    IF p_status IS NULL OR p_status = 'not_evaluated' THEN
      RAISE EXCEPTION 'Adding ratings to a not-evaluated record requires final status draft or submitted.';
    END IF;
    UPDATE public.evaluations SET status = 'draft', submitted_at = NULL, updated_at = pg_catalog.now()
    WHERE id = v_eval.id;
  END IF;

  IF p_ratings IS NOT NULL THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_ratings) LOOP
      IF jsonb_typeof(v_item) <> 'object'
         OR NOT (v_item ? 'category_code') OR NOT (v_item ? 'score')
         OR jsonb_typeof(v_item->'category_code') <> 'string'
         OR jsonb_typeof(v_item->'score') <> 'number'
         OR (v_item->>'score') !~ '^[1-5]$' THEN
        RAISE EXCEPTION 'Each rating requires a valid category_code and integer score from 1 to 5.';
      END IF;
      v_score := (v_item->>'score')::integer;
      SELECT id INTO v_category_id FROM public.rating_categories WHERE code = v_item->>'category_code';
      IF NOT FOUND THEN RAISE EXCEPTION 'Unknown rating category code: %', v_item->>'category_code'; END IF;
      INSERT INTO public.ratings(evaluation_id, rating_category_id, score)
      VALUES (v_eval.id, v_category_id, v_score)
      ON CONFLICT (evaluation_id, rating_category_id)
      DO UPDATE SET score = EXCLUDED.score, updated_at = pg_catalog.now();
    END LOOP;
  END IF;

  IF p_answers IS NOT NULL THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_answers) LOOP
      IF jsonb_typeof(v_item) <> 'object'
         OR jsonb_typeof(v_item->'question_code') <> 'string'
         OR jsonb_typeof(v_item->'answer') <> 'string' THEN
        RAISE EXCEPTION 'Each experience answer requires question_code and answer strings.';
      END IF;
      v_question := v_item->>'question_code';
      v_answer := v_item->>'answer';
      IF v_question NOT IN ('pitched_before','caught_before','interested_in_pitching','interested_in_catching')
         OR v_answer NOT IN ('yes','no','unknown') THEN
        RAISE EXCEPTION 'Invalid experience question or answer.';
      END IF;
      INSERT INTO public.experience_answers(evaluation_id, question_code, answer)
      VALUES (v_eval.id, v_question, v_answer)
      ON CONFLICT (evaluation_id, question_code)
      DO UPDATE SET answer = EXCLUDED.answer, updated_at = pg_catalog.now();
    END LOOP;
  END IF;

  IF p_status IS NOT NULL THEN
    UPDATE public.evaluations SET status = p_status,
      submitted_at = CASE WHEN p_status = 'submitted' THEN COALESCE(submitted_at, pg_catalog.now()) ELSE NULL END,
      updated_at = pg_catalog.now()
    WHERE id = v_eval.id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.evaluations e WHERE e.id = v_eval.id AND e.status = 'submitted')
     AND ((SELECT count(*) FROM public.rating_categories WHERE category_group = 'core') <> 5
       OR (SELECT count(DISTINCT r.rating_category_id) FROM public.ratings r
           JOIN public.rating_categories c ON c.id = r.rating_category_id
           WHERE r.evaluation_id = v_eval.id AND c.category_group = 'core') <> 5) THEN
    RAISE EXCEPTION 'A submitted evaluation must contain all five core ratings.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.evaluations e WHERE e.id = v_eval.id AND e.status = 'not_evaluated')
     AND EXISTS (SELECT 1 FROM public.ratings r WHERE r.evaluation_id = v_eval.id) THEN
    RAISE EXCEPTION 'A not-evaluated record cannot contain skill ratings.';
  END IF;

  SELECT jsonb_build_object(
    'evaluation', (SELECT to_jsonb(e) FROM public.evaluations e WHERE e.id = v_eval.id),
    'ratings', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.ratings r WHERE r.evaluation_id = v_eval.id),'[]'::jsonb),
    'answers', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.experience_answers a WHERE a.evaluation_id = v_eval.id),'[]'::jsonb)
  ) INTO v_after;

  INSERT INTO public.audit_log(actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES ((SELECT auth.uid()), 'admin_correct_evaluation', 'evaluations', v_eval.id::text,
          btrim(p_reason), v_before, v_after);

  DELETE FROM private.evaluation_correction_authorizations
  WHERE backend_pid = pg_catalog.pg_backend_pid()
    AND transaction_id = pg_catalog.txid_current()
    AND evaluation_id = v_eval.id
    AND actor_user_id = (SELECT auth.uid());
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_correct_evaluation(bigint,text,jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_evaluation(bigint,text,jsonb,jsonb,text) TO authenticated;

COMMIT;
