"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Search } from "lucide-react";
import { CoachKidBadge } from "@/components/coach-kid-badge";
import { setBib, toggleCheckIn } from "./actions";

export type CheckInRow = {
  player_season_id: number; first_name: string; last_name: string; date_of_birth: string | null; league_age: number;
  evaluation_number: number | null; is_coach_kid: boolean; event_id: number; event_type: "primary" | "makeup";
  start_time: string; end_time: string; location: string; checked_in_at: string | null;
};

const time = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export function CheckInList({ rows: initial, isMakeup }: { rows: CheckInRow[]; isMakeup: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState("");
  const [age, setAge] = useState<number | "all">("all");
  const [show, setShow] = useState<"waiting" | "all">("waiting");
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "undo" | "error" } | null>(null);
  const [bibFor, setBibFor] = useState<number | null>(null);
  const [bibText, setBibText] = useState("");
  const [, startTransition] = useTransition();
  // Players tapped on this screen stay listed in "Not here yet" so a quick tap can be undone.
  const [recent, setRecent] = useState<Set<number>>(new Set());

  // New data from the server (after an action or the 30-second refresh) replaces the local copy.
  const [fromServer, setFromServer] = useState(initial);
  if (fromServer !== initial) { setFromServer(initial); setRows(initial); }
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 30000);
    return () => clearInterval(timer);
  }, [router]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const ages = useMemo(() => [...new Set(rows.map((r) => r.league_age))].sort((a, b) => a - b), [rows]);
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (age === "all" || r.league_age === age) &&
    (q ? (/^\d+$/.test(q) ? String(r.evaluation_number ?? "").startsWith(q) : `${r.first_name} ${r.last_name} ${r.last_name}, ${r.first_name}`.toLowerCase().includes(q))
       : show === "all" || !r.checked_in_at || recent.has(r.player_season_id)));
  const inAge = rows.filter((r) => age === "all" || r.league_age === age);
  const here = inAge.filter((r) => r.checked_in_at).length;

  function tap(r: CheckInRow) {
    const name = `${r.first_name} ${r.last_name}`;
    const was = Boolean(r.checked_in_at);
    setRecent((s) => new Set(s).add(r.player_season_id));
    setRows((all) => all.map((x) => x.player_season_id === r.player_season_id ? { ...x, checked_in_at: was ? null : new Date().toISOString() } : x));
    startTransition(async () => {
      const res = await toggleCheckIn(r.player_season_id, r.event_id);
      if (res.error) {
        setRows((all) => all.map((x) => x.player_season_id === r.player_season_id ? { ...x, checked_in_at: r.checked_in_at } : x));
        setNotice({ text: res.error, tone: "error" });
      } else {
        setNotice(res.checkedIn ? { text: `${name} checked in${r.evaluation_number ? ` (bib ${r.evaluation_number})` : " (no bib yet)"}.`, tone: "ok" }
          : { text: `Undone: ${name} is no longer checked in.`, tone: "undo" });
      }
    });
  }

  function saveBib(r: CheckInRow) {
    const value = bibText;
    startTransition(async () => {
      const res = await setBib(r.player_season_id, value);
      if (res.error) { setNotice({ text: res.error, tone: "error" }); return; }
      setRows((all) => all.map((x) => x.player_season_id === r.player_season_id ? { ...x, evaluation_number: Number(value) } : x));
      setNotice({ text: `${r.first_name} ${r.last_name} now wears bib ${value}.`, tone: "ok" });
      setBibFor(null); setBibText("");
    });
  }

  const pill = (active: boolean) => `min-h-10 rounded-full border px-3 text-sm ${active ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-card text-foreground"}`;

  return (
    <div className="space-y-3">
      <div className="sticky top-14 z-10 -mx-4 space-y-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <label className="relative block">
          <span className="sr-only">Find a player by name or bib</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or bib" autoComplete="off" inputMode="search"
            className="h-12 w-full rounded-lg border border-input bg-card pl-10 pr-3 text-lg text-foreground" />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={pill(age === "all")} onClick={() => { setAge("all"); setRecent(new Set()); }}>All ages</button>
          {ages.map((a) => <button key={a} type="button" className={pill(age === a)} onClick={() => { setAge(a); setRecent(new Set()); }}>{a}</button>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium text-foreground">{here} of {inAge.length} here{isMakeup ? " (makeup: only players who still need evaluating)" : ""}</span>
          {!q && (
            <span className="flex gap-1">
              <button type="button" className={pill(show === "waiting")} onClick={() => setShow("waiting")}>Not here yet</button>
              <button type="button" className={pill(show === "all")} onClick={() => setShow("all")}>Everyone</button>
            </span>
          )}
        </div>
      </div>

      {notice && (
        <p role="status" className={`fixed inset-x-4 bottom-4 z-20 mx-auto max-w-md rounded-lg p-3 text-center text-sm font-medium shadow-lg ${
          notice.tone === "ok" ? "bg-emerald-600 text-white" : notice.tone === "undo" ? "bg-amber-500 text-black" : "bg-rose-600 text-white"}`}>
          {notice.text}
        </p>
      )}

      {shown.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {q ? "No one matches. Not registered? Add them as a walk-up." : show === "waiting" ? "Everyone here is checked in." : "No players."}
        </p>
      )}
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {shown.map((r) => {
          const done = Boolean(r.checked_in_at);
          return (
            <li key={r.player_season_id} className={done ? "bg-emerald-500/10" : ""}>
              <div className="flex items-stretch">
                <button type="button" onClick={() => tap(r)}
                  aria-label={`${done ? "Undo check-in for" : "Check in"} ${r.first_name} ${r.last_name}`}
                  className="flex min-h-16 flex-1 items-center gap-3 px-3 py-2 text-left active:bg-accent">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-emerald-600 bg-emerald-600 text-white" : "border-border"}`}>
                    {done && <Check className="h-5 w-5" />}
                  </span>
                  <span className="w-14 shrink-0 font-mono text-xl font-bold text-foreground">{r.evaluation_number ?? "—"}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold text-foreground">{r.last_name}, {r.first_name}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      Age {r.league_age} · {time(r.start_time)}
                      {r.is_coach_kid && <CoachKidBadge short />}
                      {done && <span className="font-medium text-emerald-700 dark:text-emerald-300">Here</span>}
                    </span>
                  </span>
                </button>
                {r.evaluation_number === null && bibFor !== r.player_season_id && (
                  <button type="button" onClick={() => { setBibFor(r.player_season_id); setBibText(""); }}
                    className="m-2 shrink-0 rounded-md border border-dashed border-amber-500 px-3 text-sm font-medium text-amber-800 dark:text-amber-300">+ Bib</button>
                )}
              </div>
              {bibFor === r.player_season_id && (
                <form onSubmit={(e) => { e.preventDefault(); saveBib(r); }} className="flex items-center gap-2 px-3 pb-3">
                  <label className="text-sm text-muted-foreground" htmlFor={`bib-${r.player_season_id}`}>Bib for {r.first_name}</label>
                  <input id={`bib-${r.player_season_id}`} value={bibText} onChange={(e) => setBibText(e.target.value)} inputMode="numeric" autoFocus
                    className="h-11 w-28 rounded-md border border-input bg-background px-3 font-mono text-lg text-foreground" />
                  <button type="submit" className="h-11 rounded-md bg-emerald-600 px-4 font-medium text-white">Save</button>
                  <button type="button" onClick={() => setBibFor(null)} className="h-11 px-2 text-sm text-muted-foreground">Cancel</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
