-- Bulk actions for Sports Connect import review (2026-11-11). A real file has hundreds of rows; reviewing
-- each by hand isn't workable. Both actions are explicit admin clicks with a reason, and each row still goes
-- through review_sports_connect_import_row / commit_sports_connect_import_row (so every row is audited).
--
-- Clean row (bulk approve-as-new and commit):
--   * still undecided (needs_review / ready_for_match_review)
--   * active division, an age-chart league age, a Player Id, a name, a birthdate
--   * no review flags except "Payment status needs review" (payment never gates)
--   * no existing player, and no other row in this file, with the same first + last name (any birthdate):
--     those may be the same child, so a person decides
--   * Player Id not already registered this season and not on another undecided row of the batch
-- Out-of-scope row (bulk ignore): the division is not an active evaluation division.
-- Everything else stays for one-at-a-time review.

CREATE OR REPLACE FUNCTION private.import_row_is_clean(p_row public.sports_connect_import_rows, p_season_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT p_row.review_state IN ('needs_review', 'ready_for_match_review')
    AND upper(btrim(p_row.source_division)) IN ('AA', 'AAA', 'MAJORS', 'JUNIORS', 'SENIORS')
    AND p_row.league_age IS NOT NULL
    AND p_row.birth_date IS NOT NULL
    AND NULLIF(btrim(COALESCE(p_row.external_player_id, '')), '') IS NOT NULL
    AND btrim(p_row.first_name) <> '' AND btrim(p_row.last_name) <> ''
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_row.review_flags) f WHERE f <> 'Payment status needs review')
    AND NOT EXISTS (SELECT 1 FROM public.players p
                    WHERE lower(btrim(p.first_name)) = lower(btrim(p_row.first_name))
                      AND lower(btrim(p.last_name)) = lower(btrim(p_row.last_name)))
    AND NOT EXISTS (SELECT 1 FROM public.sports_connect_import_rows o
                    WHERE o.import_batch_id = p_row.import_batch_id AND o.id <> p_row.id
                      AND o.review_state NOT IN ('ignored')
                      AND lower(btrim(o.first_name)) = lower(btrim(p_row.first_name))
                      AND lower(btrim(o.last_name)) = lower(btrim(p_row.last_name)))
    AND NOT EXISTS (SELECT 1 FROM public.player_seasons ps
                    WHERE ps.season_id = p_season_id AND ps.external_player_id = btrim(p_row.external_player_id))
    AND NOT EXISTS (SELECT 1 FROM public.sports_connect_import_rows o
                    WHERE o.import_batch_id = p_row.import_batch_id AND o.id <> p_row.id
                      AND btrim(o.external_player_id) = btrim(p_row.external_player_id)
                      AND o.review_state NOT IN ('ignored'));
$function$;

REVOKE ALL ON FUNCTION private.import_row_is_clean(public.sports_connect_import_rows, bigint) FROM PUBLIC, anon, authenticated;

-- Counts for the batch page: how many rows each bulk button would touch.
CREATE OR REPLACE FUNCTION public.import_batch_bulk_counts(p_batch_id bigint)
RETURNS TABLE (clean_rows integer, out_of_scope_rows integer, out_of_scope_programs text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    (SELECT count(*)::int FROM public.sports_connect_import_rows r WHERE r.import_batch_id = b.id AND private.import_row_is_clean(r, b.season_id)),
    (SELECT count(*)::int FROM public.sports_connect_import_rows r WHERE r.import_batch_id = b.id
       AND r.review_state IN ('needs_review', 'ready_for_match_review')
       AND upper(btrim(r.source_division)) NOT IN ('AA', 'AAA', 'MAJORS', 'JUNIORS', 'SENIORS')),
    (SELECT string_agg(DISTINCT btrim(r.source_program) || ' / ' || btrim(r.source_division), '; ')
       FROM public.sports_connect_import_rows r WHERE r.import_batch_id = b.id
       AND r.review_state IN ('needs_review', 'ready_for_match_review')
       AND upper(btrim(r.source_division)) NOT IN ('AA', 'AAA', 'MAJORS', 'JUNIORS', 'SENIORS'))
  FROM public.import_batches b
  WHERE b.id = p_batch_id AND public.is_admin();
$function$;

REVOKE ALL ON FUNCTION public.import_batch_bulk_counts(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_batch_bulk_counts(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.bulk_commit_clean_import_rows(p_batch_id bigint, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_season_id bigint;
  v_row public.sports_connect_import_rows;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Give a reason (at least 5 characters).';
  END IF;
  SELECT season_id INTO v_season_id FROM public.import_batches WHERE id = p_batch_id AND import_type = 'players';
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'Import batch not found.';
  END IF;

  -- One row at a time, re-checking each, so rows earlier in the loop count as "already registered".
  FOR v_row IN SELECT * FROM public.sports_connect_import_rows WHERE import_batch_id = p_batch_id ORDER BY source_row_number
  LOOP
    CONTINUE WHEN NOT private.import_row_is_clean(v_row, v_season_id);
    PERFORM public.review_sports_connect_import_row(v_row.id, 'approved_new', NULL, btrim(p_reason));
    PERFORM public.commit_sports_connect_import_row(v_row.id, btrim(p_reason));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.bulk_commit_clean_import_rows(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_commit_clean_import_rows(bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.bulk_ignore_out_of_scope_import_rows(p_batch_id bigint, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Give a reason (at least 5 characters).';
  END IF;
  FOR v_row IN
    SELECT r.id FROM public.sports_connect_import_rows r
    WHERE r.import_batch_id = p_batch_id AND r.review_state IN ('needs_review', 'ready_for_match_review')
      AND upper(btrim(r.source_division)) NOT IN ('AA', 'AAA', 'MAJORS', 'JUNIORS', 'SENIORS')
    ORDER BY r.source_row_number
  LOOP
    PERFORM public.review_sports_connect_import_row(v_row.id, 'ignored', NULL, btrim(p_reason));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.bulk_ignore_out_of_scope_import_rows(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_ignore_out_of_scope_import_rows(bigint, text) TO authenticated;
