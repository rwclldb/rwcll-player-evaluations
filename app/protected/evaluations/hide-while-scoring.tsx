"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";

// Hides its contents (the age-group list) while a player is open. The scoring screen changes the address
// itself, so this follows ?player= in the URL rather than the server's first render.
export function HideWhileScoring({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  return params.get("player") ? null : <>{children}</>;
}
