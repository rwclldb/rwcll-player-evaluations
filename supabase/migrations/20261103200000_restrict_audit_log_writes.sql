BEGIN;

REVOKE INSERT, UPDATE, DELETE
ON TABLE public.audit_log
FROM anon, authenticated;

COMMIT;