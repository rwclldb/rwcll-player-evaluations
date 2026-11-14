-- Runtime check: the roadmap's "not signed in yet" list and count. Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role, last_sign_in_at, banned_until, invited_at) VALUES
  ('00000000-0000-4000-8000-0000000ee001', 'ri-admin@example.test', 'authenticated', 'authenticated', now(), NULL, NULL),
  ('00000000-0000-4000-8000-0000000ee002', 'ri-new-coach@example.test', 'authenticated', 'authenticated', NULL, NULL, now() - interval '3 days'),
  ('00000000-0000-4000-8000-0000000ee003', 'ri-seen-coach@example.test', 'authenticated', 'authenticated', now(), NULL, NULL),
  ('00000000-0000-4000-8000-0000000ee004', 'ri-new-registrar@example.test', 'authenticated', 'authenticated', NULL, NULL, now()),
  ('00000000-0000-4000-8000-0000000ee005', 'ri-disabled@example.test', 'authenticated', 'authenticated', NULL, now() + interval '100 years', now()),
  ('00000000-0000-4000-8000-0000000ee006', 'ri-new-eval@example.test', 'authenticated', 'authenticated', NULL, NULL, now());
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Invites check season', '2089-01-01', '2089-06-30');
CREATE TEMP TABLE ctx ON COMMIT DROP AS SELECT (SELECT id FROM public.seasons WHERE name = 'Invites check season') AS season_id;
GRANT SELECT ON ctx TO authenticated;
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000ee001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000ee002', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000ee002', 'registrar', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000ee003', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000ee004', 'registrar', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000ee005', 'coach', (SELECT season_id FROM ctx)),
  ('00000000-0000-4000-8000-0000000ee006', 'independent_evaluator', (SELECT season_id FROM ctx));
INSERT INTO public.user_profiles (user_id, display_name) VALUES ('00000000-0000-4000-8000-0000000ee002', 'Nina New');

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000ee001","role":"authenticated"}', true);
SELECT pg_temp.check((SELECT array_agg(email ORDER BY email) FROM public.admin_people_not_signed_in((SELECT season_id FROM ctx)))
  = ARRAY['ri-new-coach@example.test', 'ri-new-eval@example.test', 'ri-new-registrar@example.test'],
  'the list has coaches, evaluators and registrars who never signed in (not disabled, not signed-in)');
SELECT pg_temp.check((SELECT roles = ARRAY['coach', 'registrar'] AND display_name = 'Nina New' AND invited_at < now() - interval '2 days'
  FROM public.admin_people_not_signed_in((SELECT season_id FROM ctx)) WHERE email = 'ri-new-coach@example.test'),
  'someone with two roles appears once, with both roles, name and invite date');
SELECT pg_temp.check((public.admin_season_roadmap((SELECT season_id FROM ctx), CURRENT_DATE) -> 'people' ->> 'not_signed_in')::int = 3,
  'the roadmap count matches the list');
SELECT pg_temp.check((public.admin_season_roadmap((SELECT season_id FROM ctx), CURRENT_DATE) -> 'people' ->> 'unassigned')::int = 3,
  'registrars are not counted as unassigned (3 coaches/evaluators, none assigned; the disabled one left out)');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000ee003","role":"authenticated"}', true);
SELECT pg_temp.check((SELECT count(*) FROM public.admin_people_not_signed_in((SELECT season_id FROM ctx))) = 0, 'a coach gets nothing');
RESET ROLE;

ROLLBACK;
