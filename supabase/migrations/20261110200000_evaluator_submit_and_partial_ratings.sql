-- Evaluator submit path and partial submissions (decisions 2026-11-10).
--
-- Before: evaluators could only save drafts (save_evaluation_draft). Nothing let an evaluator
-- submit or mark a player "not evaluated", and submitting required all five core skills.
--
-- After:
--   * save_evaluation(...) saves the caller's own evaluation as 'draft', 'submitted', or
--     'not_evaluated' while the session is open. Evaluators may change their own evaluation
--     (including a submitted one) until the session is locked.
--   * A submitted evaluation needs at least ONE core skill rating. Blank core skills are allowed;
--     reports flag them and never count them as zero.
--   * A not-evaluated record must have no ratings (unchanged rule).
--   * save_evaluation_draft(...) is kept for compatibility and calls save_evaluation(..., 'draft').
--
-- Local only. Do not apply to hosted Supabase without explicit approval.

-- 1. Status rule: submitted needs >= 1 core rating (was: exactly all 5).
CREATE OR REPLACE FUNCTION public.validate_evaluation_status()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_rated_core_count integer;
  v_rating_count integer;
BEGIN
  IF NEW.status = 'submitted' THEN
    NEW.submitted_at := COALESCE(NEW.submitted_at, now());

    SELECT count(DISTINCT r.rating_category_id)
      INTO v_rated_core_count
    FROM public.ratings AS r
    JOIN public.rating_categories AS c ON c.id = r.rating_category_id
    WHERE r.evaluation_id = NEW.id
      AND c.category_group = 'core';

    IF v_rated_core_count < 1 THEN
      RAISE EXCEPTION
        'Cannot submit without at least one core skill rating. Use Not Evaluated if the player was not evaluated.';
    END IF;

  ELSIF NEW.status = 'not_evaluated' THEN
    NEW.submitted_at := NULL;

    SELECT count(*) INTO v_rating_count
    FROM public.ratings
    WHERE evaluation_id = NEW.id;

    IF v_rating_count > 0 THEN
      RAISE EXCEPTION 'A not-evaluated record cannot contain skill ratings.';
    END IF;

  ELSE
    NEW.submitted_at := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Rating-change rule: a submitted evaluation must keep >= 1 core rating (was: all 5).
CREATE OR REPLACE FUNCTION public.validate_rating_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_eval_ids bigint[];
  v_eval_id bigint;
  v_status text;
  v_rated_core_count integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_eval_ids := ARRAY[NEW.evaluation_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_eval_ids := ARRAY[OLD.evaluation_id];
  ELSE
    v_eval_ids := ARRAY[OLD.evaluation_id, NEW.evaluation_id];
  END IF;

  FOREACH v_eval_id IN ARRAY v_eval_ids LOOP
    IF v_eval_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT e.status INTO v_status
    FROM public.evaluations AS e
    WHERE e.id = v_eval_id;

    IF v_status = 'not_evaluated' THEN
      RAISE EXCEPTION 'Ratings cannot be added to a not-evaluated record.';
    END IF;

    IF v_status = 'submitted' THEN
      SELECT count(DISTINCT r.rating_category_id)
        INTO v_rated_core_count
      FROM public.ratings AS r
      JOIN public.rating_categories AS c ON c.id = r.rating_category_id
      WHERE r.evaluation_id = v_eval_id
        AND c.category_group = 'core';

      IF v_rated_core_count < 1 THEN
        RAISE EXCEPTION 'A submitted evaluation must keep at least one core skill rating.';
      END IF;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$;

-- 3. Single save path for evaluators.
CREATE OR REPLACE FUNCTION public.save_evaluation(
  p_session_id bigint,
  p_player_season_id bigint,
  p_ratings jsonb DEFAULT '{}'::jsonb,
  p_experience_answers jsonb DEFAULT '{}'::jsonb,
  p_status text DEFAULT 'draft'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session record;
  v_registration record;
  v_eval_id bigint;
  v_category_id bigint;
  v_item record;
  v_answer text;
  v_has_rating boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('draft', 'submitted', 'not_evaluated') THEN
    RAISE EXCEPTION 'Status must be draft, submitted, or not_evaluated.';
  END IF;

  IF NOT public.can_access_evaluation_session(p_session_id) THEN
    RAISE EXCEPTION 'You are not assigned to this evaluation session.' USING ERRCODE = '42501';
  END IF;

  SELECT es.id, es.season_id, es.season_division_id, es.league_age, es.status, s.is_closed
  INTO v_session
  FROM public.evaluation_sessions es
  JOIN public.seasons s ON s.id = es.season_id
  WHERE es.id = p_session_id
  FOR SHARE OF es, s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evaluation session was not found.';
  END IF;

  IF v_session.status <> 'open' OR v_session.is_closed THEN
    RAISE EXCEPTION 'This evaluation session is not open.';
  END IF;

  SELECT ps.id, ps.season_id, ps.season_division_id, ps.league_age
  INTO v_registration
  FROM public.player_seasons ps
  WHERE ps.id = p_player_season_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player registration was not found.';
  END IF;

  IF v_registration.season_id <> v_session.season_id THEN
    RAISE EXCEPTION 'The player registration and session must belong to the same season.';
  END IF;

  IF v_session.season_division_id IS NOT NULL
     AND v_registration.season_division_id IS DISTINCT FROM v_session.season_division_id THEN
    RAISE EXCEPTION 'The player is not in this session division.';
  END IF;

  IF v_session.league_age IS NOT NULL
     AND v_registration.league_age IS DISTINCT FROM v_session.league_age THEN
    RAISE EXCEPTION 'The player is not in this session age group.';
  END IF;

  -- Payment status is intentionally not checked. All registrations are eligible for evaluation.

  IF jsonb_typeof(COALESCE(p_ratings, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_experience_answers, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Ratings and experience answers must be JSON objects.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM jsonb_each(COALESCE(p_ratings, '{}'::jsonb)) WHERE value <> 'null'::jsonb
  ) INTO v_has_rating;

  IF p_status = 'not_evaluated' AND v_has_rating THEN
    RAISE EXCEPTION 'Clear all ratings before marking a player Not Evaluated.';
  END IF;

  SELECT e.id INTO v_eval_id
  FROM public.evaluations e
  WHERE e.evaluation_session_id = p_session_id
    AND e.player_season_id = p_player_season_id
    AND e.evaluator_user_id = v_actor
  FOR UPDATE;

  IF FOUND THEN
    -- Work in draft state so ratings can be rewritten, then apply the requested status.
    UPDATE public.evaluations
    SET status = 'draft', submitted_at = NULL, updated_at = now()
    WHERE id = v_eval_id;
  ELSE
    INSERT INTO public.evaluations (
      evaluation_session_id, season_division_id, player_season_id,
      evaluator_user_id, evaluator_type, status
    )
    SELECT p_session_id, v_session.season_division_id, p_player_season_id,
           v_actor, ea.evaluator_type, 'draft'
    FROM public.evaluator_assignments ea
    WHERE ea.evaluation_session_id = p_session_id
      AND ea.evaluator_user_id = v_actor
    RETURNING id INTO v_eval_id;

    IF v_eval_id IS NULL THEN
      RAISE EXCEPTION 'No evaluator assignment was found.' USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM public.ratings WHERE evaluation_id = v_eval_id;

  FOR v_item IN
    SELECT key AS category_code, value AS score_json
    FROM jsonb_each(COALESCE(p_ratings, '{}'::jsonb))
  LOOP
    IF v_item.score_json = 'null'::jsonb THEN
      CONTINUE;
    END IF;

    IF jsonb_typeof(v_item.score_json) <> 'number'
       OR v_item.score_json::text !~ '^[1-5]$' THEN
      RAISE EXCEPTION 'Rating for % must be an integer from 1 to 5.', v_item.category_code;
    END IF;

    SELECT rc.id INTO v_category_id
    FROM public.rating_categories rc
    WHERE rc.code = v_item.category_code;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown rating category: %', v_item.category_code;
    END IF;

    INSERT INTO public.ratings (evaluation_id, rating_category_id, score)
    VALUES (v_eval_id, v_category_id, (v_item.score_json::text)::integer);
  END LOOP;

  DELETE FROM public.experience_answers WHERE evaluation_id = v_eval_id;

  FOR v_item IN
    SELECT key AS question_code, value AS answer_json
    FROM jsonb_each(COALESCE(p_experience_answers, '{}'::jsonb))
  LOOP
    IF v_item.question_code NOT IN (
      'pitched_before', 'caught_before', 'interested_in_pitching', 'interested_in_catching'
    ) THEN
      RAISE EXCEPTION 'Unknown experience question: %', v_item.question_code;
    END IF;

    IF jsonb_typeof(v_item.answer_json) <> 'string' THEN
      RAISE EXCEPTION 'Experience answer for % must be a string.', v_item.question_code;
    END IF;

    v_answer := v_item.answer_json #>> '{}';

    IF v_answer NOT IN ('yes', 'no', 'unknown') THEN
      RAISE EXCEPTION 'Experience answer for % must be yes, no, or unknown.', v_item.question_code;
    END IF;

    INSERT INTO public.experience_answers (evaluation_id, question_code, answer)
    VALUES (v_eval_id, v_item.question_code, v_answer);
  END LOOP;

  IF p_status <> 'draft' THEN
    -- validate_evaluation_status enforces the submit / not-evaluated rules here.
    UPDATE public.evaluations
    SET status = p_status, submitted_at = NULL, updated_at = now()
    WHERE id = v_eval_id;
  END IF;

  RETURN v_eval_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_evaluation(bigint, bigint, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_evaluation(bigint, bigint, jsonb, jsonb, text) TO authenticated;

-- 4. Keep the old entry point; it now shares the single save path.
CREATE OR REPLACE FUNCTION public.save_evaluation_draft(
  p_session_id bigint,
  p_player_season_id bigint,
  p_ratings jsonb DEFAULT '{}'::jsonb,
  p_experience_answers jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.save_evaluation(p_session_id, p_player_season_id, p_ratings, p_experience_answers, 'draft');
$function$;

REVOKE ALL ON FUNCTION public.save_evaluation_draft(bigint, bigint, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_evaluation_draft(bigint, bigint, jsonb, jsonb) TO authenticated;
