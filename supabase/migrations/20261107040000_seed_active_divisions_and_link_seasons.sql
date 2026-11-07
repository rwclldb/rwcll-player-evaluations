-- Initialize the five active RWCLL divisions.
-- Existing division records and season links are preserved.

INSERT INTO public.divisions (name, sort_order)
VALUES
  ('AA', 1),
  ('AAA', 2),
  ('Majors', 3),
  ('Juniors', 4),
  ('Seniors', 5)
ON CONFLICT (name) DO NOTHING;


-- Attach the standard divisions to newly created open seasons.
CREATE OR REPLACE FUNCTION public.attach_default_divisions_to_season()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT NEW.is_closed THEN
    INSERT INTO public.season_divisions (season_id, division_id)
    SELECT NEW.id, d.id
    FROM public.divisions AS d
    WHERE d.name IN ('AA', 'AAA', 'Majors', 'Juniors', 'Seniors')
    ON CONFLICT (season_id, division_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seasons_attach_default_divisions
ON public.seasons;

CREATE TRIGGER seasons_attach_default_divisions
AFTER INSERT ON public.seasons
FOR EACH ROW
EXECUTE FUNCTION public.attach_default_divisions_to_season();


-- Backfill existing open seasons, including Spring 2027.
INSERT INTO public.season_divisions (season_id, division_id)
SELECT s.id, d.id
FROM public.seasons AS s
CROSS JOIN public.divisions AS d
WHERE s.is_closed = false
  AND d.name IN ('AA', 'AAA', 'Majors', 'Juniors', 'Seniors')
ON CONFLICT (season_id, division_id) DO NOTHING;