"use client";

import { useState, useTransition } from "react";
import { Eye } from "lucide-react";
import { revealBirthdate, type BirthdateKind } from "@/app/protected/birthdate-actions";

const us = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v.slice(5, 7)}/${v.slice(8, 10)}/${v.slice(0, 4)}` : v);

// "Show" for one birthdate (admins and registrars). Each reveal is recorded in the audit log.
export function RevealBirthdate({ kind, id, context, label = "Show" }: { kind: BirthdateKind; id: number; context: string; label?: string }) {
  const [value, setValue] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (value !== undefined) return <span className="font-mono text-xs text-foreground">{value ? us(value) : "none"}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" disabled={pending} title="Show this birthdate (recorded in the audit log)"
        onClick={() => start(async () => { const r = await revealBirthdate(kind, id, context); if (r.error) setError(r.error); else setValue(r.value ?? null); })}
        className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground">
        <Eye className="h-3 w-3" /> {pending ? "…" : label}
      </button>
      {error && <span className="text-xs text-rose-700 dark:text-rose-300">{error}</span>}
    </span>
  );
}
