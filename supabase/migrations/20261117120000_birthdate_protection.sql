-- Birthdate protection. A child's name plus exact birthdate is sensitive, so:
--
-- 1. Nobody reads a birthdate column directly any more (not coaches, evaluators, registrars, or admins through the
--    API). Column privileges leave out players.date_of_birth, the staged import rows' birth dates, and the raw
--    spreadsheet rows (source_data) of the bib and prior-year uploads. Each table gets has_birth_date instead, so
--    lists can show "DOB on file" / "No DOB". Matching, age checks and imports still run inside the database.
-- 2. Admins and registrars see one birthdate at a time through reveal_birthdate (player edit page, or "Show" on an
--    import row). Every reveal is audited as birthdate_revealed. Import pages compare birthdates for the reader
--    (import_batch_candidates: "name and birthdate match", ...) instead of printing them.
-- 3. Copies are cleaned up: staged rows lose their birthdate once handled (committed, ignored, up to date, reviewed,
--    applied, skipped, imported, dismissed); the audit log never stores birthdates (a trigger replaces them with
--    "(hidden)" and notes when one changed), and existing entries are scrubbed once.
-- The re-import comparison stores only a fingerprint of the app's birthdate (to notice edits), not the dates.
-- Note for later migrations: new columns on these four tables need their own GRANT SELECT to authenticated.

-- ---------- 1. column privileges ----------
ALTER TABLE public.players ADD COLUMN has_birth_date boolean GENERATED ALWAYS AS (date_of_birth IS NOT NULL) STORED;
REVOKE SELECT ON public.players FROM authenticated, anon;
GRANT SELECT (id, first_name, last_name, has_birth_date, created_at, updated_at) ON public.players TO authenticated;

ALTER TABLE public.sports_connect_import_rows ADD COLUMN has_birth_date boolean GENERATED ALWAYS AS (birth_date IS NOT NULL) STORED;
REVOKE SELECT ON public.sports_connect_import_rows FROM authenticated, anon;
GRANT SELECT (id, import_batch_id, source_row_number, external_player_id, first_name, last_name, has_birth_date, source_program,
  source_division, registration_number, payment_status, league_age, review_flags, review_state, matched_player_id,
  committed_player_season_id, created_at, duplicate_player_id_resolved_at, duplicate_player_id_resolved_by,
  duplicate_player_id_resolution_reason, coach_kid, existing_player_season_id, sync_changes) ON public.sports_connect_import_rows TO authenticated;

ALTER TABLE public.bib_import_rows ADD COLUMN has_birth_date boolean GENERATED ALWAYS AS (birth_date IS NOT NULL) STORED;
REVOKE SELECT ON public.bib_import_rows FROM authenticated, anon;
GRANT SELECT (id, import_batch_id, source_row_number, external_player_id, first_name, last_name, has_birth_date, bib_raw,
  evaluation_number, status, change_kind, matched_player_season_id, current_evaluation_number, message, applied_at, created_at)
  ON public.bib_import_rows TO authenticated;

ALTER TABLE public.historical_evaluation_import_rows ADD COLUMN has_birth_date boolean GENERATED ALWAYS AS (birth_date IS NOT NULL) STORED;
REVOKE SELECT ON public.historical_evaluation_import_rows FROM authenticated, anon;
GRANT SELECT (id, import_batch_id, source_row_number, source_player_id, first_name, last_name, has_birth_date, source_season_label,
  source_division_name, source_team_label, source_coach_name, candidate_player_ids, resolved_player_id, match_method, review_state,
  reviewed_by, reviewed_at, review_reason, imported_historical_evaluation_id, created_at, updated_at, ratings, match_status, match_message)
  ON public.historical_evaluation_import_rows TO authenticated;

-- ---------- 2. reading one birthdate, and comparing without showing ----------
-- p_kind: 'registration' (player_seasons.id), 'import_row' (Sports Connect staged row), 'bib_row', 'prior_row'.
CREATE FUNCTION public.reveal_birthdate(p_kind text, p_id bigint, p_context text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_season bigint;
  v_value text;
  v_allowed boolean;
  v_target text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501'; END IF;
  IF p_kind = 'registration' THEN
    SELECT ps.season_id, p.date_of_birth::text INTO v_season, v_value
    FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id WHERE ps.id = p_id;
    v_allowed := FOUND AND public.can_register(v_season);
    v_target := 'player_seasons';
  ELSIF p_kind = 'import_row' THEN
    SELECT b.season_id, COALESCE(r.birth_date::text, NULLIF(r.birth_date_text, '')) INTO v_season, v_value
    FROM public.sports_connect_import_rows r JOIN public.import_batches b ON b.id = r.import_batch_id WHERE r.id = p_id;
    v_allowed := FOUND AND public.can_register(v_season);
    v_target := 'sports_connect_import_rows';
  ELSIF p_kind = 'bib_row' THEN
    SELECT b.season_id, r.birth_date::text INTO v_season, v_value
    FROM public.bib_import_rows r JOIN public.import_batches b ON b.id = r.import_batch_id WHERE r.id = p_id;
    v_allowed := FOUND AND public.can_register(v_season);
    v_target := 'bib_import_rows';
  ELSIF p_kind = 'prior_row' THEN
    SELECT r.birth_date::text INTO v_value FROM public.historical_evaluation_import_rows r WHERE r.id = p_id;
    v_allowed := FOUND AND public.is_admin();
    v_target := 'historical_evaluation_import_rows';
  ELSE
    RAISE EXCEPTION 'Unknown kind.';
  END IF;
  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'Only league admins and registrars can see birthdates.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, after_data)
  VALUES (auth.uid(), 'birthdate_revealed', v_target, p_id::text, left(COALESCE(p_context, 'Show birthdate'), 200),
          jsonb_build_object('kind', p_kind, 'had_value', v_value IS NOT NULL));
  RETURN v_value;
END;
$$;

-- Possible existing players for each still-open staged row of a registration batch, compared on name and birthdate
-- without returning any birthdate.
CREATE FUNCTION public.import_batch_candidates(p_batch_id bigint)
RETURNS TABLE (row_id bigint, player_id bigint, first_name text, last_name text, has_birth_date boolean, reason text, strength integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  WITH rows AS (
    SELECT r.id, lower(regexp_replace(btrim(r.first_name || ' ' || r.last_name), '\s+', ' ', 'g')) AS name, r.birth_date
    FROM public.sports_connect_import_rows r JOIN public.import_batches b ON b.id = r.import_batch_id
    WHERE r.import_batch_id = p_batch_id AND public.can_register(b.season_id)
      AND r.review_state NOT IN ('committed', 'ignored', 'up_to_date', 'changes_reviewed')
  ),
  hits AS (
    SELECT rows.id AS row_id, p.id AS player_id, p.first_name, p.last_name, p.date_of_birth IS NOT NULL AS has_birth_date,
           lower(regexp_replace(btrim(p.first_name || ' ' || p.last_name), '\s+', ' ', 'g')) = rows.name AS same_name,
           rows.birth_date IS NOT NULL AND p.date_of_birth = rows.birth_date AS same_birth
    FROM rows JOIN public.players p
      ON lower(regexp_replace(btrim(p.first_name || ' ' || p.last_name), '\s+', ' ', 'g')) = rows.name
      OR (rows.birth_date IS NOT NULL AND p.date_of_birth = rows.birth_date)
  ),
  ranked AS (
    SELECT h.*, row_number() OVER (PARTITION BY h.row_id ORDER BY (h.same_name::int * 2 + h.same_birth::int) DESC, h.player_id) AS n
    FROM hits h
  )
  SELECT row_id, player_id, first_name, last_name, has_birth_date,
         CASE WHEN same_name AND same_birth THEN 'Name and birthdate match'
              WHEN same_name THEN 'Name matches; birthdate differs or is missing'
              ELSE 'Birthdate matches; name differs' END,
         same_name::int * 2 + same_birth::int
  FROM ranked WHERE n <= 10
  ORDER BY row_id, 7 DESC, player_id;
$$;

REVOKE ALL ON FUNCTION public.reveal_birthdate(text, bigint, text), public.import_batch_candidates(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_birthdate(text, bigint, text), public.import_batch_candidates(bigint) TO authenticated;

-- ---------- 3a. the audit log never keeps birthdates ----------
-- Replaces every birthdate-like value (date_of_birth, birth_date, birth_date_text, birthDate, "Birth Date" ...) with
-- "(hidden)", at any depth.
CREATE FUNCTION private.hide_birthdates(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_out jsonb;
  v_key text;
  v_val jsonb;
BEGIN
  IF p_data IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_data) = 'object' THEN
    v_out := '{}'::jsonb;
    FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_data) LOOP
      IF v_key ~* '(birth|^dob$)' AND v_key !~ '_changed$' THEN
        v_out := v_out || jsonb_build_object(v_key, CASE WHEN v_val IS NULL OR v_val = 'null'::jsonb OR v_val = '""'::jsonb THEN v_val ELSE to_jsonb('(hidden)'::text) END);
      ELSE
        v_out := v_out || jsonb_build_object(v_key, private.hide_birthdates(v_val));
      END IF;
    END LOOP;
    RETURN v_out;
  ELSIF jsonb_typeof(p_data) = 'array' THEN
    SELECT COALESCE(jsonb_agg(private.hide_birthdates(e) ORDER BY i), '[]'::jsonb) INTO v_out
    FROM jsonb_array_elements(p_data) WITH ORDINALITY AS t(e, i);
    RETURN v_out;
  END IF;
  RETURN p_data;
END;
$$;
REVOKE ALL ON FUNCTION private.hide_birthdates(jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.audit_log_hide_birthdates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  -- Keep the fact that a birthdate changed, without the dates.
  IF NEW.before_data ? 'date_of_birth' AND NEW.after_data ? 'date_of_birth'
     AND NEW.before_data -> 'date_of_birth' IS DISTINCT FROM NEW.after_data -> 'date_of_birth' THEN
    NEW.after_data := NEW.after_data || '{"date_of_birth_changed": true}'::jsonb;
  END IF;
  NEW.before_data := private.hide_birthdates(NEW.before_data);
  NEW.after_data := private.hide_birthdates(NEW.after_data);
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_log_hide_birthdates BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION private.audit_log_hide_birthdates();

-- One-time scrub of entries written before this migration. The audit log is otherwise never changed.
ALTER TABLE public.audit_log DISABLE TRIGGER audit_log_immutable;
WITH scrubbed AS (
  UPDATE public.audit_log a
  SET after_data = CASE WHEN a.before_data ? 'date_of_birth' AND a.after_data ? 'date_of_birth'
                         AND a.before_data -> 'date_of_birth' IS DISTINCT FROM a.after_data -> 'date_of_birth'
                        THEN private.hide_birthdates(a.after_data) || '{"date_of_birth_changed": true}'::jsonb
                        ELSE private.hide_birthdates(a.after_data) END,
      before_data = private.hide_birthdates(a.before_data)
  WHERE a.before_data::text ~* '(birth|"dob")' OR a.after_data::text ~* '(birth|"dob")'
  RETURNING 1
)
INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, after_data)
SELECT NULL, 'audit_birthdates_hidden', 'audit_log', NULL,
       'Birthdates removed from earlier audit entries (birthdate protection, migration 20261117120000)',
       jsonb_build_object('entries_changed', count(*)) FROM scrubbed;
ALTER TABLE public.audit_log ENABLE TRIGGER audit_log_immutable;

-- ---------- 3b. staged rows lose their birthdate once handled ----------
CREATE FUNCTION private.strip_birthdate_keys(p_data jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT CASE WHEN p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN p_data
              ELSE COALESCE((SELECT jsonb_object_agg(key, value) FROM jsonb_each(p_data) WHERE key !~* '(birth|^dob$)'), '{}'::jsonb) END;
$$;
REVOKE ALL ON FUNCTION private.strip_birthdate_keys(jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION private.forget_handled_import_birthdates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  -- Nested IFs: each table's columns are only looked at on that table.
  IF TG_TABLE_NAME = 'sports_connect_import_rows' THEN
    IF NEW.review_state IN ('committed', 'ignored', 'up_to_date', 'changes_reviewed') THEN
      NEW.birth_date := NULL;
      NEW.birth_date_text := '';
    END IF;
  ELSIF TG_TABLE_NAME = 'bib_import_rows' THEN
    IF NEW.status IN ('applied', 'skipped', 'invalid') THEN
      NEW.birth_date := NULL;
      NEW.source_data := private.strip_birthdate_keys(NEW.source_data);
    END IF;
  ELSIF TG_TABLE_NAME = 'historical_evaluation_import_rows' THEN
    IF NEW.review_state IN ('imported', 'rejected') THEN
      NEW.birth_date := NULL;
      NEW.source_data := private.strip_birthdate_keys(NEW.source_data);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER forget_handled_birthdates BEFORE INSERT OR UPDATE ON public.sports_connect_import_rows
  FOR EACH ROW EXECUTE FUNCTION private.forget_handled_import_birthdates();
CREATE TRIGGER forget_handled_birthdates BEFORE INSERT OR UPDATE ON public.bib_import_rows
  FOR EACH ROW EXECUTE FUNCTION private.forget_handled_import_birthdates();
CREATE TRIGGER forget_handled_birthdates BEFORE INSERT OR UPDATE ON public.historical_evaluation_import_rows
  FOR EACH ROW EXECUTE FUNCTION private.forget_handled_import_birthdates();

-- Rows already handled before this migration (the trigger does the clearing).
UPDATE public.sports_connect_import_rows SET review_state = review_state
WHERE review_state IN ('committed', 'ignored', 'up_to_date', 'changes_reviewed') AND (birth_date IS NOT NULL OR birth_date_text <> '');
UPDATE public.bib_import_rows SET status = status WHERE status IN ('applied', 'skipped', 'invalid');
UPDATE public.historical_evaluation_import_rows SET review_state = review_state WHERE review_state IN ('imported', 'rejected');

-- Re-import comparisons written before this migration: keep a fingerprint of the app's birthdate, drop the dates.
UPDATE public.sports_connect_import_rows r
SET sync_changes = (
  SELECT jsonb_agg(CASE WHEN c->>'field' = 'birth_date'
                        THEN (c - 'current' - 'incoming') || jsonb_build_object('current', NULL, 'incoming', NULL, 'check', md5(COALESCE(c->>'current', '')))
                        ELSE c END ORDER BY i)
  FROM jsonb_array_elements(r.sync_changes) WITH ORDINALITY AS t(c, i))
WHERE r.sync_changes @> '[{"field": "birth_date"}]';

-- ---- generated: functions patched below ----
CREATE OR REPLACE FUNCTION private.sync_import_batch(p_batch_id bigint, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_season bigint;
  v_row record;
  v_reg record;
  v_snap jsonb;
  v_changes jsonb;
  v_auto jsonb;
  v_set_bib integer;
  v_reg_number text;
  v_payment text;
  v_has_evals boolean;
  v_owner text;
  v_name_differs boolean;
  v_birth_differs boolean;
  v_ignored integer;
BEGIN
  SELECT season_id INTO v_season FROM public.import_batches WHERE id = p_batch_id;

  -- A Player Id the admin ignored in an earlier batch this season, with the same division (an out-of-scope
  -- program, usually), is ignored again. It can be reopened from the Ignored tab like any ignored row.
  UPDATE public.sports_connect_import_rows r
  SET review_state = 'ignored'
  WHERE r.import_batch_id = p_batch_id AND r.review_state = 'needs_review'
    AND NULLIF(btrim(COALESCE(r.external_player_id, '')), '') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.player_seasons ps WHERE ps.season_id = v_season AND ps.external_player_id = btrim(r.external_player_id))
    AND EXISTS (SELECT 1 FROM public.sports_connect_import_rows o JOIN public.import_batches ob ON ob.id = o.import_batch_id
                WHERE ob.season_id = v_season AND o.import_batch_id <> p_batch_id AND o.review_state = 'ignored'
                  AND btrim(o.external_player_id) = btrim(r.external_player_id)
                  AND upper(btrim(o.source_division)) = upper(btrim(r.source_division)));
  GET DIAGNOSTICS v_ignored = ROW_COUNT;
  IF v_ignored > 0 THEN
    INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, after_data)
    VALUES (p_actor, 'sports_connect_import_rows_auto_ignored', 'import_batches', p_batch_id::text,
            'Same Player Id and division were ignored in an earlier import this season',
            jsonb_build_object('rows_ignored', v_ignored));
  END IF;

  FOR v_row IN
    SELECT r.* FROM public.sports_connect_import_rows r
    WHERE r.import_batch_id = p_batch_id AND r.review_state = 'needs_review'
      AND NULLIF(btrim(COALESCE(r.external_player_id, '')), '') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.sports_connect_import_rows o
                      WHERE o.import_batch_id = r.import_batch_id AND o.id <> r.id
                        AND btrim(o.external_player_id) = btrim(r.external_player_id))
    ORDER BY r.source_row_number
  LOOP
    SELECT ps.id, ps.player_id, ps.league_age, ps.league_age_source, ps.evaluation_number, ps.is_coach_kid,
           ps.registration_payment_status, ps.external_registration_id, p.first_name, p.last_name, p.date_of_birth
      INTO v_reg
    FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id
    WHERE ps.season_id = v_season AND ps.external_player_id = btrim(v_row.external_player_id)
    FOR UPDATE OF ps;
    CONTINUE WHEN NOT FOUND;

    v_name_differs := btrim(v_row.first_name) IS DISTINCT FROM v_reg.first_name OR btrim(v_row.last_name) IS DISTINCT FROM v_reg.last_name;
    v_birth_differs := v_row.birth_date IS NOT NULL AND v_row.birth_date IS DISTINCT FROM v_reg.date_of_birth;

    IF v_name_differs AND v_birth_differs THEN
      -- Probably a different child carrying the same Player Id. Leave it for row review.
      UPDATE public.sports_connect_import_rows
      SET existing_player_season_id = v_reg.id,
          review_flags = review_flags || jsonb_build_array(format(
            'Player Id already registered to %s %s (born %s); name and birthdate both differ',
            v_reg.first_name, v_reg.last_name, COALESCE(v_reg.date_of_birth::text, 'unknown')))
      WHERE id = v_row.id;
      CONTINUE;
    END IF;

    v_snap := private.import_sync_snapshot(v_reg.id);
    v_has_evals := EXISTS (SELECT 1 FROM public.evaluations e WHERE e.player_season_id = v_reg.id);
    v_changes := '[]'::jsonb;
    v_auto := '[]'::jsonb;
    v_set_bib := NULL;

    IF v_name_differs THEN
      v_changes := v_changes || jsonb_build_object('field', 'name', 'label', 'Name', 'current', v_snap->>'name',
        'incoming', btrim(v_row.first_name) || ' ' || btrim(v_row.last_name));
    END IF;
    IF v_birth_differs THEN
      -- No dates stored: a fingerprint of the app's value notices later edits (birthdate protection).
      v_changes := v_changes || jsonb_build_object('field', 'birth_date', 'label', 'Birthdate', 'current', NULL,
        'incoming', NULL, 'check', md5(COALESCE(v_snap->>'birth_date', '')));
    END IF;
    IF v_row.league_age IS NOT NULL AND v_row.league_age IS DISTINCT FROM v_reg.league_age THEN
      v_changes := v_changes || jsonb_build_object('field', 'league_age', 'label', 'Age group', 'current', v_snap->>'league_age',
        'incoming', v_row.league_age::text,
        'note', CASE WHEN v_reg.league_age_source = 'admin' THEN 'The current age group was set by hand on the Players page.' END,
        'blocked', CASE WHEN v_has_evals THEN 'This player already has scores in age group ' || v_reg.league_age || ', so the age group can''t change.' END);
    END IF;

    v_reg_number := NULLIF(btrim(COALESCE(v_row.registration_number, '')), '');
    IF v_reg_number ~ '^[0-9]{1,9}$' AND v_reg_number::integer > 0 AND v_reg_number::integer IS DISTINCT FROM v_reg.evaluation_number THEN
      v_owner := private.bib_owner_label(v_season, v_reg_number::integer, v_reg.id);
      IF v_reg.evaluation_number IS NULL AND v_owner IS NULL THEN
        v_set_bib := v_reg_number::integer;
        v_auto := v_auto || jsonb_build_object('field', 'bib', 'label', 'Bib', 'current', '', 'incoming', v_reg_number);
      ELSE
        v_changes := v_changes || jsonb_build_object('field', 'bib', 'label', 'Bib (from Registration Number)',
          'current', v_snap->>'bib', 'incoming', v_reg_number,
          'blocked', CASE WHEN v_owner IS NOT NULL THEN 'Bib ' || v_reg_number || ' is already used by ' || v_owner || '.' END);
      END IF;
    END IF;

    IF v_row.coach_kid IS NOT NULL AND v_row.coach_kid IS DISTINCT FROM v_reg.is_coach_kid THEN
      v_changes := v_changes || jsonb_build_object('field', 'coach_kid', 'label', 'Coach''s kid', 'current', v_snap->>'coach_kid',
        'incoming', CASE WHEN v_row.coach_kid THEN 'Yes' ELSE 'No' END);
    END IF;

    v_payment := COALESCE(NULLIF(btrim(v_row.payment_status), ''), 'UNKNOWN');
    IF v_payment IS DISTINCT FROM v_reg.registration_payment_status THEN
      v_auto := v_auto || jsonb_build_object('field', 'payment_status', 'label', 'Payment status',
        'current', v_reg.registration_payment_status, 'incoming', v_payment);
    END IF;
    -- Registration Numbers are unique per season; leave it alone when another registration has it.
    IF v_reg_number IS DISTINCT FROM v_reg.external_registration_id AND NOT EXISTS (
      SELECT 1 FROM public.player_seasons o WHERE o.season_id = v_season AND o.id <> v_reg.id AND o.external_registration_id = v_reg_number
    ) THEN
      v_auto := v_auto || jsonb_build_object('field', 'registration_number', 'label', 'Registration Number',
        'current', COALESCE(v_reg.external_registration_id, ''), 'incoming', COALESCE(v_reg_number, ''));
    END IF;

    IF jsonb_array_length(v_auto) > 0 THEN
      UPDATE public.player_seasons
      SET registration_payment_status = v_payment,
          external_registration_id = CASE WHEN v_auto @> '[{"field": "registration_number"}]' THEN v_reg_number ELSE external_registration_id END,
          evaluation_number = COALESCE(v_set_bib, evaluation_number)
      WHERE id = v_reg.id;
      INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
      VALUES (p_actor, 'registration_synced_from_import', 'player_seasons', v_reg.id::text,
              format('Updated automatically from Sports Connect import batch %s, line %s', p_batch_id, v_row.source_row_number),
              (SELECT jsonb_object_agg(c->>'field', c->'current') FROM jsonb_array_elements(v_auto) c),
              (SELECT jsonb_object_agg(c->>'field', c->'incoming') FROM jsonb_array_elements(v_auto) c));
    END IF;

    UPDATE public.sports_connect_import_rows
    SET existing_player_season_id = v_reg.id,
        sync_changes = (SELECT COALESCE(jsonb_agg(c || jsonb_build_object('auto', true, 'applied', true)), '[]'::jsonb) FROM jsonb_array_elements(v_auto) c)
                       || (SELECT COALESCE(jsonb_agg(c || jsonb_build_object('auto', false)), '[]'::jsonb) FROM jsonb_array_elements(v_changes) c),
        review_state = CASE WHEN jsonb_array_length(v_changes) > 0 THEN 'has_changes' ELSE 'up_to_date' END,
        matched_player_id = v_reg.player_id
    WHERE id = v_row.id;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_import_row_changes(p_row_id bigint, p_fields text[], p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_row record;
  v_snap jsonb;
  v_change jsonb;
  v_field text;
  v_fields text[] := COALESCE(p_fields, '{}');
  v_new jsonb := '[]'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_applied integer := 0;
  v_owner text;
BEGIN
  IF v_actor IS NULL OR NOT public.can_register(private.import_row_season(p_row_id)) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 5 OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'Give a reason between 5 and 1000 characters.';
  END IF;

  SELECT r.*, b.season_id, s.is_closed, ps.player_id AS reg_player_id
    INTO v_row
  FROM public.sports_connect_import_rows r
  JOIN public.import_batches b ON b.id = r.import_batch_id
  JOIN public.seasons s ON s.id = b.season_id
  LEFT JOIN public.player_seasons ps ON ps.id = r.existing_player_season_id
  WHERE r.id = p_row_id
  FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staged import row not found'; END IF;
  IF v_row.review_state <> 'has_changes' THEN RAISE EXCEPTION 'This row has no changes waiting.'; END IF;
  IF v_row.is_closed THEN RAISE EXCEPTION 'This season is closed.'; END IF;
  IF v_row.reg_player_id IS NULL THEN RAISE EXCEPTION 'The existing registration no longer exists. Stage the file again.'; END IF;

  FOREACH v_field IN ARRAY v_fields LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_row.sync_changes) c WHERE c->>'field' = v_field AND NOT (c->>'auto')::boolean) THEN
      RAISE EXCEPTION 'No waiting change for %.', v_field;
    END IF;
  END LOOP;

  PERFORM 1 FROM public.player_seasons WHERE id = v_row.existing_player_season_id FOR UPDATE;
  v_snap := private.import_sync_snapshot(v_row.existing_player_season_id);

  FOR v_change IN SELECT value FROM jsonb_array_elements(v_row.sync_changes) LOOP
    IF (v_change->>'auto')::boolean OR NOT (v_change->>'field' = ANY (v_fields)) THEN
      v_new := v_new || CASE WHEN (v_change->>'auto')::boolean THEN v_change ELSE v_change || '{"applied": false}'::jsonb END;
      CONTINUE;
    END IF;
    v_field := v_change->>'field';
    IF v_change->>'blocked' IS NOT NULL THEN
      RAISE EXCEPTION '%', v_change->>'blocked';
    END IF;
    IF (v_field = 'birth_date' AND md5(COALESCE(v_snap->>v_field, '')) IS DISTINCT FROM v_change->>'check')
       OR (v_field <> 'birth_date' AND v_snap->>v_field IS DISTINCT FROM v_change->>'current') THEN
      RAISE EXCEPTION '% was changed in the app after this file was staged. Stage the file again to compare.', v_change->>'label';
    END IF;

    IF v_field = 'name' THEN
      UPDATE public.players SET first_name = btrim(v_row.first_name), last_name = btrim(v_row.last_name), updated_at = now()
      WHERE id = v_row.reg_player_id;
    ELSIF v_field = 'birth_date' THEN
      UPDATE public.players SET date_of_birth = v_row.birth_date, updated_at = now() WHERE id = v_row.reg_player_id;
    ELSIF v_field = 'league_age' THEN
      IF EXISTS (SELECT 1 FROM public.evaluations e WHERE e.player_season_id = v_row.existing_player_season_id) THEN
        RAISE EXCEPTION 'This player already has scores, so the age group can''t change.';
      END IF;
      UPDATE public.player_seasons SET league_age = v_row.league_age, league_age_source = 'import'
      WHERE id = v_row.existing_player_season_id;
    ELSIF v_field = 'bib' THEN
      v_owner := private.bib_owner_label(v_row.season_id, (v_change->>'incoming')::integer, v_row.existing_player_season_id);
      IF v_owner IS NOT NULL THEN
        RAISE EXCEPTION 'Bib % is already used by %.', v_change->>'incoming', v_owner;
      END IF;
      UPDATE public.player_seasons SET evaluation_number = (v_change->>'incoming')::integer
      WHERE id = v_row.existing_player_season_id;
    ELSIF v_field = 'coach_kid' THEN
      UPDATE public.player_seasons SET is_coach_kid = (v_change->>'incoming' = 'Yes')
      WHERE id = v_row.existing_player_season_id;
    END IF;

    v_before := v_before || jsonb_build_object(v_field, v_change->'current');
    v_after := v_after || jsonb_build_object(v_field, v_change->'incoming');
    v_new := v_new || (v_change || '{"applied": true}'::jsonb);
    v_applied := v_applied + 1;
  END LOOP;

  UPDATE public.sports_connect_import_rows SET sync_changes = v_new, review_state = 'changes_reviewed' WHERE id = p_row_id;

  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (v_actor, 'registration_synced_from_import', 'player_seasons', v_row.existing_player_season_id::text,
          btrim(p_reason),
          jsonb_build_object('import_row_id', p_row_id, 'values', v_before),
          jsonb_build_object('import_row_id', p_row_id, 'values', v_after,
                             'kept', (SELECT COALESCE(jsonb_agg(c->>'field'), '[]'::jsonb) FROM jsonb_array_elements(v_new) c
                                      WHERE NOT (c->>'auto')::boolean AND NOT (c->>'applied')::boolean)));
  RETURN v_applied;
END;
$function$;

DROP FUNCTION public.admin_save_registration(bigint, text, text, date, integer, integer, text);
CREATE OR REPLACE FUNCTION public.admin_save_registration(p_player_season_id bigint, p_first_name text, p_last_name text, p_date_of_birth date, p_league_age integer, p_evaluation_number integer, p_reason text DEFAULT NULL::text, p_keep_date_of_birth boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reg record;
  v_before jsonb;
  v_after jsonb;
  v_identity_changed boolean;
  v_age_changed boolean;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_owner text;
BEGIN
  IF v_actor IS NULL OR NOT public.can_register(private.registration_season(p_player_season_id)) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;

  SELECT ps.id, ps.season_id, ps.player_id, ps.league_age, ps.evaluation_number, ps.league_age_source,
         p.first_name, p.last_name, p.date_of_birth, s.is_closed
  INTO v_reg
  FROM public.player_seasons ps
  JOIN public.players p ON p.id = ps.player_id
  JOIN public.seasons s ON s.id = ps.season_id
  WHERE ps.id = p_player_season_id
  FOR UPDATE OF ps, p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player registration was not found.';
  END IF;
  -- The edit page doesn't load the birthdate unless asked (birthdate protection): keep the stored one.
  IF p_keep_date_of_birth THEN
    p_date_of_birth := v_reg.date_of_birth;
  END IF;
  IF v_reg.is_closed THEN
    RAISE EXCEPTION 'This season is closed. Reopen it before changing registrations.';
  END IF;
  IF btrim(COALESCE(p_first_name, '')) = '' OR btrim(COALESCE(p_last_name, '')) = '' THEN
    RAISE EXCEPTION 'First and last name are required.';
  END IF;
  IF p_league_age IS NOT NULL AND (p_league_age < 4 OR p_league_age > 18) THEN
    RAISE EXCEPTION 'League age must be between 4 and 18.';
  END IF;
  IF p_evaluation_number IS NOT NULL AND p_evaluation_number < 1 THEN
    RAISE EXCEPTION 'Bib numbers must be positive whole numbers.';
  END IF;

  v_identity_changed := btrim(p_first_name) IS DISTINCT FROM v_reg.first_name
                        OR btrim(p_last_name) IS DISTINCT FROM v_reg.last_name
                        OR p_date_of_birth IS DISTINCT FROM v_reg.date_of_birth;
  v_age_changed := p_league_age IS DISTINCT FROM v_reg.league_age;

  IF (v_identity_changed OR v_age_changed) AND (v_reason IS NULL OR char_length(v_reason) < 5) THEN
    RAISE EXCEPTION 'Give a reason (at least 5 characters) for changing the name, birthdate, or age group.';
  END IF;

  IF v_age_changed AND EXISTS (SELECT 1 FROM public.evaluations e WHERE e.player_season_id = p_player_season_id) THEN
    RAISE EXCEPTION 'This player already has evaluations in age group %. The age group cannot change now.', v_reg.league_age;
  END IF;

  IF p_evaluation_number IS NOT NULL AND p_evaluation_number IS DISTINCT FROM v_reg.evaluation_number THEN
    v_owner := private.bib_owner_label(v_reg.season_id, p_evaluation_number, p_player_season_id);
    IF v_owner IS NOT NULL THEN
      RAISE EXCEPTION 'Bib % is already used by % this season.', p_evaluation_number, v_owner;
    END IF;
  END IF;

  v_before := jsonb_build_object('first_name', v_reg.first_name, 'last_name', v_reg.last_name, 'date_of_birth', v_reg.date_of_birth,
                                 'league_age', v_reg.league_age, 'league_age_source', v_reg.league_age_source, 'evaluation_number', v_reg.evaluation_number);

  IF v_identity_changed THEN
    UPDATE public.players
    SET first_name = btrim(p_first_name), last_name = btrim(p_last_name), date_of_birth = p_date_of_birth, updated_at = now()
    WHERE id = v_reg.player_id;
  END IF;

  UPDATE public.player_seasons
  SET league_age = p_league_age,
      league_age_source = CASE WHEN v_age_changed THEN 'admin' ELSE league_age_source END,
      evaluation_number = p_evaluation_number
  WHERE id = p_player_season_id;

  v_after := jsonb_build_object('first_name', btrim(p_first_name), 'last_name', btrim(p_last_name), 'date_of_birth', p_date_of_birth,
                                'league_age', p_league_age,
                                'league_age_source', CASE WHEN v_age_changed THEN 'admin' ELSE v_reg.league_age_source END,
                                'evaluation_number', p_evaluation_number);

  IF v_before IS DISTINCT FROM v_after THEN
    INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
    VALUES (v_actor, 'registration_admin_update', 'player_seasons', p_player_season_id::text,
            COALESCE(v_reason, 'Bib change'), v_before, v_after);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_save_registration(bigint, text, text, date, integer, integer, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_registration(bigint, text, text, date, integer, integer, text, boolean) TO authenticated;

DROP FUNCTION public.checkin_list(bigint, date);
CREATE OR REPLACE FUNCTION public.checkin_list(p_season_id bigint, p_date date)
 RETURNS TABLE(player_season_id bigint, first_name text, last_name text, league_age integer, evaluation_number integer, is_coach_kid boolean, event_id bigint, event_type text, start_time time without time zone, end_time time without time zone, location text, checked_in_at timestamp with time zone, exempt_scope text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH day_events AS (
    SELECT DISTINCT ON (es.id) es.id AS session_id, es.league_age, e.id AS event_id, e.event_type, e.start_time, e.end_time, e.location
    FROM public.evaluation_session_events e
    JOIN public.evaluation_sessions es ON es.id = e.evaluation_session_id
    WHERE es.season_id = p_season_id AND es.league_age IS NOT NULL AND e.event_date = p_date
    ORDER BY es.id, (e.event_type = 'primary') DESC, e.start_time
  )
  SELECT ps.id, p.first_name, p.last_name, ps.league_age, ps.evaluation_number, ps.is_coach_kid,
         d.event_id, d.event_type, d.start_time, d.end_time, d.location, c.checked_in_at, x.scope
  FROM day_events d
  JOIN public.player_seasons ps ON ps.season_id = p_season_id AND ps.league_age = d.league_age
  JOIN public.players p ON p.id = ps.player_id
  LEFT JOIN public.player_checkins c ON c.player_season_id = ps.id AND c.event_id = d.event_id
  LEFT JOIN public.player_exemptions x ON x.player_season_id = ps.id AND x.revoked_at IS NULL
  WHERE public.can_register(p_season_id)
    AND (d.event_type = 'primary' OR c.id IS NOT NULL OR (
      COALESCE(x.scope, '') NOT IN ('attendance', 'both')
      AND NOT EXISTS (SELECT 1 FROM public.player_checkins c2
                      JOIN public.evaluation_session_events e2 ON e2.id = c2.event_id
                      WHERE c2.player_season_id = ps.id AND e2.evaluation_session_id = d.session_id AND e2.event_date < p_date)
      AND NOT EXISTS (SELECT 1 FROM public.evaluations ev
                      WHERE ev.player_season_id = ps.id AND ev.evaluation_session_id = d.session_id AND ev.status = 'submitted')))
  ORDER BY ps.league_age, p.last_name, p.first_name;
$function$;
REVOKE ALL ON FUNCTION public.checkin_list(bigint, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkin_list(bigint, date) TO authenticated;
