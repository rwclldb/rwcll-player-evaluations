-- Player notes (decided 2026-11-11, see docs/DECISIONS.md "Player notes").
--
-- * Coach private notes (public.private_notes): one note per coach per player registration (season).
--   Only the author can read or change it, in the app and through the API. Admins cannot read them in the
--   app. Editable anytime, including after lock and after the season closes. Not carried into later seasons
--   (a registration belongs to one season).
-- * Independent-evaluator shared notes (public.evaluator_notes): one note per evaluation, so the existing
--   workflow trigger stops changes when the session locks. Visible to the author, to admins (with the
--   author's name), and to coaches once the age group is released (author hidden). Notes on drafts are
--   not shown to coaches.
-- * Every read and write goes through the functions below. The tables have no policies for
--   coaches or evaluators.

-- ---------- tables ----------
ALTER TABLE public.private_notes
  ADD CONSTRAINT private_notes_one_per_author UNIQUE (player_season_id, author_user_id),
  ADD CONSTRAINT private_notes_text_check CHECK (char_length(btrim(note_text)) BETWEEN 1 AND 2000);

ALTER TABLE public.evaluator_notes
  ADD CONSTRAINT evaluator_notes_text_check CHECK (char_length(btrim(note_text)) BETWEEN 1 AND 2000);

-- Private notes are author-only, so admins lose their blanket table policy.
DROP POLICY IF EXISTS "admins_manage_all" ON public.private_notes;
REVOKE ALL ON TABLE public.private_notes FROM authenticated;

-- ---------- coach private note ----------
-- Empty or blank text deletes the note.
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

REVOKE ALL ON FUNCTION public.save_private_note(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_private_note(bigint, text) TO authenticated;

-- ---------- independent-evaluator shared note ----------
-- Attached to the caller's own evaluation of the player in this session, so save the evaluation first.
-- The workflow trigger on evaluator_notes rejects changes once the session is locked.
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

REVOKE ALL ON FUNCTION public.save_shared_note(bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_shared_note(bigint, bigint, text) TO authenticated;

-- ---------- notes the caller may see for one age-group session ----------
-- kind 'private': the caller's own coach note (never anyone else's, not even for admins).
-- kind 'shared' : independent-evaluator notes. Admins: all, with the author's name. The author: their own.
--                 Coaches in the season: submitted / not-evaluated ones, once the session is released,
--                 labelled only "Independent evaluator".
CREATE OR REPLACE FUNCTION public.player_notes(p_session_id bigint)
RETURNS TABLE (player_season_id bigint, kind text, note_text text, author_label text, is_mine boolean, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH s AS (
    SELECT es.id, es.season_id, es.league_age, es.published_at IS NOT NULL AS released
    FROM public.evaluation_sessions es
    WHERE es.id = p_session_id AND es.league_age IS NOT NULL
  ),
  viewer AS (
    SELECT auth.uid() AS uid,
           public.is_admin() AS admin,
           EXISTS (SELECT 1 FROM public.user_roles ur, s
                   WHERE ur.user_id = auth.uid() AND ur.role_name = 'coach' AND ur.season_id = s.season_id) AS coach
  )
  SELECT pn.player_season_id, 'private', pn.note_text, 'You', true, pn.updated_at
  FROM public.private_notes pn
  JOIN public.player_seasons ps ON ps.id = pn.player_season_id
  JOIN s ON s.season_id = ps.season_id AND s.league_age = ps.league_age
  CROSS JOIN viewer v
  WHERE pn.author_user_id = v.uid
  UNION ALL
  SELECT e.player_season_id, 'shared', n.note_text,
         CASE
           WHEN n.author_user_id = v.uid THEN 'You'
           WHEN v.admin THEN COALESCE(NULLIF(btrim(up.display_name), ''), au.email::text, 'Independent evaluator')
           ELSE 'Independent evaluator'
         END,
         n.author_user_id = v.uid, n.updated_at
  FROM public.evaluator_notes n
  JOIN public.evaluations e ON e.id = n.evaluation_id
  JOIN s ON s.id = e.evaluation_session_id
  CROSS JOIN viewer v
  LEFT JOIN public.user_profiles up ON up.user_id = n.author_user_id
  LEFT JOIN auth.users au ON au.id = n.author_user_id
  WHERE e.evaluator_type = 'independent_evaluator'
    AND (
      n.author_user_id = v.uid
      OR v.admin
      OR (v.coach AND s.released AND e.status IN ('submitted', 'not_evaluated'))
    )
  ORDER BY 1, 2, 6;
$function$;

REVOKE ALL ON FUNCTION public.player_notes(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.player_notes(bigint) TO authenticated;

-- ---------- the caller's own notes, for the My Notes page ----------
CREATE OR REPLACE FUNCTION public.my_notes()
RETURNS TABLE (
  player_season_id bigint, session_id bigint, season_id bigint, season_name text, season_closed boolean,
  league_age integer, evaluation_number integer, first_name text, last_name text,
  kind text, note_text text, updated_at timestamptz, editable boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT ps.id, es.id, se.id, se.name, se.is_closed, ps.league_age, ps.evaluation_number, p.first_name, p.last_name,
         'private', pn.note_text, pn.updated_at, true
  FROM public.private_notes pn
  JOIN public.player_seasons ps ON ps.id = pn.player_season_id
  JOIN public.players p ON p.id = ps.player_id
  JOIN public.seasons se ON se.id = ps.season_id
  LEFT JOIN public.evaluation_sessions es
    ON es.season_id = ps.season_id AND es.league_age = ps.league_age AND es.season_division_id IS NULL
  WHERE pn.author_user_id = auth.uid()
  UNION ALL
  SELECT ps.id, es.id, se.id, se.name, se.is_closed, ps.league_age, ps.evaluation_number, p.first_name, p.last_name,
         'shared', n.note_text, n.updated_at, es.status = 'open' AND NOT se.is_closed
  FROM public.evaluator_notes n
  JOIN public.evaluations e ON e.id = n.evaluation_id
  JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
  JOIN public.player_seasons ps ON ps.id = e.player_season_id
  JOIN public.players p ON p.id = ps.player_id
  JOIN public.seasons se ON se.id = ps.season_id
  WHERE n.author_user_id = auth.uid()
  ORDER BY 4 DESC, 6, 7 NULLS LAST, 9, 8;
$function$;

REVOKE ALL ON FUNCTION public.my_notes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_notes() TO authenticated;
