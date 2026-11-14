-- "View as": an admin previews the app as a coach, independent evaluator or registrar, read-only.
--
-- 1. On People, an admin asks for a preview of someone (admin_create_preview). The app makes a one-time sign-in link
--    for that person; this records the link (only a SHA-256 of its token) so it can be recognised.
-- 2. The admin opens the link, ideally in a private window. /auth/confirm signs in as that person and calls
--    start_preview_from_token, which marks this sign-in session (the JWT's session_id) as a preview. Because it is
--    keyed on the token, the session becomes a preview even if the link's "next" address is edited.
-- 3. While a session is a preview: proxy.ts refuses every server action (all of the app's writes), and
--    save_evaluation / save_private_note / save_shared_note refuse too, so scores and notes can't be written even by
--    calling the database directly. "End preview" (end_preview) signs the window out.
-- Every step is audited. Admin accounts and your own account can't be previewed.

CREATE TABLE public.preview_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  token_sha text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  used_at timestamptz,
  -- Signing in through the link updates last_sign_in_at; the preview puts the real value back.
  prior_last_sign_in_at timestamptz
);
CREATE TABLE public.preview_sessions (
  session_id uuid PRIMARY KEY,
  admin_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
-- Only the functions below touch these tables.
ALTER TABLE public.preview_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preview_sessions ENABLE ROW LEVEL SECURITY;

-- Is the current sign-in session an (unended) admin preview?
CREATE FUNCTION private.in_preview() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.preview_sessions p
                 WHERE p.session_id::text = (auth.jwt() ->> 'session_id') AND p.ended_at IS NULL);
$$;
REVOKE ALL ON FUNCTION private.in_preview() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_create_preview(p_target_user_id uuid, p_token_hash text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_target_user_id = v_actor THEN RAISE EXCEPTION 'You can''t preview your own account.'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_target_user_id AND role_name = 'administrator') THEN
    RAISE EXCEPTION 'Admin accounts can''t be previewed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_target_user_id) THEN
    RAISE EXCEPTION 'This account has no role yet, so there is nothing to preview.';
  END IF;
  -- A sign-in link would also accept a pending invitation, so only accounts that have signed in can be previewed.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id AND last_sign_in_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This person hasn''t signed in yet. Preview works once they have.';
  END IF;
  IF length(COALESCE(p_token_hash, '')) < 16 THEN RAISE EXCEPTION 'Invalid preview link.'; END IF;
  INSERT INTO public.preview_requests (admin_user_id, target_user_id, token_sha, prior_last_sign_in_at)
  VALUES (v_actor, p_target_user_id, encode(sha256(convert_to(p_token_hash, 'UTF8')), 'hex'),
          (SELECT last_sign_in_at FROM auth.users WHERE id = p_target_user_id));
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason)
  VALUES (v_actor, 'account_preview_link_created', 'auth.users', p_target_user_id::text, 'View as (read-only preview)');
END;
$$;

-- Called right after a sign-in link is used. Returns true when the link was a preview link for this account.
CREATE FUNCTION public.start_preview_from_token(p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_req record;
  v_session uuid := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
BEGIN
  IF auth.uid() IS NULL OR v_session IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_req FROM public.preview_requests
  WHERE token_sha = encode(sha256(convert_to(COALESCE(p_token_hash, ''), 'UTF8')), 'hex')
  FOR UPDATE;
  IF NOT FOUND OR v_req.target_user_id <> auth.uid() THEN RETURN false; END IF;
  -- Even an expired or reused preview link must not leave a normal session behind: mark it read-only either way.
  INSERT INTO public.preview_sessions (session_id, admin_user_id, target_user_id)
  VALUES (v_session, v_req.admin_user_id, v_req.target_user_id)
  ON CONFLICT (session_id) DO NOTHING;
  UPDATE public.preview_requests SET used_at = COALESCE(used_at, now()) WHERE id = v_req.id;
  -- The admin's preview is not the person signing in.
  UPDATE auth.users SET last_sign_in_at = v_req.prior_last_sign_in_at WHERE id = v_req.target_user_id AND v_req.prior_last_sign_in_at IS NOT NULL;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason)
  VALUES (v_req.admin_user_id, 'account_preview_started', 'auth.users', v_req.target_user_id::text, 'View as (read-only preview)');
  RETURN true;
END;
$$;

-- For the banner: who is being previewed and by whom, or null when this is a normal session.
CREATE FUNCTION public.current_preview()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT jsonb_build_object(
    'target_name', COALESCE(NULLIF(tp.display_name, ''), tu.email),
    'admin_name', COALESCE(NULLIF(ap.display_name, ''), au.email))
  FROM public.preview_sessions p
  JOIN auth.users tu ON tu.id = p.target_user_id
  LEFT JOIN public.user_profiles tp ON tp.user_id = p.target_user_id
  LEFT JOIN auth.users au ON au.id = p.admin_user_id
  LEFT JOIN public.user_profiles ap ON ap.user_id = p.admin_user_id
  WHERE p.session_id::text = (auth.jwt() ->> 'session_id') AND p.ended_at IS NULL;
$$;

CREATE FUNCTION public.end_preview()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  UPDATE public.preview_sessions SET ended_at = now()
  WHERE session_id::text = (auth.jwt() ->> 'session_id') AND ended_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.admin_create_preview(uuid, text), public.start_preview_from_token(text),
  public.current_preview(), public.end_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_preview(uuid, text), public.start_preview_from_token(text),
  public.current_preview(), public.end_preview() TO authenticated;

-- ---- generated: score and note saves refuse preview sessions ----
CREATE OR REPLACE FUNCTION public.save_evaluation(p_session_id bigint, p_player_season_id bigint, p_ratings jsonb DEFAULT '{}'::jsonb, p_experience_answers jsonb DEFAULT '{}'::jsonb, p_status text DEFAULT 'draft'::text)
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
  IF private.in_preview() THEN
    RAISE EXCEPTION 'Admin preview is read-only: nothing is saved.' USING ERRCODE = '42501';
  END IF;
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

CREATE OR REPLACE FUNCTION public.save_private_note(p_player_season_id bigint, p_note_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_season_id bigint;
  v_text text := btrim(COALESCE(p_note_text, ''));
BEGIN
  IF private.in_preview() THEN
    RAISE EXCEPTION 'Admin preview is read-only: nothing is saved.' USING ERRCODE = '42501';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT ps.season_id INTO v_season_id FROM public.player_seasons ps WHERE ps.id = p_player_season_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player registration was not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_actor AND ur.role_name = 'coach' AND ur.season_id = v_season_id
  ) THEN
    RAISE EXCEPTION 'Private notes are for coaches in this season.' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_text) > 2000 THEN
    RAISE EXCEPTION 'Notes can be at most 2000 characters.';
  END IF;

  IF v_text = '' THEN
    DELETE FROM public.private_notes WHERE player_season_id = p_player_season_id AND author_user_id = v_actor;
  ELSE
    INSERT INTO public.private_notes (player_season_id, author_user_id, note_text)
    VALUES (p_player_season_id, v_actor, v_text)
    ON CONFLICT (player_season_id, author_user_id)
    DO UPDATE SET note_text = EXCLUDED.note_text, updated_at = now()
    WHERE public.private_notes.note_text IS DISTINCT FROM EXCLUDED.note_text;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_shared_note(p_session_id bigint, p_player_season_id bigint, p_note_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_eval record;
  v_text text := btrim(COALESCE(p_note_text, ''));
BEGIN
  IF private.in_preview() THEN
    RAISE EXCEPTION 'Admin preview is read-only: nothing is saved.' USING ERRCODE = '42501';
  END IF;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT e.id, e.evaluator_type INTO v_eval
  FROM public.evaluations e
  WHERE e.evaluation_session_id = p_session_id
    AND e.player_season_id = p_player_season_id
    AND e.evaluator_user_id = v_actor;

  IF NOT FOUND THEN
    IF v_text = '' THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Save the evaluation before adding a shared note.';
  END IF;

  IF v_eval.evaluator_type <> 'independent_evaluator' THEN
    RAISE EXCEPTION 'Shared notes are for independent evaluators. Coaches keep private notes.' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_text) > 2000 THEN
    RAISE EXCEPTION 'Notes can be at most 2000 characters.';
  END IF;

  IF v_text = '' THEN
    DELETE FROM public.evaluator_notes WHERE evaluation_id = v_eval.id;
  ELSE
    INSERT INTO public.evaluator_notes (evaluation_id, author_user_id, note_text)
    VALUES (v_eval.id, v_actor, v_text)
    ON CONFLICT (evaluation_id)
    DO UPDATE SET note_text = EXCLUDED.note_text, updated_at = now()
    WHERE public.evaluator_notes.note_text IS DISTINCT FROM EXCLUDED.note_text;
  END IF;
END;
$function$;

