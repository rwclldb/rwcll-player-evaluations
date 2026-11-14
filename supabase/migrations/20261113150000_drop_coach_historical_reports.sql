-- Retire the team-scoped coach report (decided 2026-11-10, removed 2026-11-13).
-- Draft reports replaced it: they show prior-year coach ratings for every rated player in an age group.
-- The /protected/coach-reports pages are deleted; these two functions were used only by them.
DROP FUNCTION IF EXISTS public.coach_historical_report(bigint);
DROP FUNCTION IF EXISTS public.coach_historical_report_roster(bigint);
