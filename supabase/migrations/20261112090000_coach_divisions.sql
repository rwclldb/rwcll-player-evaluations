-- Coach divisions and division ages (decided 2026-11-12).
-- * Each season's divisions get an age range (season_divisions.min_age/max_age). RWCLL defaults:
--   AA 7-9, AAA 8-11, Majors 10-12, Juniors 13-14, Seniors 15-16. Ranges may overlap. A new season copies
--   the ranges from the latest earlier season (division setup carries forward), else the defaults.
-- * coach_divisions: which divisions a coach coaches this season (from the people import's Division Name
--   column, or set on the People page). Coaches only. Not carried into the next season.
-- * division_assignment_preview / apply_division_assignments: suggest age-group assignments for coaches from
--   their divisions (union of the division age ranges). Apply only adds assignments, only to age groups in
--   Setup, and is safe to run again. Admin only, audited.

ALTER TABLE public.season_divisions
  ADD COLUMN min_age integer,
  ADD COLUMN max_age integer,
  ADD CONSTRAINT season_divisions_age_range_check
    CHECK ((min_age IS NULL AND max_age IS NULL)
        OR (min_age BETWEEN 4 AND 18 AND max_age BETWEEN 4 AND 18 AND min_age <= max_age));

CREATE OR REPLACE FUNCTION private.default_division_ages(p_name text, OUT min_age integer, OUT max_age integer)
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE p_name WHEN 'AA' THEN 7 WHEN 'AAA' THEN 8 WHEN 'Majors' THEN 10 WHEN 'Juniors' THEN 13 WHEN 'Seniors' THEN 15 END,
         CASE p_name WHEN 'AA' THEN 9 WHEN 'AAA' THEN 11 WHEN 'Majors' THEN 12 WHEN 'Juniors' THEN 14 WHEN 'Seniors' THEN 16 END;
$function$;

UPDATE public.season_divisions sd
SET min_age = a.min_age, max_age = a.max_age
FROM public.divisions d, LATERAL private.default_division_ages(d.name) a
WHERE d.id = sd.division_id AND sd.min_age IS NULL;

-- New seasons: attach the standard divisions with ages from the latest earlier season, else the defaults.
CREATE OR REPLACE FUNCTION public.attach_default_divisions_to_season()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT NEW.is_closed THEN
    INSERT INTO public.season_divisions (season_id, division_id, min_age, max_age)
    SELECT NEW.id, d.id,
           coalesce(prev.min_age, dflt.min_age), coalesce(prev.max_age, dflt.max_age)
    FROM public.divisions AS d
    CROSS JOIN LATERAL private.default_division_ages(d.name) AS dflt
    LEFT JOIN LATERAL (
      SELECT sd.min_age, sd.max_age
      FROM public.season_divisions sd JOIN public.seasons s ON s.id = sd.season_id
      WHERE sd.division_id = d.id AND sd.season_id <> NEW.id AND sd.min_age IS NOT NULL
      ORDER BY s.start_date DESC NULLS LAST, s.id DESC
      LIMIT 1
    ) AS prev ON true
    WHERE d.name IN ('AA', 'AAA', 'Majors', 'Juniors', 'Seniors')
    ON CONFLICT (season_id, division_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------- set one division's ages ----------
CREATE OR REPLACE FUNCTION public.admin_set_division_ages(p_season_id bigint, p_division_id bigint, p_min_age integer, p_max_age integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_before jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.seasons WHERE id = p_season_id AND is_closed) THEN
    RAISE EXCEPTION 'This season is closed.';
  END IF;
  IF p_min_age IS NULL OR p_max_age IS NULL OR p_min_age > p_max_age OR p_min_age < 4 OR p_max_age > 18 THEN
    RAISE EXCEPTION 'Enter ages from 4 to 18, youngest first.';
  END IF;
  SELECT jsonb_build_object('min_age', min_age, 'max_age', max_age) INTO v_before
  FROM public.season_divisions WHERE season_id = p_season_id AND division_id = p_division_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That division is not part of this season.';
  END IF;
  UPDATE public.season_divisions SET min_age = p_min_age, max_age = p_max_age
  WHERE season_id = p_season_id AND division_id = p_division_id;
  INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
  VALUES (auth.uid(), 'division_ages_set', 'season_divisions', p_season_id || ':' || p_division_id, NULL, v_before,
          jsonb_build_object('min_age', p_min_age, 'max_age', p_max_age));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_division_ages(bigint, bigint, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_division_ages(bigint, bigint, integer, integer) TO authenticated;

-- ---------- coach divisions ----------
CREATE TABLE public.coach_divisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id bigint NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  division_id bigint NOT NULL REFERENCES public.divisions(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, user_id, division_id)
);
ALTER TABLE public.coach_divisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_read_all" ON public.coach_divisions FOR SELECT TO authenticated USING (public.is_admin());
GRANT SELECT ON TABLE public.coach_divisions TO authenticated;

-- Set a coach's divisions for a season from division names. p_replace = true makes the list the whole set
-- (People page); false adds to what is there (import). Names that aren't divisions of the season are
-- returned in "skipped" (e.g. Tee Ball, Other). Returns {"divisions": [...], "skipped": [...]}.
CREATE OR REPLACE FUNCTION public.admin_set_coach_divisions(p_user_id uuid, p_season_id bigint, p_division_names text[], p_replace boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_before text[];
  v_after text[];
  v_skipped text[];
  v_ids bigint[];
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.seasons WHERE id = p_season_id AND is_closed) THEN
    RAISE EXCEPTION 'This season is closed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND season_id = p_season_id AND role_name = 'coach') THEN
    RAISE EXCEPTION 'Divisions are for coaches. Give this account the Coach role for the season first.';
  END IF;

  SELECT coalesce(array_agg(d.id), '{}') INTO v_ids
  FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id
  WHERE sd.season_id = p_season_id
    AND lower(d.name) IN (SELECT lower(trim(n)) FROM unnest(coalesce(p_division_names, '{}')) n);

  SELECT coalesce(array_agg(DISTINCT trim(n)), '{}') INTO v_skipped
  FROM unnest(coalesce(p_division_names, '{}')) n
  WHERE trim(n) <> '' AND lower(trim(n)) NOT IN (
    SELECT lower(d.name) FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id
    WHERE sd.season_id = p_season_id);

  SELECT coalesce(array_agg(d.name ORDER BY d.sort_order), '{}') INTO v_before
  FROM public.coach_divisions cd JOIN public.divisions d ON d.id = cd.division_id
  WHERE cd.user_id = p_user_id AND cd.season_id = p_season_id;

  IF p_replace THEN
    DELETE FROM public.coach_divisions
    WHERE user_id = p_user_id AND season_id = p_season_id AND NOT (division_id = ANY (v_ids));
  END IF;
  INSERT INTO public.coach_divisions (season_id, user_id, division_id, created_by)
  SELECT p_season_id, p_user_id, unnest(v_ids), v_actor
  ON CONFLICT (season_id, user_id, division_id) DO NOTHING;

  SELECT coalesce(array_agg(d.name ORDER BY d.sort_order), '{}') INTO v_after
  FROM public.coach_divisions cd JOIN public.divisions d ON d.id = cd.division_id
  WHERE cd.user_id = p_user_id AND cd.season_id = p_season_id;

  IF v_after IS DISTINCT FROM v_before THEN
    INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
    VALUES (v_actor, 'coach_divisions_set', 'coach_divisions', p_user_id::text, NULL,
            jsonb_build_object('season_id', p_season_id, 'divisions', to_jsonb(v_before)),
            jsonb_build_object('season_id', p_season_id, 'divisions', to_jsonb(v_after)));
  END IF;
  RETURN jsonb_build_object('divisions', to_jsonb(v_after), 'skipped', to_jsonb(v_skipped));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_coach_divisions(uuid, bigint, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_coach_divisions(uuid, bigint, text[], boolean) TO authenticated;

-- A coach whose role is taken away loses their divisions for that season.
CREATE OR REPLACE FUNCTION private.drop_coach_divisions_on_role_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF OLD.role_name = 'coach' AND OLD.season_id IS NOT NULL THEN
    DELETE FROM public.coach_divisions WHERE user_id = OLD.user_id AND season_id = OLD.season_id;
  END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER user_roles_drop_coach_divisions
AFTER DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION private.drop_coach_divisions_on_role_removal();

-- ---------- suggested assignments ----------
-- One row per coach and age group their divisions cover. "divisions" names the division(s) giving that age.
CREATE OR REPLACE FUNCTION public.division_assignment_preview(p_season_id bigint)
RETURNS TABLE (
  user_id uuid, coach_name text, email text, league_age integer, divisions text,
  session_id bigint, session_status text, already_assigned boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH ages AS (
    SELECT cd.user_id, a.age, string_agg(d.name, ', ' ORDER BY d.sort_order) AS divisions
    FROM public.coach_divisions cd
    JOIN public.user_roles ur ON ur.user_id = cd.user_id AND ur.season_id = cd.season_id AND ur.role_name = 'coach'
    JOIN public.season_divisions sd ON sd.season_id = cd.season_id AND sd.division_id = cd.division_id
    JOIN public.divisions d ON d.id = cd.division_id
    CROSS JOIN LATERAL generate_series(sd.min_age, sd.max_age) AS a(age)
    WHERE cd.season_id = p_season_id AND sd.min_age IS NOT NULL
    GROUP BY cd.user_id, a.age
  )
  SELECT ages.user_id, nullif(trim(up.display_name), ''), u.email::text, ages.age, ages.divisions,
         es.id, es.status,
         EXISTS (SELECT 1 FROM public.evaluator_assignments ea
                 WHERE ea.evaluation_session_id = es.id AND ea.evaluator_user_id = ages.user_id)
  FROM ages
  JOIN auth.users u ON u.id = ages.user_id
  LEFT JOIN public.user_profiles up ON up.user_id = ages.user_id
  LEFT JOIN public.evaluation_sessions es ON es.season_id = p_season_id AND es.league_age = ages.age
  ORDER BY coalesce(nullif(trim(up.display_name), ''), u.email::text), ages.age;
END;
$function$;

REVOKE ALL ON FUNCTION public.division_assignment_preview(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.division_assignment_preview(bigint) TO authenticated;

-- Adds every suggested assignment that is missing, for age groups still in Setup. Returns how many were added.
CREATE OR REPLACE FUNCTION public.apply_division_assignments(p_season_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_added integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.seasons WHERE id = p_season_id AND is_closed) THEN
    RAISE EXCEPTION 'This season is closed.';
  END IF;

  WITH ins AS (
    INSERT INTO public.evaluator_assignments (evaluation_session_id, evaluator_user_id, evaluator_type, assigned_by)
    SELECT DISTINCT p.session_id, p.user_id, 'coach', auth.uid()
    FROM public.division_assignment_preview(p_season_id) p
    WHERE p.session_id IS NOT NULL AND p.session_status = 'setup' AND NOT p.already_assigned
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_added FROM ins;

  IF v_added > 0 THEN
    INSERT INTO public.audit_log (actor_user_id, action, target_table, target_id, reason, before_data, after_data)
    VALUES (auth.uid(), 'division_assignments_applied', 'evaluator_assignments', p_season_id::text, NULL, NULL,
            jsonb_build_object('added', v_added));
  END IF;
  RETURN v_added;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_division_assignments(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_division_assignments(bigint) TO authenticated;
