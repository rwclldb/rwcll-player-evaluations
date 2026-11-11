import "server-only";
import { createClient } from "@supabase/supabase-js";

// Supabase client with the secret key: bypasses all security rules. Server code only, and only after
// the caller has been checked as an administrator (see requireAdmin in app/protected/people/actions.ts).
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SECRET_KEY is not set on the server, so accounts can't be created here.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const hasAdminKey = () => Boolean(process.env.SUPABASE_SECRET_KEY);
