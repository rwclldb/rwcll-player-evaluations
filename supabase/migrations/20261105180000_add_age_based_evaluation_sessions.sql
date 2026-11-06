BEGIN;

-- ============================================================
-- 1. Age-based evaluation sessions
-- ============================================================

ALTER TABLE public.evaluation_sessions
  ADD COLUMN IF NOT EXISTS season_id bigint,
  ADD COLUMN IF NOT EXISTS league_age integer;

-- Preserve existing division-based sessions.
UPDATE public.evaluation_sessions es
SET season_id = sd.season_id
FROM public.season_divisions sd
WHERE sd.id = es.season_division_id
  AND es.season_id IS NULL;

ALTER TABLE public.evaluation_sessions
  ALTER COLUMN season_division_id DROP NOT NULL,
  ALTER COLUMN season_id SET NOT NULL;

ALTER TABLE public.evaluation_sessions
  ADD CONSTRAINT evaluation_sessions_season_id_fkey
  FOREIGN KEY (season_id)
  REFERENCES public.seasons(id);

ALTER TABLE public.evaluation_sessions
  ADD CONSTRAINT evaluation_sessions_age_or_division_check
  CHECK (
    season_division_id IS NOT NULL
    OR league_age IS NOT NULL
  );

CREATE UNIQUE INDEX evaluation_sessions_season_age_unique
  ON public.evaluation_sessions (season_id, league_age)
  WHERE season_division_id IS NULL
    AND league_age IS NOT NULL;

-- ============================================================
-- 2. Registration eligibility and nullable division linkage
-- ============================================================

ALTER TABLE public.player_seasons
  ALTER COLUMN season_division_id DROP NOT NULL;

ALTER TABLE public.player_seasons
  ADD COLUMN IF NOT EXISTS registration_payment_status text
  NOT NULL DEFAULT 'UNKNOWN';

CREATE INDEX IF NOT EXISTS player_seasons_season_age_payment_idx
  ON public.player_seasons (
    season_id,
    league_age,
    registration_payment_status
  );

ALTER TABLE public.evaluations
  ALTER COLUMN season_division_id DROP NOT NULL;

-- ============================================================
-- 3. Session access helper
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_access_evaluation_session(
  p_session_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.evaluator_assignments ea
    WHERE ea.evaluation_session_id = p_session_id
      AND ea.evaluator_user_id = (SELECT auth.uid())
  );
$function$;

REVOKE ALL ON FUNCTION
  public.can_access_evaluation_session(bigint)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.can_access_evaluation_session(bigint)
  TO authenticated;

-- ============================================================
-- 4. Protect session and registration linkage
-- ============================================================

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

  IF v_registration.registration_payment_status
       NOT IN ('COMPLETED', 'Paid') THEN
    RAISE EXCEPTION
      'Only registrations with a completed payment status are eligible for evaluation.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS evaluations_validate_session_registration
  ON public.evaluations;

CREATE TRIGGER evaluations_validate_session_registration
BEFORE INSERT OR UPDATE OF
  evaluation_session_id,
  player_season_id,
  season_division_id
ON public.evaluations
FOR EACH ROW
EXECUTE FUNCTION public.validate_evaluation_session_registration();

-- ============================================================
-- 5. Update workflow guard for season-based sessions
-- Preserve locking and correction authorization protections.
-- ============================================================

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
    v_eval_id := COALESCE(NEW.id, OLD.id);
    v_session_id :=
      COALESCE(NEW.evaluation_session_id, OLD.evaluation_session_id);
  ELSE
    v_eval_id := COALESCE(NEW.evaluation_id, OLD.evaluation_id);

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

  IF TG_TABLE_NAME = 'evaluations' AND TG_OP <> 'INSERT' AND (
    NEW.evaluation_session_id IS DISTINCT FROM OLD.evaluation_session_id
    OR NEW.season_division_id IS DISTINCT FROM OLD.season_division_id
    OR NEW.player_season_id IS DISTINCT FROM OLD.player_season_id
    OR NEW.evaluator_user_id IS DISTINCT FROM OLD.evaluator_user_id
    OR NEW.evaluator_type IS DISTINCT FROM OLD.evaluator_type
  ) THEN
    RAISE EXCEPTION
      'Evaluation ownership and player/session linkage are immutable.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- 6. Preserve payment status in the import commit workflow
-- Retain the existing approval, conflict, retry, and audit rules.
-- ============================================================

CREATE OR REPLACE FUNCTION public.commit_sports_connect_import_row(
  p_row_id bigint,
  p_reason text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_row record;
  v_player_id bigint;
  v_player_season_id bigint;
  v_before jsonb;
  v_after jsonb;
  v_season_is_closed boolean;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required'
      USING ERRCODE = '42501';
  END IF;

  IF length(btrim(coalesce(p_reason, ''))) < 5
     OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION
      'Provide a commit reason between 5 and 1000 characters';
  END IF;

  SELECT r.*,
         b.season_id AS batch_season_id,
         b.import_type AS batch_import_type
  INTO v_row
  FROM public.sports_connect_import_rows AS r
  JOIN public.import_batches AS b ON b.id = r.import_batch_id
  WHERE r.id = p_row_id
  FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staged import row or its batch was not found';
  END IF;

  IF v_row.review_state = 'committed' THEN
    IF v_row.committed_player_season_id IS NULL THEN
      RAISE EXCEPTION
        'Row is marked committed but has no committed registration id';
    END IF;

    RETURN v_row.committed_player_season_id;
  END IF;

  IF v_row.review_state NOT IN ('approved_new', 'approved_match') THEN
    RAISE EXCEPTION
      'Only approved_new or approved_match rows can be committed';
  END IF;

  IF v_row.batch_import_type <> 'players' THEN
    RAISE EXCEPTION
      'Only player import batches can be committed by this function';
  END IF;

  IF v_row.batch_season_id IS NULL THEN
    RAISE EXCEPTION
      'The import batch must be associated with a season';
  END IF;

  SELECT s.is_closed
  INTO v_season_is_closed
  FROM public.seasons AS s
  WHERE s.id = v_row.batch_season_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The import batch season does not exist';
  END IF;

  IF v_season_is_closed THEN
    RAISE EXCEPTION 'Cannot commit registrations into a closed season';
  END IF;

  IF length(btrim(coalesce(v_row.first_name, ''))) = 0
     OR length(btrim(coalesce(v_row.last_name, ''))) = 0 THEN
    RAISE EXCEPTION
      'First and last name are required before committing a row';
  END IF;

  v_before := to_jsonb(v_row);

  IF v_row.review_state = 'approved_match' THEN
    IF v_row.matched_player_id IS NULL THEN
      RAISE EXCEPTION
        'An approved match must identify an existing player';
    END IF;

    PERFORM 1
    FROM public.players AS p
    WHERE p.id = v_row.matched_player_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The selected player no longer exists';
    END IF;

    v_player_id := v_row.matched_player_id;

    IF EXISTS (
      SELECT 1
      FROM public.player_seasons AS ps
      WHERE ps.player_id = v_player_id
        AND ps.season_id = v_row.batch_season_id
    ) THEN
      RAISE EXCEPTION
        'The selected player already has a registration for this season. Review the existing registration and resolve the conflicting import identifiers before committing.';
    END IF;

  ELSE
    INSERT INTO public.players (
      first_name, last_name, date_of_birth
    )
    VALUES (
      btrim(v_row.first_name),
      btrim(v_row.last_name),
      v_row.birth_date
    )
    RETURNING id INTO v_player_id;
  END IF;

  INSERT INTO public.player_seasons (
    player_id,
    season_id,
    season_division_id,
    external_registration_id,
    external_player_id,
    league_age,
    evaluation_number,
    team_id,
    registration_payment_status
  )
  VALUES (
    v_player_id,
    v_row.batch_season_id,
    NULL,
    nullif(btrim(v_row.registration_number), ''),
    nullif(btrim(v_row.external_player_id), ''),
    v_row.league_age,
    NULL,
    NULL,
    COALESCE(NULLIF(BTRIM(v_row.payment_status), ''), 'UNKNOWN')
  )
  RETURNING id INTO v_player_season_id;

  UPDATE public.sports_connect_import_rows
  SET review_state = 'committed',
      matched_player_id = v_player_id,
      committed_player_season_id = v_player_season_id
  WHERE id = p_row_id;

  SELECT to_jsonb(r)
  INTO v_after
  FROM public.sports_connect_import_rows AS r
  WHERE r.id = p_row_id;

  UPDATE public.import_batches
  SET rows_processed = rows_processed + 1
  WHERE id = v_row.import_batch_id;

  INSERT INTO public.audit_log (
    actor_user_id,
    action,
    target_table,
    target_id,
    reason,
    before_data,
    after_data
  )
  VALUES (
    v_actor,
    'sports_connect_import_row_committed',
    'sports_connect_import_rows',
    p_row_id::text,
    btrim(p_reason),
    v_before,
    jsonb_build_object(
      'staged_row', v_after,
      'player_id', v_player_id,
      'player_season_id', v_player_season_id,
      'season_id', v_row.batch_season_id
    )
  );

  RETURN v_player_season_id;
END;
$function$;

REVOKE ALL ON FUNCTION
  public.commit_sports_connect_import_row(bigint, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.commit_sports_connect_import_row(bigint, text)
  TO authenticated;

-- ============================================================
-- 7. Evaluator access policies
-- ============================================================

DROP POLICY IF EXISTS evaluation_sessions_read_assigned_season
  ON public.evaluation_sessions;

CREATE POLICY evaluation_sessions_read_assigned_session
ON public.evaluation_sessions
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR public.can_access_evaluation_session(id)
);

DROP POLICY IF EXISTS rating_categories_read_assigned_season
  ON public.rating_categories;

CREATE POLICY rating_categories_read_assigned_session
ON public.rating_categories
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.evaluator_assignments ea
    WHERE ea.evaluator_user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS ratings_read_own
  ON public.ratings;

CREATE POLICY ratings_read_own
ON public.ratings
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.evaluations e
    WHERE e.id = ratings.evaluation_id
      AND e.evaluator_user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS player_seasons_read_authorized_division
  ON public.player_seasons;

CREATE POLICY player_seasons_read_authorized_division
ON public.player_seasons
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR (
    registration_payment_status IN ('COMPLETED', 'Paid')
    AND EXISTS (
      SELECT 1
      FROM public.evaluation_sessions es
      WHERE public.can_access_evaluation_session(es.id)
        AND es.season_id = player_seasons.season_id
        AND (
          (
            es.season_division_id IS NOT NULL
            AND es.season_division_id =
                player_seasons.season_division_id
          )
          OR (
            es.season_division_id IS NULL
            AND es.league_age = player_seasons.league_age
          )
        )
    )
  )
);

DROP POLICY IF EXISTS players_read_authorized_registration
  ON public.players;

CREATE POLICY players_read_authorized_registration
ON public.players
FOR SELECT
TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.player_seasons ps
    WHERE ps.player_id = players.id
      AND ps.registration_payment_status IN ('COMPLETED', 'Paid')
      AND EXISTS (
        SELECT 1
        FROM public.evaluation_sessions es
        WHERE public.can_access_evaluation_session(es.id)
          AND es.season_id = ps.season_id
          AND (
            (
              es.season_division_id IS NOT NULL
              AND es.season_division_id = ps.season_division_id
            )
            OR (
              es.season_division_id IS NULL
              AND es.league_age = ps.league_age
            )
          )
      )
  )
);

-- ============================================================
-- 8. Protected draft-save RPC
-- Ratings are supplied as { "hitting": 3, ... }.
-- Experience answers are supplied as
-- { "pitched_before": "yes", ... }.
-- This function saves drafts only; it does not submit them.
-- ============================================================

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

  IF v_registration.registration_payment_status
       NOT IN ('COMPLETED', 'Paid') THEN
    RAISE EXCEPTION
      'This registration is not eligible for evaluation.';
  END IF;

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

REVOKE ALL ON FUNCTION
  public.save_evaluation_draft(bigint, bigint, jsonb, jsonb)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.save_evaluation_draft(bigint, bigint, jsonb, jsonb)
  TO authenticated;

COMMIT;