-- Runtime check: "View as" previews are read-only and only admins can start them. Rolled back.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000ed001', 'va-admin@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ed002', 'va-admin2@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ed003', 'va-coach@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ed004', 'va-coach2@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ed005', 'va-norole@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ed006', 'va-invited@example.test', 'authenticated', 'authenticated');
UPDATE auth.users SET last_sign_in_at = '2090-01-02 10:00+00' WHERE id IN ('00000000-0000-4000-8000-0000000ed003', '00000000-0000-4000-8000-0000000ed004');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('View-as check season', '2090-01-01', '2090-06-30');
INSERT INTO public.user_roles (user_id, role_name, season_id) VALUES
  ('00000000-0000-4000-8000-0000000ed001', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000ed002', 'administrator', NULL),
  ('00000000-0000-4000-8000-0000000ed003', 'coach', (SELECT id FROM public.seasons WHERE name = 'View-as check season')),
  ('00000000-0000-4000-8000-0000000ed004', 'coach', (SELECT id FROM public.seasons WHERE name = 'View-as check season')),
  ('00000000-0000-4000-8000-0000000ed006', 'coach', (SELECT id FROM public.seasons WHERE name = 'View-as check season'));
INSERT INTO public.user_profiles (user_id, display_name) VALUES
  ('00000000-0000-4000-8000-0000000ed001', 'Ada Admin'), ('00000000-0000-4000-8000-0000000ed003', 'Cory Coach');

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text) TO authenticated;
CREATE FUNCTION pg_temp.as_user(p_id text, p_session text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated","session_id":"%s"}', p_id, p_session), true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text, text) TO authenticated;
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_fragment text, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_fragment IN SQLERRM) > 0 THEN RAISE NOTICE 'PASS: %', p_label; RETURN; END IF;
    RAISE EXCEPTION 'FAIL: % (wrong error: %)', p_label, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL: % (no error raised)', p_label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect_error(text, text, text) TO authenticated;

SET LOCAL ROLE authenticated;
-- ---------- who can ask for a preview ----------
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ed003', '11111111-1111-4111-8111-000000000001');
SELECT pg_temp.expect_error($q$SELECT public.admin_create_preview('00000000-0000-4000-8000-0000000ed004', 'token-0123456789abcdef')$q$,
  'Administrator access required', 'a coach cannot create previews');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ed001', '11111111-1111-4111-8111-000000000002');
SELECT pg_temp.expect_error($q$SELECT public.admin_create_preview('00000000-0000-4000-8000-0000000ed002', 'token-0123456789abcdef')$q$,
  'Admin accounts can''t be previewed', 'another admin cannot be previewed');
SELECT pg_temp.expect_error($q$SELECT public.admin_create_preview('00000000-0000-4000-8000-0000000ed001', 'token-0123456789abcdef')$q$,
  'own account', 'nor your own account');
SELECT pg_temp.expect_error($q$SELECT public.admin_create_preview('00000000-0000-4000-8000-0000000ed005', 'token-0123456789abcdef')$q$,
  'no role yet', 'nor an account with no role');
SELECT pg_temp.expect_error($q$SELECT public.admin_create_preview('00000000-0000-4000-8000-0000000ed006', 'token-0123456789abcdef')$q$,
  'signed in yet', 'nor someone who has never signed in (the link would accept their invitation)');
SELECT public.admin_create_preview('00000000-0000-4000-8000-0000000ed003', 'token-0123456789abcdef');
RESET ROLE;
SELECT pg_temp.check((SELECT token_sha <> 'token-0123456789abcdef' FROM public.preview_requests WHERE target_user_id = '00000000-0000-4000-8000-0000000ed003'), 'only a hash of the link token is stored');

-- ---------- using the link ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ed004', '22222222-2222-4222-8222-000000000001');
SELECT pg_temp.check(public.start_preview_from_token('token-0123456789abcdef') = false, 'another account using the link gets no preview');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ed003', '22222222-2222-4222-8222-000000000002');
SELECT pg_temp.check(public.start_preview_from_token('some-other-token-xyz') = false, 'a normal sign-in link is not a preview');
SELECT pg_temp.check(public.current_preview() IS NULL, 'a normal session shows no preview banner');
RESET ROLE;
UPDATE auth.users SET last_sign_in_at = now() WHERE id = '00000000-0000-4000-8000-0000000ed003'; -- what signing in through the link does
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ed003', '22222222-2222-4222-8222-000000000002');
SELECT pg_temp.check(public.start_preview_from_token('token-0123456789abcdef') = true, 'the preview link starts a preview');
RESET ROLE;
SELECT pg_temp.check((SELECT last_sign_in_at FROM auth.users WHERE id = '00000000-0000-4000-8000-0000000ed003') = '2090-01-02 10:00+00',
  'the person''s real last sign-in time is put back');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ed003', '22222222-2222-4222-8222-000000000002');
SELECT pg_temp.check(public.current_preview() = '{"target_name": "Cory Coach", "admin_name": "Ada Admin"}'::jsonb, 'the banner names who is viewed and by whom');
SELECT pg_temp.expect_error('SELECT public.save_evaluation(1, 1, ''{"hitting": 3}''::jsonb, ''{}''::jsonb, ''submitted'')', 'read-only', 'a preview cannot save scores');
SELECT pg_temp.expect_error('SELECT public.save_private_note(1, ''x'')', 'read-only', 'or private notes');
SELECT pg_temp.expect_error('SELECT public.save_shared_note(1, 1, ''x'')', 'read-only', 'or shared notes');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ed003', '22222222-2222-4222-8222-000000000003');
SELECT pg_temp.check(public.current_preview() IS NULL, 'the same person''s other sign-ins are not previews');
SELECT pg_temp.as_user('00000000-0000-4000-8000-0000000ed003', '22222222-2222-4222-8222-000000000002');
SELECT public.end_preview();
SELECT pg_temp.check(public.current_preview() IS NULL, 'End preview ends it');
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) FROM public.audit_log WHERE target_id = '00000000-0000-4000-8000-0000000ed003'
  AND action IN ('account_preview_link_created', 'account_preview_started')) = 2, 'creating and starting a preview are audited');

ROLLBACK;
