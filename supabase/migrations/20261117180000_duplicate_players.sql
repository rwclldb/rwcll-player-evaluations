-- Possible-duplicate players: flag, merge, or mark "Not a duplicate". Admins only.
--
-- A pair of player records is flagged when (decided 2026-11-17):
--   * name_birthdate:          first and last name match (case and extra spaces ignored) and the birthdates match;
--   * name_birthdate_missing:  names match and at least one of the two has no birthdate on file;
--   * same_player_id:          registrations of the two records carry the same Sports Connect Player Id.
-- Names that match with different birthdates are not flagged. Birthdates are compared here and never returned.
--
-- admin_merge_players(keep, remove, reason) moves everything onto the kept record and deletes the other:
--   * registrations in seasons only the removed record has move over (closed seasons too: it fixes identity, not data);
--   * a season where both are registered keeps one registration: the one with scores, or the kept record's when
--     neither has scores. Refused when both have scores, or when that season is closed. The dropped registration's
--     check-ins, stars, exemptions and import links move to the survivor; a coach's two private notes are joined;
--     its bib, Sports Connect ids, team, age and coach's-kid flag fill gaps on the survivor;
--   * prior-year ratings and import-row links move; a missing birthdate is copied from the removed record.
--   Audited as players_merged (no birthdates).
-- admin_dismiss_duplicate / admin_restore_duplicate: "Not a duplicate" (twins, for example) hides a pair for good,
-- with a reason; it can be flagged again. Audited.

CREATE FUNCTION private.norm_name(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT lower(regexp_replace(btrim(COALESCE(p, '')), '\s+', ' ', 'g')) $$;

CREATE TABLE public.player_duplicate_dismissals (
  player_low bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  player_high bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(btrim(reason)) >= 5),
  dismissed_by uuid,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_low, player_high),
  CHECK (player_low < player_high)
);
ALTER TABLE public.player_duplicate_dismissals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.player_duplicate_dismissals FROM PUBLIC, anon, authenticated;

-- Every flagged pair, dismissed or not.
CREATE FUNCTION private.possible_duplicate_pairs()
RETURNS TABLE (player_low bigint, player_high bigint, reasons text[])
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  WITH p AS (
    SELECT id, private.norm_name(first_name) AS f, private.norm_name(last_name) AS l, date_of_birth AS dob
    FROM public.players
  ), hits AS (
    SELECT a.id AS lo, b.id AS hi,
           CASE WHEN a.dob = b.dob THEN 'name_birthdate' WHEN a.dob IS NULL OR b.dob IS NULL THEN 'name_birthdate_missing' END AS reason
    FROM p a JOIN p b ON a.f = b.f AND a.l = b.l AND a.id < b.id
    WHERE a.f <> '' AND a.l <> ''
    UNION ALL
    SELECT DISTINCT LEAST(x.player_id, y.player_id), GREATEST(x.player_id, y.player_id), 'same_player_id'
    FROM public.player_seasons x
    JOIN public.player_seasons y ON lower(btrim(y.external_player_id)) = lower(btrim(x.external_player_id)) AND y.player_id <> x.player_id
    WHERE btrim(COALESCE(x.external_player_id, '')) <> ''
  )
  SELECT lo, hi, array_agg(DISTINCT reason ORDER BY reason)
  FROM hits WHERE reason IS NOT NULL
  GROUP BY lo, hi;
$$;
REVOKE ALL ON FUNCTION private.possible_duplicate_pairs() FROM PUBLIC, anon, authenticated;

-- One player record as the review page shows it (no birthdate).
CREATE FUNCTION private.duplicate_player_card(p_player_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'first_name', p.first_name, 'last_name', p.last_name, 'has_birth_date', p.date_of_birth IS NOT NULL,
    'created_at', p.created_at,
    'prior_year_ratings', (SELECT count(*) FROM public.historical_evaluations h WHERE h.player_id = p.id),
    'registrations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ps.id, 'season_id', s.id, 'season_name', s.name, 'season_closed', s.is_closed,
        'league_age', ps.league_age, 'bib', ps.evaluation_number, 'player_id', NULLIF(btrim(COALESCE(ps.external_player_id, '')), ''),
        'source', ps.registration_source, 'is_coach_kid', ps.is_coach_kid,
        'scores', (SELECT count(*) FROM public.evaluations e WHERE e.player_season_id = ps.id),
        'check_ins', (SELECT count(*) FROM public.player_checkins c WHERE c.player_season_id = ps.id))
        ORDER BY s.start_date DESC NULLS LAST, s.id DESC)
      FROM public.player_seasons ps JOIN public.seasons s ON s.id = ps.season_id
      WHERE ps.player_id = p.id), '[]'::jsonb))
  FROM public.players p WHERE p.id = p_player_id;
$$;
REVOKE ALL ON FUNCTION private.duplicate_player_card(bigint) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_possible_duplicates()
RETURNS TABLE (player_a jsonb, player_b jsonb, reasons text[], dismissed boolean,
               dismiss_reason text, dismissed_by_name text, dismissed_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT private.duplicate_player_card(d.player_low), private.duplicate_player_card(d.player_high), d.reasons,
         x.player_low IS NOT NULL, x.reason, COALESCE(NULLIF(up.display_name, ''), u.email), x.dismissed_at
  FROM private.possible_duplicate_pairs() d
  LEFT JOIN public.player_duplicate_dismissals x ON x.player_low = d.player_low AND x.player_high = d.player_high
  LEFT JOIN auth.users u ON u.id = x.dismissed_by
  LEFT JOIN public.user_profiles up ON up.user_id = x.dismissed_by
  WHERE public.is_admin()
  ORDER BY x.player_low IS NOT NULL, d.player_high DESC;
$$;

-- Pairs still waiting for a decision (the roadmap and Players page show this).
CREATE FUNCTION public.admin_possible_duplicate_count()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT CASE WHEN public.is_admin() THEN (
    SELECT count(*)::integer FROM private.possible_duplicate_pairs() d
    WHERE NOT EXISTS (SELECT 1 FROM public.player_duplicate_dismissals x WHERE x.player_low = d.player_low AND x.player_high = d.player_high)) END;
$$;

CREATE FUNCTION private.require_flagged_pair(p_a bigint, p_b bigint)
RETURNS text[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_reasons text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN RAISE EXCEPTION 'Choose two different players.'; END IF;
  SELECT d.reasons INTO v_reasons FROM private.possible_duplicate_pairs() d
  WHERE d.player_low = LEAST(p_a, p_b) AND d.player_high = GREATEST(p_a, p_b);
  IF v_reasons IS NULL THEN
    RAISE EXCEPTION 'These two players aren''t flagged as possible duplicates (the names, birthdates or Player Ids may have changed).';
  END IF;
  RETURN v_reasons;
END;
$$;
REVOKE ALL ON FUNCTION private.require_flagged_pair(bigint, bigint) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_dismiss_duplicate(p_player_a bigint, p_player_b bigint, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_reasons text[] := private.require_flagged_pair(p_player_a, p_player_b);
BEGIN
  IF char_length(btrim(COALESCE(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'Say why they are different children (at least 5 characters).'; END IF;
  INSERT INTO public.player_duplicate_dismissals (player_low, player_high, reason, dismissed_by)
  VALUES (LEAST(p_player_a, p_player_b), GREATEST(p_player_a, p_player_b), btrim(p_reason), auth.uid())
  ON CONFLICT (player_low, player_high) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'This pair is already marked "Not a duplicate".'; END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (auth.uid(), 'player_duplicate_dismissed', 'players', LEAST(p_player_a, p_player_b)::text, btrim(p_reason), NULL,
          jsonb_build_object('player_ids', jsonb_build_array(LEAST(p_player_a, p_player_b), GREATEST(p_player_a, p_player_b)), 'reasons', v_reasons));
END;
$$;

CREATE FUNCTION public.admin_restore_duplicate(p_player_a bigint, p_player_b bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_old public.player_duplicate_dismissals;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.player_duplicate_dismissals
  WHERE player_low = LEAST(p_player_a, p_player_b) AND player_high = GREATEST(p_player_a, p_player_b)
  RETURNING * INTO v_old;
  IF NOT FOUND THEN RAISE EXCEPTION 'This pair isn''t marked "Not a duplicate".'; END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (auth.uid(), 'player_duplicate_restored', 'players', v_old.player_low::text, NULL,
          jsonb_build_object('player_ids', jsonb_build_array(v_old.player_low, v_old.player_high), 'reason', v_old.reason,
                             'dismissed_by', v_old.dismissed_by, 'dismissed_at', v_old.dismissed_at), NULL);
END;
$$;

CREATE FUNCTION public.admin_merge_players(p_keep_player_id bigint, p_remove_player_id bigint, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_reasons text[] := private.require_flagged_pair(p_keep_player_id, p_remove_player_id);
  v_keep public.players;
  v_remove public.players;
  r public.player_seasons;
  k public.player_seasons;
  v_survivor public.player_seasons;
  v_dropped public.player_seasons;
  v_season record;
  v_moved jsonb := '[]'::jsonb;
  v_joined jsonb := '[]'::jsonb;
  v_prior integer;
  v_dob_copied boolean := false;
BEGIN
  IF char_length(btrim(COALESCE(p_reason, ''))) < 10 THEN RAISE EXCEPTION 'Give a reason (at least 10 characters).'; END IF;
  SELECT * INTO v_keep FROM public.players WHERE id = p_keep_player_id FOR UPDATE;
  SELECT * INTO v_remove FROM public.players WHERE id = p_remove_player_id FOR UPDATE;

  FOR r IN SELECT * FROM public.player_seasons WHERE player_id = p_remove_player_id ORDER BY season_id FOR UPDATE LOOP
    SELECT * INTO k FROM public.player_seasons WHERE player_id = p_keep_player_id AND season_id = r.season_id FOR UPDATE;
    IF NOT FOUND THEN
      UPDATE public.player_seasons SET player_id = p_keep_player_id WHERE id = r.id;
      v_moved := v_moved || jsonb_build_array(r.id);
      CONTINUE;
    END IF;

    -- Both registered this season: keep one registration.
    SELECT id, name, is_closed INTO v_season FROM public.seasons WHERE id = r.season_id;
    IF v_season.is_closed THEN
      RAISE EXCEPTION 'Both are registered in %, which is closed. Reopen the season to merge them.', v_season.name;
    END IF;
    IF EXISTS (SELECT 1 FROM public.evaluations WHERE player_season_id = r.id)
       AND EXISTS (SELECT 1 FROM public.evaluations WHERE player_season_id = k.id) THEN
      RAISE EXCEPTION 'Both registrations in % have scores. Remove one set of scores first (Data Review), then merge.', v_season.name;
    END IF;
    IF EXISTS (SELECT 1 FROM public.evaluations WHERE player_season_id = r.id) THEN
      v_survivor := r; v_dropped := k;
    ELSE
      v_survivor := k; v_dropped := r;
    END IF;

    UPDATE public.player_checkins SET player_season_id = v_survivor.id
    WHERE player_season_id = v_dropped.id
      AND event_id NOT IN (SELECT event_id FROM public.player_checkins WHERE player_season_id = v_survivor.id);
    UPDATE public.player_stars SET player_season_id = v_survivor.id
    WHERE player_season_id = v_dropped.id
      AND user_id NOT IN (SELECT user_id FROM public.player_stars WHERE player_season_id = v_survivor.id);
    -- A coach with a note on both: join the two notes into one.
    UPDATE public.private_notes s SET note_text = s.note_text || E'\n\n' || d.note_text, updated_at = now()
    FROM public.private_notes d
    WHERE s.player_season_id = v_survivor.id AND d.player_season_id = v_dropped.id AND d.author_user_id = s.author_user_id;
    DELETE FROM public.private_notes
    WHERE player_season_id = v_dropped.id
      AND author_user_id IN (SELECT author_user_id FROM public.private_notes WHERE player_season_id = v_survivor.id);
    UPDATE public.private_notes SET player_season_id = v_survivor.id WHERE player_season_id = v_dropped.id;
    -- Only one active exemption per registration: the survivor's wins; the other is kept as revoked history.
    IF EXISTS (SELECT 1 FROM public.player_exemptions WHERE player_season_id = v_survivor.id AND revoked_at IS NULL) THEN
      UPDATE public.player_exemptions SET revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'Duplicate player merged'
      WHERE player_season_id = v_dropped.id AND revoked_at IS NULL;
    END IF;
    UPDATE public.player_exemptions SET player_season_id = v_survivor.id WHERE player_season_id = v_dropped.id;
    UPDATE public.bib_import_rows SET matched_player_season_id = v_survivor.id WHERE matched_player_season_id = v_dropped.id;
    UPDATE public.sports_connect_import_rows SET committed_player_season_id = v_survivor.id WHERE committed_player_season_id = v_dropped.id;
    UPDATE public.sports_connect_import_rows SET existing_player_season_id = v_survivor.id WHERE existing_player_season_id = v_dropped.id;

    DELETE FROM public.player_seasons WHERE id = v_dropped.id;
    UPDATE public.player_seasons SET
      player_id = p_keep_player_id,
      evaluation_number = COALESCE(evaluation_number, v_dropped.evaluation_number),
      external_player_id = COALESCE(NULLIF(btrim(COALESCE(external_player_id, '')), ''), v_dropped.external_player_id),
      external_registration_id = COALESCE(NULLIF(btrim(COALESCE(external_registration_id, '')), ''), v_dropped.external_registration_id),
      league_age = COALESCE(league_age, v_dropped.league_age),
      team_id = COALESCE(team_id, v_dropped.team_id),
      season_division_id = COALESCE(season_division_id, v_dropped.season_division_id),
      is_coach_kid = is_coach_kid OR v_dropped.is_coach_kid
    WHERE id = v_survivor.id;
    v_joined := v_joined || jsonb_build_array(jsonb_build_object(
      'season', v_season.name, 'kept_registration', v_survivor.id, 'removed_registration', v_dropped.id,
      'removed_bib', v_dropped.evaluation_number, 'removed_player_id', v_dropped.external_player_id,
      'removed_registration_number', v_dropped.external_registration_id, 'removed_source', v_dropped.registration_source));
  END LOOP;

  UPDATE public.historical_evaluations SET player_id = p_keep_player_id WHERE player_id = p_remove_player_id;
  GET DIAGNOSTICS v_prior = ROW_COUNT;
  UPDATE public.sports_connect_import_rows SET matched_player_id = p_keep_player_id WHERE matched_player_id = p_remove_player_id;
  UPDATE public.historical_evaluation_import_rows SET resolved_player_id = p_keep_player_id WHERE resolved_player_id = p_remove_player_id;
  IF v_keep.date_of_birth IS NULL AND v_remove.date_of_birth IS NOT NULL THEN
    UPDATE public.players SET date_of_birth = v_remove.date_of_birth, updated_at = now() WHERE id = p_keep_player_id;
    v_dob_copied := true;
  END IF;
  DELETE FROM public.players WHERE id = p_remove_player_id;

  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (auth.uid(), 'players_merged', 'players', p_keep_player_id::text, btrim(p_reason),
          jsonb_build_object('kept', jsonb_build_object('id', v_keep.id, 'first_name', v_keep.first_name, 'last_name', v_keep.last_name),
                             'removed', jsonb_build_object('id', v_remove.id, 'first_name', v_remove.first_name, 'last_name', v_remove.last_name),
                             'flagged_because', v_reasons),
          jsonb_build_object('registrations_moved', v_moved, 'same_season', v_joined,
                             'prior_year_ratings_moved', v_prior, 'birthdate_copied', v_dob_copied));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_possible_duplicates(), public.admin_possible_duplicate_count(),
  public.admin_dismiss_duplicate(bigint, bigint, text), public.admin_restore_duplicate(bigint, bigint),
  public.admin_merge_players(bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_possible_duplicates(), public.admin_possible_duplicate_count(),
  public.admin_dismiss_duplicate(bigint, bigint, text), public.admin_restore_duplicate(bigint, bigint),
  public.admin_merge_players(bigint, bigint, text) TO authenticated;
