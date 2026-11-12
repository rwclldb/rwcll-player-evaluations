"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// One browser holds one sign-in, shared by every window and tab. If someone signs in as a different
// person (or signs out) in another window, this window's top bar would still show the old account.
// When the window comes back into view, or moves to another page, compare the signed-in account with
// the one this page was drawn for and reload if it changed. (Access is always checked on the server;
// this only keeps the screen honest.)
export function SessionWatcher({ userId }: { userId: string }) {
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    let reloading = false;
    const check = async () => {
      if (reloading || document.visibilityState !== "visible") return;
      const { data } = await supabase.auth.getSession();
      if ((data.session?.user.id ?? null) !== userId) {
        reloading = true;
        window.location.reload();
      }
    };
    check();
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    const { data: sub } = supabase.auth.onAuthStateChange(() => { check(); });
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
      sub.subscription.unsubscribe();
    };
  }, [userId, pathname]);

  return null;
}
