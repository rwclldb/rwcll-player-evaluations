
-- Recreate the database-level guardrail that automatically
-- enables RLS on new tables created in the public schema.
--
-- The function public.rls_auto_enable() already exists.
-- This event trigger is separate from ordinary table triggers.

CREATE EVENT TRIGGER ensure_rls
ON ddl_command_end
EXECUTE FUNCTION public.rls_auto_enable();
