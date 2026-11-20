"use client";

import { useState, useTransition } from "react";
import { Eye, Pencil } from "lucide-react";
import { leagueAgeForBirthDate } from "@/lib/sports-connect-preview";
import type { ChartEntry } from "@/lib/age-chart";
import { revealBirthdate } from "@/app/protected/birthdate-actions";

const us = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const toIso = (v: string) => {
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;
};

// The birthdate on the player edit page. It stays hidden until "Show" (which is logged) or "Change".
// birthDateMode "keep" tells the server to keep the stored birthdate without anyone reading it.
export function BirthdateField({ playerSeasonId, hasBirthDate, className, ageChart }: {
  playerSeasonId: number; hasBirthDate: boolean; className: string;
  /** The season's age chart; null when the season has none. */
  ageChart: ChartEntry[] | null;
}) {
  const [mode, setMode] = useState<"keep" | "set">(hasBirthDate ? "keep" : "set");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const iso = mode === "set" ? toIso(value) : null;
  const chartAge = iso ? leagueAgeForBirthDate(iso, ageChart) : null;

  return (
    <>
      <input type="hidden" name="birthDateMode" value={mode} />
      <span className="mt-1 flex gap-2">
        <input name="birthDate" value={value} onChange={(e) => setValue(e.target.value)} disabled={mode === "keep"}
          placeholder={mode === "keep" ? "Hidden" : "MM/DD/YYYY"} autoComplete="off" className={`${className} mt-0`} />
        {mode === "keep" && (
          <>
            <button type="button" disabled={pending} title="Show the birthdate (recorded in the audit log)"
              onClick={() => start(async () => {
                const r = await revealBirthdate("registration", playerSeasonId, "Player edit page");
                if (r.error) { setError(r.error); return; }
                setValue(r.value ? us(r.value) : ""); setMode("set");
              })}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-3 text-sm text-foreground hover:bg-accent">
              <Eye className="h-4 w-4" /> {pending ? "…" : "Show"}
            </button>
            <button type="button" onClick={() => { setValue(""); setMode("set"); }} title="Type a new birthdate without showing the old one"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-3 text-sm text-foreground hover:bg-accent">
              <Pencil className="h-4 w-4" /> Change
            </button>
          </>
        )}
      </span>
      <span className="mt-1 block text-xs font-normal text-muted-foreground">
        {error ? <span className="text-rose-700 dark:text-rose-300">{error}</span>
          : mode === "keep" ? "Hidden to protect the player's privacy. Showing it is recorded in the audit log."
          : chartAge !== null ? `Age chart: league age ${chartAge}.`
          : iso ? (ageChart ? "Not on the age chart." : "No age chart for this season yet (Age chart page).")
          : value ? "Use MM/DD/YYYY." : "Missing. Set the age group by hand if you don't know it."}
      </span>
    </>
  );
}
