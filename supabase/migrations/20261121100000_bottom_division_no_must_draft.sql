-- The youngest division has no must-draft ages by default (decided 2026-11-21).
-- "The top age must play here" makes sense for a division players can't play below (every 12 plays Majors, every
-- 11 not in Majors plays AAA), but not for AA: a 9-year-old who asked for AAA belongs in AAA's pool, and AA takes
-- whoever AAA leaves. So the division with the lowest age range in the season gets no default must-draft ages;
-- Juniors keeps every age (13 and 14); the rest keep their top age. Admins can still set ages per draft.

CREATE OR REPLACE FUNCTION private.default_must_draft_ages(p_season_division_id bigint) RETURNS integer[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $$
  SELECT CASE
    WHEN sd.max_age IS NULL THEN '{}'::integer[]
    WHEN lower(d.name) = 'juniors' AND sd.min_age IS NOT NULL THEN ARRAY(SELECT generate_series(sd.min_age, sd.max_age))
    WHEN sd.min_age IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.season_divisions o WHERE o.season_id = sd.season_id AND o.id <> sd.id AND o.min_age < sd.min_age) THEN '{}'::integer[]
    ELSE ARRAY[sd.max_age]
  END
  FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id WHERE sd.id = p_season_division_id;
$$;
