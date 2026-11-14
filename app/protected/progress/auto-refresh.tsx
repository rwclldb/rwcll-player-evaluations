"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Reloads the page's data every `seconds` while the tab is visible.
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
