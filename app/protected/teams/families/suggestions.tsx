"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyFamilySuggestions, type FamilySuggestionChoice } from "../actions";

type Brief = { player_season_id: number; first_name: string; last_name: string; league_age: number | null; bib: number | null };
export type Suggestion = { kind: "siblings" | "coach_kid"; key: string; players: Brief[]; parent: { user_id: string; name: string } | null };

const who = (p: Brief) => `${p.first_name} ${p.last_name}`;
const detail = (p: Brief) => `age ${p.league_age ?? "?"}${p.bib ? ` · #${p.bib}` : ""}`;
const id = (s: Suggestion) => `${s.kind}|${s.key}`;
const label = (s: Suggestion) => s.kind === "siblings" ? s.players.map(who).join(" and ") : `${s.players[0] ? who(s.players[0]) : "?"} as ${s.parent?.name ?? "?"}'s kid`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Suggestions from the registration file, with checkboxes to accept or dismiss many at once (and the single buttons). */
export function FamilySuggestions({ seasonId, suggestions }: { seasonId: number; suggestions: Suggestion[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string; failures?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const groups = useMemo(() => ([
    { kind: "siblings" as const, title: "Same Sports Connect account (siblings?)", items: suggestions.filter((s) => s.kind === "siblings") },
    { kind: "coach_kid" as const, title: "Registered with a coach's email (coach's kid?)", items: suggestions.filter((s) => s.kind === "coach_kid") },
  ]).filter((g) => g.items.length > 0), [suggestions]);
  const chosen = suggestions.filter((s) => picked.has(id(s)));

  const toggle = (keys: string[], on: boolean) => setPicked((cur) => {
    const next = new Set(cur);
    keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
    return next;
  });

  function run(action: "accept" | "dismiss", items: Suggestion[]) {
    if (items.length === 0) return;
    if (items.length > 1 && !window.confirm(`${action === "accept" ? "Accept" : "Dismiss"} ${plural(items.length, "suggestion")}?`)) return;
    const payload: FamilySuggestionChoice[] = items.map((s) => ({
      kind: s.kind, key: s.key, playerSeasonIds: s.players.map((p) => p.player_season_id), parentUserId: s.parent?.user_id ?? null, label: label(s),
    }));
    setNotice(null);
    startTransition(async () => {
      const result = await applyFamilySuggestions({ seasonId, action, items: payload });
      if (!result.ok) { setNotice({ kind: "error", text: result.message }); return; }
      const failedKeys = new Set(result.failed.map((f) => f.key));
      // Keep only the ones that were refused ticked, so they can be looked at again.
      setPicked(new Set(items.filter((s) => failedKeys.has(s.key)).map(id)));
      const verb = action === "accept" ? "accepted" : "dismissed";
      setNotice({
        kind: result.failed.length ? "error" : "ok",
        text: `${plural(result.done, "suggestion")} ${verb}.${result.failed.length ? ` ${plural(result.failed.length, "suggestion")} couldn't be ${verb}:` : ""}`,
        failures: result.failed.map((f) => `${f.label}: ${f.message}`),
      });
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
        <Lightbulb className="h-5 w-5 text-amber-500" /> Suggestions <span className="text-sm font-normal text-muted-foreground">({suggestions.length})</span>
      </h2>
      <p className="text-sm text-muted-foreground">
        From the Sports Connect registration file: players registered by the same account, and players registered with a coach&apos;s
        sign-in email. Nothing is linked until you accept. Tick several and use the buttons below to accept or dismiss them together.
        (Only a fingerprint of the account email is kept, never the email.)
      </p>
      {notice && (
        <div role={notice.kind === "error" ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${notice.kind === "error" ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>
          {notice.text}
          {notice.failures && notice.failures.length > 0 && <ul className="mt-1 list-disc pl-5">{notice.failures.map((f, i) => <li key={i}>{f}</li>)}</ul>}
        </div>
      )}
      {suggestions.length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No suggestions waiting.</p>}

      {suggestions.length > 0 && (
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/95 p-2 shadow-sm backdrop-blur">
          <label className="flex items-center gap-2 px-1 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={chosen.length === suggestions.length}
              ref={(el) => { if (el) el.indeterminate = chosen.length > 0 && chosen.length < suggestions.length; }}
              onChange={(e) => toggle(suggestions.map(id), e.target.checked)} />
            Select all
          </label>
          <span className="text-sm text-muted-foreground">{chosen.length} selected</span>
          <span className="ml-auto flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending || chosen.length === 0} onClick={() => run("accept", chosen)}>
              {pending ? "Working…" : `Accept selected (${chosen.length})`}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending || chosen.length === 0} onClick={() => run("dismiss", chosen)}>
              Dismiss selected
            </Button>
          </span>
        </div>
      )}

      {groups.map((g) => {
        const keys = g.items.map(id);
        const all = keys.every((k) => picked.has(k));
        return (
          <div key={g.kind} className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
              <input type="checkbox" className="h-4 w-4" checked={all} onChange={(e) => toggle(keys, e.target.checked)} />
              {g.title} <span className="font-normal text-muted-foreground">({g.items.length})</span>
            </label>
            <ul className="grid gap-2 md:grid-cols-2">
              {g.items.map((s) => {
                const k = id(s);
                const on = picked.has(k);
                return (
                  <li key={k} className={`flex items-start gap-3 rounded-xl border p-3 ${on ? "border-emerald-500/60 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`}>
                    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={on} onChange={(e) => toggle([k], e.target.checked)}
                      aria-label={`Select: ${label(s)}`} data-suggestion={k} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        {s.kind === "siblings"
                          ? s.players.map((p, i) => <span key={p.player_season_id}>{i > 0 && " and "}<strong>{who(p)}</strong> ({detail(p)})</span>)
                          : <><strong>{s.players[0] ? who(s.players[0]) : "?"}</strong> ({s.players[0] ? detail(s.players[0]) : ""}) as <strong>{s.parent?.name}</strong>&apos;s kid</>}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" className="h-8" disabled={pending} onClick={() => run("accept", [s])}>
                          {s.kind === "siblings" ? "Group as siblings" : `Link as ${s.parent?.name}'s kid`}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" className="h-8" disabled={pending} onClick={() => run("dismiss", [s])}>
                          {s.kind === "siblings" ? "Not siblings" : "Not their kid"}
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
