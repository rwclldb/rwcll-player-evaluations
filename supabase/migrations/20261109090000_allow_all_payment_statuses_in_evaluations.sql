BEGIN;

-- All registration payment statuses are eligible for evaluation; payment status is not an evaluation gate.
-- Recreate the existing protected functions so database-side checks match the evaluator UI.
CREATE OR REPLACE FUNCTION public.validate_evaluation_session_registration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_session record;
  v_registration record;
BEGIN
  SELECT es.id, es.season_id, es.season_division_id,
         es.league_age, es.status
  INTO v_session
  FROM public.evaluation_sessions es
  WHERE es.id = NEW.evaluation_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evaluation session was not found.';
  END IF;

  SELECT ps.id, ps.season_id, ps.season_division_id,
         ps.league_age, ps.registration_payment_status
  INTO v_registration
  FROM public.player_seasons ps
  WHERE ps.id = NEW.player_season_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player registration was not found.';
  END IF;

  IF v_registration.season_id <> v_session.season_id THEN
    RAISE EXCEPTION
      'The player registration and evaluation session must belong to the same season.';
  END IF;

  IF v_session.season_division_id IS NOT NULL
     AND v_registration.season_division_id
         IS DISTINCT FROM v_session.season_division_id THEN
    RAISE EXCEPTION
      'The player registration must belong to the session division.';
  END IF;

  IF v_session.league_age IS NOT NULL
     AND v_registration.league_age
         IS DISTINCT FROM v_session.league_age THEN
    RAISE EXCEPTION
      'The player registration age does not match the evaluation session.';
  END IF;

  -- Payment status is intentionally not checked. Paid, Pending, Unpaid, and Unknown registrations are all rateable.

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_evaluation_draft(
  p_session_id bigint,
  p_player_season_id bigint,
  p_ratings jsonb DEFAULT '{}'::jsonb,
  p_experience_answers jsonb DEFAULT '{}'::jsonb
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
  v_existing_status text;
  v_category_id bigint;
  v_item record;
  v_answer text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_access_evaluation_session(p_session_id) THEN
    RAISE EXCEPTION 'You are not assigned to this evaluation session.'
      USING ERRCODE = '42501';
  END IF;

  SELECT es.id, es.season_id, es.season_division_id,
         es.league_age, es.status, s.is_closed
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

  SELECT ps.id, ps.season_id, ps.season_division_id,
         ps.league_age, ps.registration_payment_status
  INTO v_registration
  FROM public.player_seasons ps
  WHERE ps.id = p_player_season_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player registration was not found.';
  END IF;

  IF v_registration.season_id <> v_session.season_id THEN
    RAISE EXCEPTION
      'The player registration and session must belong to the same season.';
  END IF;

  IF v_session.season_division_id IS NOT NULL
     AND v_registration.season_division_id
         IS DISTINCT FROM v_session.season_division_id THEN
    RAISE EXCEPTION 'The player is not in this session division.';
  END IF;

  IF v_session.league_age IS NOT NULL
     AND v_registration.league_age
         IS DISTINCT FROM v_session.league_age THEN
    RAISE EXCEPTION 'The player is not in this session age group.';
  END IF;

  -- Payment status is intentionally not checked. All registrations are eligible for evaluation.

  IF jsonb_typeof(COALESCE(p_ratings, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(
       COALESCE(p_experience_answers, '{}'::jsonb)
     ) <> 'object' THEN
    RAISE EXCEPTION
      'Ratings and experience answers must be JSON objects.';
  END IF;

  SELECT e.id, e.status
  INTO v_eval_id, v_existing_status
  FROM public.evaluations e
  WHERE e.evaluation_session_id = p_session_id
    AND e.player_season_id = p_player_season_id
    AND e.evaluator_user_id = v_actor
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_status <> 'draft' THEN
      RAISE EXCEPTION
        'Only draft evaluations can be edited.';
    END IF;

    UPDATE public.evaluations
    SET updated_at = now()
    WHERE id = v_eval_id;
  ELSE
    INSERT INTO public.evaluations (
      evaluation_session_id,
      season_division_id,
      player_season_id,
      evaluator_user_id,
      evaluator_type,
      status
    )
    SELECT
      p_session_id,
      v_session.season_division_id,
      p_player_season_id,
      v_actor,
      ea.evaluator_type,
      'draft'
    FROM public.evaluator_assignments ea
    WHERE ea.evaluation_session_id = p_session_id
      AND ea.evaluator_user_id = v_actor
    RETURNING id INTO v_eval_id;

    IF v_eval_id IS NULL THEN
      RAISE EXCEPTION 'No evaluator assignment was found.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM public.ratings
  WHERE evaluation_id = v_eval_id;

  FOR v_item IN
    SELECT key AS category_code, value AS score_json
    FROM jsonb_each(COALESCE(p_ratings, '{}'::jsonb))
  LOOP
    IF v_item.score_json = 'null'::jsonb THEN
      CONTINUE;
    END IF;

    IF jsonb_typeof(v_item.score_json) <> 'number'
       OR v_item.score_json::text !~ '^[1-5]$' THEN
      RAISE EXCEPTION
        'Rating for % must be an integer from 1 to 5.',
        v_item.category_code;
    END IF;

    SELECT rc.id
    INTO v_category_id
    FROM public.rating_categories rc
    WHERE rc.code = v_item.category_code;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown rating category: %',
        v_item.category_code;
    END IF;

    INSERT INTO public.ratings (
      evaluation_id, rating_category_id, score
    )
    VALUES (
      v_eval_id, v_category_id, (v_item.score_json::text)::integer
    );
  END LOOP;

  DELETE FROM public.experience_answers
  WHERE evaluation_id = v_eval_id;

  FOR v_item IN
    SELECT key AS question_code, value AS answer_json
    FROM jsonb_each(COALESCE(p_experience_answers, '{}'::jsonb))
  LOOP
    IF v_item.question_code NOT IN (
      'pitched_before',
      'caught_before',
      'interested_in_pitching',
      'interested_in_catching'
    ) THEN
      RAISE EXCEPTION 'Unknown experience question: %',
        v_item.question_code;
    END IF;

    IF jsonb_typeof(v_item.answer_json) <> 'string' THEN
      RAISE EXCEPTION
        'Experience answer for % must be a string.',
        v_item.question_code;
    END IF;

    v_answer := v_item.answer_json #>> '{}';

    IF v_answer NOT IN ('yes', 'no', 'unknown') THEN
      RAISE EXCEPTION
        'Experience answer for % must be yes, no, or unknown.',
        v_item.question_code;
    END IF;

    INSERT INTO public.experience_answers (
      evaluation_id, question_code, answer
    )
    VALUES (
      v_eval_id, v_item.question_code, v_answer
    );
  END LOOP;

  RETURN v_eval_id;
END;
$function$;

DROP POLICY IF EXISTS player_seasons_read_authorized_division ON public.player_seasons;
CREATE POLICY player_seasons_read_authorized_division
ON public.player_seasons
FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR (
    TRUE
    AND EXISTS (
      SELECT 1 FROM public.evaluation_sessions es
      WHERE public.can_access_evaluation_session(es.id)
        AND es.season_id = player_seasons.season_id
        AND (
          (es.season_division_id IS NOT NULL AND es.season_division_id = player_seasons.season_division_id)
          OR (es.season_division_id IS NULL AND es.league_age = player_seasons.league_age)
        )
    )
  )
);

DROP POLICY IF EXISTS players_read_authorized_registration ON public.players;
CREATE POLICY players_read_authorized_registration
ON public.players
FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.player_seasons ps
    WHERE ps.player_id = players.id
      AND TRUE
      AND EXISTS (
        SELECT 1 FROM public.evaluation_sessions es
        WHERE public.can_access_evaluation_session(es.id)
          AND es.season_id = ps.season_id
          AND (
            (es.season_division_id IS NOT NULL AND es.season_division_id = ps.season_division_id)
            OR (es.season_division_id IS NULL AND es.league_age = ps.league_age)
          )
      )
  )
);

COMMIT;
