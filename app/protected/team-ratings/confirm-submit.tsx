"use client";

import { Button } from "@/components/ui/button";

/** A submit button that asks before sending the form. */
export function ConfirmSubmit({ label, question, variant = "default" }: { label: string; question: string; variant?: "default" | "outline" }) {
  return (
    <Button type="submit" variant={variant} onClick={(e) => { if (!window.confirm(question)) e.preventDefault(); }}>
      {label}
    </Button>
  );
}
