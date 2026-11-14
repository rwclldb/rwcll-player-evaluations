-- Closing and reopening a season.
--
-- Closing locks the whole season: the ~30 functions that already check seasons.is_closed refuse scores, imports,
-- bibs, check-ins, exemptions and registration edits. (Coaches' private notes stay editable, by design.)
-- * admin_season_close_check(season): what is still unfinished. Open age groups block closing (lock them first);
--   unreleased draft reports, import rows waiting, held bib rows and players without a bib are warnings.
-- * admin_close_season / admin_reopen_season: admins only, a reason (10+ characters) and the season's name typed
--   as confirmation. Audited as season_closed / season_reopened with who, when and the checklist at that moment.
-- * seasons.closed_at / closed_by record the current close.
-- * The closed flag can't be changed through the API directly (trigger): only through these two functions, so
--   every close and reopen is audited.

ALTER TABLE public.seasons ADD COLUMN closed_at timestamptz, ADD COLUMN closed_by uuid;

CREATE FUNCTION private.guard_season_closed_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  -- Signed-in users reach this only through the API; the close and reopen functions run as the owner.
  IF NEW.is_closed IS DISTINCT FROM OLD.is_closed AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Close or reopen a season from its Season page (the change is audited).' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_season_closed_flag BEFORE UPDATE OF is_closed ON public.seasons
  FOR EACH ROW EXECUTE FUNCTION private.guard_season_closed_flag();

-- What is still unfinished in a season.
CREATE FUNCTION public.admin_season_close_check(p_season_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT jsonb_build_object(
    'open_age_groups', COALESCE((SELECT jsonb_agg(es.league_age ORDER BY es.league_age) FROM public.evaluation_sessions es
                                 WHERE es.season_id = p_season_id AND es.status = 'open' AND es.league_age IS NOT NULL), '[]'::jsonb),
    'setup_age_groups', COALESCE((SELECT jsonb_agg(es.league_age ORDER BY es.league_age) FROM public.evaluation_sessions es
                                  WHERE es.season_id = p_season_id AND es.status = 'setup' AND es.league_age IS NOT NULL), '[]'::jsonb),
    'unreleased_age_groups', COALESCE((SELECT jsonb_agg(es.league_age ORDER BY es.league_age) FROM public.evaluation_sessions es
                                       WHERE es.season_id = p_season_id AND es.status = 'locked' AND es.published_at IS NULL AND es.league_age IS NOT NULL), '[]'::jsonb),
    'import_rows_waiting', (SELECT count(*) FROM public.sports_connect_import_rows r JOIN public.import_batches b ON b.id = r.import_batch_id
                            WHERE b.season_id = p_season_id
                              AND r.review_state IN ('needs_review', 'ready_for_match_review', 'approved_new', 'approved_match', 'has_changes')),
    'bib_rows_held', (SELECT count(*) FROM public.bib_import_rows r JOIN public.import_batches b ON b.id = r.import_batch_id
                      WHERE b.season_id = p_season_id AND r.status = 'held'),
    'players_without_bib', (SELECT count(*) FROM public.player_seasons ps WHERE ps.season_id = p_season_id AND ps.evaluation_number IS NULL),
    'draft_evaluations', (SELECT count(*) FROM public.evaluations e JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
                          WHERE es.season_id = p_season_id AND e.status = 'draft'))
  WHERE public.is_admin();
$$;

CREATE FUNCTION private.check_season_status_change(p_season_id bigint, p_reason text, p_confirm_name text)
RETURNS public.seasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_season public.seasons;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_season FROM public.seasons WHERE id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Season not found.'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'Give a reason (at least 10 characters).'; END IF;
  IF lower(btrim(COALESCE(p_confirm_name, ''))) <> lower(btrim(v_season.name)) THEN
    RAISE EXCEPTION 'Type the season''s name exactly (%) to confirm.', v_season.name;
  END IF;
  RETURN v_season;
END;
$$;
REVOKE ALL ON FUNCTION private.check_season_status_change(bigint, text, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_close_season(p_season_id bigint, p_reason text, p_confirm_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_season public.seasons;
  v_check jsonb;
BEGIN
  v_season := private.check_season_status_change(p_season_id, p_reason, p_confirm_name);
  IF v_season.is_closed THEN RAISE EXCEPTION 'This season is already closed.'; END IF;
  v_check := public.admin_season_close_check(p_season_id);
  IF jsonb_array_length(v_check -> 'open_age_groups') > 0 THEN
    RAISE EXCEPTION 'Scoring is still open for age %. Lock those age groups on the Sessions page first.',
      (SELECT string_agg(a, ', ') FROM jsonb_array_elements_text(v_check -> 'open_age_groups') a);
  END IF;
  UPDATE public.seasons SET is_closed = true, closed_at = now(), closed_by = auth.uid() WHERE id = p_season_id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (auth.uid(), 'season_closed', 'seasons', p_season_id::text, btrim(p_reason),
          jsonb_build_object('is_closed', false), jsonb_build_object('is_closed', true, 'checklist', v_check));
END;
$$;

CREATE FUNCTION public.admin_reopen_season(p_season_id bigint, p_reason text, p_confirm_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_season public.seasons;
BEGIN
  v_season := private.check_season_status_change(p_season_id, p_reason, p_confirm_name);
  IF NOT v_season.is_closed THEN RAISE EXCEPTION 'This season is not closed.'; END IF;
  UPDATE public.seasons SET is_closed = false, closed_at = NULL, closed_by = NULL WHERE id = p_season_id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (auth.uid(), 'season_reopened', 'seasons', p_season_id::text, btrim(p_reason),
          jsonb_build_object('is_closed', true, 'closed_at', v_season.closed_at, 'closed_by', v_season.closed_by),
          jsonb_build_object('is_closed', false));
END;
$$;

-- Every close and reopen of a season, newest first, with who did it.
CREATE FUNCTION public.admin_season_status_history(p_season_id bigint)
RETURNS TABLE (action text, reason text, actor_name text, created_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT a.action, a.reason, COALESCE(NULLIF(up.display_name, ''), u.email, 'unknown'), a.created_at
  FROM public.audit_log a
  LEFT JOIN auth.users u ON u.id = a.actor_user_id
  LEFT JOIN public.user_profiles up ON up.user_id = a.actor_user_id
  WHERE a.target_table = 'seasons' AND a.target_id = p_season_id::text AND a.action IN ('season_closed', 'season_reopened')
    AND public.is_admin()
  ORDER BY a.created_at DESC, a.id DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_season_close_check(bigint), public.admin_close_season(bigint, text, text),
  public.admin_reopen_season(bigint, text, text), public.admin_season_status_history(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_season_close_check(bigint), public.admin_close_season(bigint, text, text),
  public.admin_reopen_season(bigint, text, text), public.admin_season_status_history(bigint) TO authenticated;
