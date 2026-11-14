"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { inPreviewBrowser, PREVIEW_MESSAGE } from "@/lib/preview";

// Shown when a page or a form action fails. During an admin's "View as" preview this is where refused saves land.
export default function ProtectedError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a browser cookie, only available after mount
    setPreview(inPreviewBrowser());
    if (!inPreviewBrowser()) console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-border bg-card p-6 text-center">
      <h1 className="text-xl font-bold text-foreground">{preview ? "Read-only preview" : "Something went wrong"}</h1>
      <p className="text-sm text-muted-foreground">
        {preview ? `${PREVIEW_MESSAGE} You're seeing the app as someone else, so saving is turned off.` : "That didn't work. Try again, or go back to the home page."}
      </p>
      <div className="flex justify-center gap-2">
        <Button onClick={() => reset()}>{preview ? "Back" : "Try again"}</Button>
        <Button asChild variant="outline"><Link href="/protected">Home</Link></Button>
      </div>
    </div>
  );
}
