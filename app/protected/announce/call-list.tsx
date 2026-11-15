"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Search } from "lucide-react";
import { ExemptBadge, type ExemptScope } from "@/components/exempt-badge";
import { toggleCall } from "./actions";

export type CallRow = {
  player_season_id: number; first_name: string; last_name: string; league_age: number; evaluation_number: number | null;
  event_id: number; event_type: "primary" | "makeup"; start_time: string; end_time: string; location: string;
  checked_in_at: string | null; called_at: string | null; exempt_scope: ExemptScope | null;
};

// Exempt from being evaluated: shown, but not suggested in "Next up".
const notEvaluated = (r: CallRow) => r.exempt_scope === "evaluation" || r.exempt_scope === "both";
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const time = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

// The announcer's list for one day: pick an age group, read the bibs, tap each player as they're called.
export function CallList({ rows: initial, isMakeup }: { rows: CallRow[]; isMakeup: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const ages = useMemo(() => [...new Set(initial.map((r) => r.league_age))].sort((a, b) => a - b), [initial]);
  const [age, setAge] = useState<number | null>(ages[0] ?? null);
  const [hideAway, setHideAway] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "undo" | "error" } | null>(null);
  const [, startTransition] = useTransition();

  // New data from the server (after a tap or the 20-second refresh, which brings in new check-ins) replaces the copy.
  const [fromServer, setFromServer] = useState(initial);
  if (fromServer !== initial) { setFromServer(initial); setRows(initial); }
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 20000);
    return () => clearInterval(timer);
  }, [router]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const inAge = rows.filter((r) => r.league_age === age);
  const first = inAge[0];
  const called = inAge.filter((r) => r.called_at).length;
  const here = inAge.filter((r) => r.checked_in_at).length;
  // Next up: the next few here, not yet called, in bib order (the list is already in bib order).
  const nextUp = inAge.filter((r) => !r.called_at && r.checked_in_at && !notEvaluated(r) && r.evaluation_number !== null).slice(0, 5);
  const q = query.trim().toLowerCase();
  const shown = inAge.filter((r) =>
    q ? (/^\d+$/.test(q) ? String(r.evaluation_number ?? "").startsWith(q) : `${r.first_name} ${r.last_name}`.toLowerCase().includes(q))
      : !hideAway || r.checked_in_at || r.called_at);

  function tap(r: CallRow) {
    const was = Boolean(r.called_at);
    const label = r.evaluation_number ? `Bib ${r.evaluation_number}` : `${r.first_name} ${r.last_name}`;
    setRows((all) => all.map((x) => x.player_season_id === r.player_season_id ? { ...x, called_at: was ? null : new Date().toISOString() } : x));
    startTransition(async () => {
      const res = await toggleCall(r.player_season_id, r.event_id);
      if (res.error) {
        setRows((all) => all.map((x) => x.player_season_id === r.player_season_id ? { ...x, called_at: r.called_at } : x));
        setNotice({ text: res.error, tone: "error" });
      } else {
        setNotice(res.called ? { text: `${label} called (${r.first_name} ${r.last_name}).`, tone: "ok" }
          : { text: `Undone: ${label} is no longer marked called.`, tone: "undo" });
      }
    });
  }

  const pill = (active: boolean) => `min-h-11 min-w-11 rounded-full border px-3 text-base font-semibold ${active ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-card text-foreground"}`;

  if (ages.length === 0) {
    return <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">No players to call on this day.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="sticky top-14 z-10 -mx-4 space-y-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Age group">
          {ages.map((a) => (
            <button key={a} type="button" role="tab" aria-selected={age === a} className={pill(age === a)} onClick={() => { setAge(a); setQuery(""); }}>
              Age {a}
            </button>
          ))}
        </div>
        {first && (
          <p className="text-sm text-muted-foreground">
            {time(first.start_time)}–{time(first.end_time)} · {first.location}{isMakeup ? " · Makeup: players still to be seen" : ""}
          </p>
        )}
        <div className="rounded-lg bg-emerald-600 px-4 py-3 text-white">
          <p className="text-xs font-bold uppercase tracking-wider text-white/80">Next up</p>
          <p className="font-mono text-3xl font-bold tracking-wide">
            {nextUp.length ? nextUp.map((r) => r.evaluation_number).join("  ·  ") : called === inAge.length ? "Everyone called" : "No one waiting who's here"}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium text-foreground">{called} of {inAge.length} called · {here} here</span>
          <label className="flex items-center gap-2 text-foreground">
            <input type="checkbox" checked={hideAway} onChange={(e) => setHideAway(e.target.checked)} className="h-5 w-5" />
            Hide players not here
          </label>
        </div>
        <label className="relative block">
          <span className="sr-only">Find a bib or name</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a bib or name" autoComplete="off" inputMode="search"
            className="h-11 w-full rounded-lg border border-input bg-card pl-10 pr-3 text-base text-foreground" />
        </label>
      </div>

      {notice && (
        <p role="status" className={`fixed inset-x-4 bottom-4 z-20 mx-auto max-w-md rounded-lg p-3 text-center text-sm font-medium shadow-lg ${
          notice.tone === "ok" ? "bg-emerald-600 text-white" : notice.tone === "undo" ? "bg-amber-500 text-black" : "bg-rose-600 text-white"}`}>
          {notice.text}
        </p>
      )}

      {shown.length === 0 && <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">No one matches.</p>}
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {shown.map((r) => {
          const done = Boolean(r.called_at);
          const away = !r.checked_in_at;
          return (
            <li key={r.player_season_id} className={done ? "bg-emerald-500/10" : ""}>
              <button type="button" onClick={() => tap(r)}
                aria-label={`${done ? "Undo call for" : "Call"} bib ${r.evaluation_number ?? "none"}, ${r.first_name} ${r.last_name}`}
                className={`flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left active:bg-accent ${away && !done ? "opacity-55" : ""}`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-emerald-600 bg-emerald-600 text-white" : "border-border"}`}>
                  {done && <Check className="h-6 w-6" />}
                </span>
                <span className="w-20 shrink-0 font-mono text-3xl font-bold text-foreground">{r.evaluation_number ?? "—"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold text-foreground">{r.first_name} {r.last_name}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {done ? <span className="font-medium text-emerald-700 dark:text-emerald-300">Called {clock(r.called_at!)}</span>
                      : away ? <span>Not here</span> : <span className="font-medium text-emerald-700 dark:text-emerald-300">Here</span>}
                    {r.exempt_scope && <ExemptBadge scope={r.exempt_scope} />}
                    {r.evaluation_number === null && <span className="text-amber-700 dark:text-amber-300">No bib: ask check-in</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
