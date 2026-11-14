"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

// Copies text (for example a list of email addresses) to the clipboard.
export function CopyText({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button type="button" variant="outline" size="sm" className="h-8 text-xs"
      onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); }}>
      <Copy className="mr-1 h-3.5 w-3.5" /> {copied ? "Copied" : label}
    </Button>
  );
}
