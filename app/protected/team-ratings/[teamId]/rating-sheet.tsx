"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RatingInputs } from "../../evaluations/rating-inputs";
import { blankCore, CORE_CODES, coreAverage, nextAfter, sheetProgress, type RatingSheet, type SheetPlayer } from "@/lib/team-ratings";
import { saveTeamRating } from "../actions";

type Category = { id: number; code: string; name: string; category_group: string; sort_order: number };

const STATUS_LABEL = { todo: "To do", rated: "Rated", not_rated: "Not rated" } as const;
const STATUS_CLASS = {
  todo: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  rated: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  not_rated: "border-border bg-muted text-muted-foreground",
} as const;
const name = (p: SheetPlayer) => `${p.last_name}, ${p.first_name}`;

export function TeamRatingSheet({ sheet, categories, byAdmin }: { sheet: RatingSheet; categories: Category[]; byAdmin: boolean }) {
  const [players, setPlayers] = useState<SheetPlayer[]>(sheet.players);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const player = players.find((p) => p.player_season_id === selected) ?? null;
  const index = player ? players.indexOf(player) : -1;
  const { done, total } = sheetProgress(players);

  // The URL follows the player (?player=), so the phone's Back button returns to the list.
  useEffect(() => {
    const read = () => { const v = new URLSearchParams(window.location.search).get("player"); setSelected(v ? Number(v) : null); };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const readScores = useCallback((): Record<string, number | null> => {
    const form = formRef.current;
    if (!form) return {};
    const data = new FormData(form);
    return Object.fromEntries(categories.map((c) => { const v = String(data.get(`rating_${c.code}`) ?? ""); return [c.code, v === "" ? null : Number(v)]; }));
  }, [categories]);

  const changed = useCallback(() => {
    if (!player || !sheet.can_save || !formRef.current) return false;
    const now = readScores();
    return categories.some((c) => (now[c.code] ?? null) !== (player.ratings[c.code] ?? null));
  }, [player, sheet.can_save, readScores, categories]);

  const go = useCallback((id: number | null, ask = true) => {
    if (ask && changed() && !window.confirm("You changed this player's scores without saving. Leave anyway?")) return;
    setNotice(null);
    setSelected(id);
    const url = id === null ? window.location.pathname : `${window.location.pathname}?player=${id}`;
    window.history.pushState({ player: id }, "", url);
    window.scrollTo({ top: 0 });
  }, [changed]);

  async function save(notRated: boolean, andNext: boolean) {
    if (!player) return;
    const scores = readScores();
    if (!notRated && !CORE_CODES.some((c) => typeof scores[c] === "number")) {
      setNotice({ kind: "error", text: "Rate at least one of the five core skills, or choose Not rated." });
      return;
    }
    setBusy(true);
    const result = await saveTeamRating(sheet.team_id, player.player_season_id, scores, notRated);
    setBusy(false);
    if (!result.ok) { setNotice({ kind: "error", text: result.message }); return; }
    const updated = players.map((p) => p.player_season_id === player.player_season_id ? { ...p, status: result.status, ratings: result.ratings, saved_at: result.savedAt } : p);
    setPlayers(updated);
    const label = result.status === "not_rated" ? `${player.first_name} marked Not rated.` : `${player.first_name} saved.`;
    if (andNext) {
      const next = nextAfter(updated, player.player_season_id);
      go(next, false);
      setNotice({ kind: "ok", text: next === null ? `${label} That was the last player.` : label });
    } else {
      setNotice({ kind: "ok", text: label });
    }
  }

  const Notice = notice && (
    <p role={notice.kind === "error" ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${notice.kind === "error" ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>{notice.text}</p>
  );
  const Header = (
    <div className="space-y-1">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{sheet.team} <span className="text-base font-normal text-muted-foreground">{sheet.division} · {sheet.season}</span></h1>
      <p className="text-sm text-muted-foreground">{done} of {total} done{sheet.manager ? ` · Manager: ${sheet.manager}` : ""}</p>
      {!sheet.can_save && <p className="rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">Ratings are closed, so you can look but not change them. Ask a league admin if something needs fixing.</p>}
      {sheet.can_save && byAdmin && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">You&apos;re an admin: what you save here is recorded as yours, on behalf of the manager.</p>}
    </div>
  );

  if (!player) {
    return (
      <div className="space-y-4">
        {Header}
        {Notice}
        {sheet.can_save && total > done && <p className="text-sm text-muted-foreground">Tap a player to rate them. Same 1–5 scale as evaluation day. Leave a skill blank if you didn&apos;t see it; choose <strong>Not rated</strong> if you can&apos;t rate the player at all.</p>}
        {total === 0 && <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No players on this team.</p>}
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {players.map((p) => {
            const avg = coreAverage(p.ratings);
            const blanks = p.status === "rated" ? blankCore(p.ratings) : 0;
            return (
              <li key={p.player_season_id}>
                <button type="button" onClick={() => go(p.player_season_id)} data-player={p.player_season_id}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent">
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">{name(p)}</span>
                    <span className="text-xs text-muted-foreground">{p.bib ? `Bib ${p.bib} · ` : ""}Age {p.league_age ?? "?"}{avg !== null ? ` · core average ${avg.toFixed(1)}` : ""}{blanks ? ` · ${blanks} blank` : ""}</span>
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const prev = index > 0 ? players[index - 1] : null;
  const next = index < players.length - 1 ? players[index + 1] : null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => go(null)}><List className="mr-1 h-4 w-4" /> All players</Button>
        <span className="text-xs text-muted-foreground">{index + 1} of {players.length} · {done} done</span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{name(player)}</h1>
        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[player.status]}`}>{STATUS_LABEL[player.status]}</span>
      </div>
      <p className="text-sm text-muted-foreground">{sheet.team} · {player.bib ? `Bib ${player.bib} · ` : ""}Age {player.league_age ?? "?"}</p>
      {Notice}
      {sheet.can_save ? (
        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); void save(false, true); }} className="space-y-4 rounded-xl border border-border bg-card p-4">
          <RatingInputs key={`${player.player_season_id}-${player.saved_at ?? ""}`} categories={categories}
            initialScores={Object.fromEntries(categories.map((c) => [c.code, player.ratings[c.code] ?? null]))} />
          <div className="grid gap-2 sm:grid-cols-3">
            <Button type="submit" disabled={busy}>Save &amp; Next</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void save(false, false)}>Save</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { if (window.confirm(`Mark ${player.first_name} as Not rated? Any scores you picked aren't kept.`)) void save(true, true); }}>Not rated</Button>
          </div>
        </form>
      ) : (
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          {player.status === "todo" && <p className="text-muted-foreground">Not rated before ratings closed.</p>}
          {player.status === "not_rated" && <p className="text-muted-foreground">Marked Not rated.</p>}
          {player.status === "rated" && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              {categories.filter((c) => typeof player.ratings[c.code] === "number").map((c) => (
                <div key={c.code} className="contents"><dt className="text-muted-foreground">{c.name}</dt><dd className="font-mono font-semibold">{player.ratings[c.code]}</dd></div>
              ))}
            </dl>
          )}
        </div>
      )}
      <div className="flex justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={!prev} onClick={() => prev && go(prev.player_season_id)}><ChevronLeft className="mr-1 h-4 w-4" /> Previous</Button>
        <Button type="button" variant="ghost" size="sm" disabled={!next} onClick={() => next && go(next.player_season_id)}>Next <ChevronRight className="ml-1 h-4 w-4" /></Button>
      </div>
    </div>
  );
}
