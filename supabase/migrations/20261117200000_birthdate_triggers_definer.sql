-- The birthdate-protection triggers call helpers in the private schema. Run them as their owner so a write made
-- with the secret key (the fixture loader, for example) works too: before this, updating a prior-year or bib
-- upload row with the service role failed with "permission denied for schema private".
-- They only rewrite the row being written; nothing else changes.
ALTER FUNCTION private.forget_handled_import_birthdates() SECURITY DEFINER;
ALTER FUNCTION private.audit_log_hide_birthdates() SECURITY DEFINER;
