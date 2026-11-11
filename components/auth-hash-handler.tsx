"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Supabase's default invite and password-reset emails send people back with their session in the address
// (#access_token=...&refresh_token=...&type=invite). Pick it up on any page, store the session, and send
// invited or resetting users to choose a password. Errors (for example an expired link) go to the error page.
export function AuthHashHandler() {
  const router = useRouter();
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash.includes("access_token=") && !hash.includes("error=")) return;
    const params = new URLSearchParams(hash);
    const clear = () => window.history.replaceState(null, "", window.location.pathname + window.location.search);

    if (params.get("error")) {
      clear();
      const why = params.get("error_description") ?? params.get("error") ?? "The link didn't work.";
      router.replace(`/auth/error?error=${encodeURIComponent(why)}`);
      return;
    }
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) return;
    const type = params.get("type");
    createClient().auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      clear();
      if (error) {
        router.replace(`/auth/error?error=${encodeURIComponent(error.message)}`);
        return;
      }
      router.replace(type === "invite" || type === "recovery" ? "/auth/update-password" : "/protected");
    });
  }, [router]);
  return null;
}
