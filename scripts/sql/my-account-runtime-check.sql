-- Runtime check: the "Your account" functions. Rolled back; leaves no data.
\set ON_ERROR_STOP 1
BEGIN;

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000ac001', 'acct-coach@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000ac002', 'acct-other@example.test', 'authenticated', 'authenticated');
INSERT INTO public.seasons (name, start_date, end_date) VALUES ('Account check season', '2098-01-01', '2098-06-30');
INSERT INTO public.user_roles (user_id, role_name, season_id)
  SELECT '00000000-0000-4000-8000-0000000ac001', 'coach', id FROM public.seasons WHERE name = 'Account check season';
INSERT INTO public.user_profiles (user_id, display_name) VALUES ('00000000-0000-4000-8000-0000000ac002', 'Other Person');

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS: %', p_label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.check(boolean, text) TO authenticated;
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_fragment text, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_fragment IN SQLERRM) > 0 THEN RAISE NOTICE 'PASS: %', p_label; RETURN; END IF;
    RAISE EXCEPTION 'FAIL: % (wrong error: %)', p_label, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL: % (no error raised)', p_label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect_error(text, text, text) TO authenticated, anon;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000ac001","role":"authenticated"}', true);
SELECT pg_temp.check((public.my_account()->'roles'->0->>'season') = 'Account check season'
  AND (public.my_account()->'roles'->0->>'role') = 'coach', 'a person sees their own roles with season names');
SELECT public.set_my_display_name('  New Name  ');
SELECT pg_temp.check(public.my_account()->>'display_name' = 'New Name', 'a person changes their own name (trimmed)');
SELECT public.set_my_display_name('New Name');
SELECT pg_temp.expect_error('SELECT public.set_my_display_name(''   '')', 'between 1 and 100', 'a blank name is refused');
SELECT public.log_my_password_change();
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) FROM public.audit_log WHERE actor_user_id = '00000000-0000-4000-8000-0000000ac001' AND action = 'account_name_changed') = 1,
  'a name change is audited once (saving the same name again adds nothing)');
SELECT pg_temp.check((SELECT count(*) FROM public.audit_log WHERE actor_user_id = '00000000-0000-4000-8000-0000000ac001' AND action = 'account_password_changed') = 1,
  'a password change is logged');
SELECT pg_temp.check((SELECT display_name FROM public.user_profiles WHERE user_id = '00000000-0000-4000-8000-0000000ac002') = 'Other Person',
  'other people''s names are untouched');
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('SELECT public.my_account()', 'permission denied', 'signed-out visitors cannot call it');
RESET ROLE;

ROLLBACK;
