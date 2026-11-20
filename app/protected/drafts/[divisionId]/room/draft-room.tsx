"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Baby, Flag, MonitorPlay, Pause, Play, Settings2, Star, StickyNote, Timer, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SORTS, clockLeft, pickRule, sortPlayers, sortValue, type Board, type RoomPlayer, type SortKey } from "@/lib/draft-room";
import { fetchBoard, fetchPlayers, finishDraft, makePick, pauseDraft, saveNote, siblingDecision, toggleStar } from "../../room-actions";

const POLL_MS = 3000;
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Number(n).toFixed(2));
const name = (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`;
const KIND: Record<string, string> = { coach_kid: "Coach's kid", sibling: "Sibling" };

function useBoard(draftId: number, initial: Board) {
  const [board, setBoard] = useState(initial);
  const [skew, setSkew] = useState(() => Date.parse(initial.now) - Date.now());
  const [stale, setStale] = useState(false);
  const apply = useCallback((b: Board) => { setBoard(b); setSkew(Date.parse(b.now) - Date.now()); setStale(false); }, []);
  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return;
      const r = await fetchBoard(draftId).catch(() => null);
      if (r?.ok) apply(r.data); else setStale(true);
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [draftId, apply]);
  return { board, apply, skew, stale };
}

function Clock({ board, skew }: { board: Board; skew: number }) {
  const [, setT] = useState(0);
  useEffect(() => { const id = setInterval(() => setT((x) => x + 1), 1000); return () => clearInterval(id); }, []);
  const left = clockLeft(board, skew);
  if (left === null) return null;
  const over = left < 0;
  const m = Math.floor(Math.abs(left) / 60), s = Math.abs(left) % 60;
  return (
    <span className={`flex items-center gap-1 rounded-md px-2 py-1 font-mono text-lg font-bold tabular-nums ${over ? "bg-rose-600 text-white" : left <= 15 ? "bg-amber-500 text-white" : "bg-muted text-foreground"}`}>
      <Timer className="h-4 w-4" />{over ? "-" : ""}{m}:{String(s).padStart(2, "0")}
    </span>
  );
}

function BoardGrid({ board, big = false, labels }: { board: Board; big?: boolean; labels: Map<number, string> }) {
  const teams = [...board.teams].filter((t) => t.position !== null).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const rounds = Math.max(0, ...board.slots.map((s) => s.round));
  const at = new Map(board.slots.map((s) => [`${s.round}:${s.team_id}`, s]));
  const mine = new Set(board.my_team_ids);
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className={`w-full border-collapse ${big ? "text-base" : "text-xs"}`}>
        <thead>
          <tr className="bg-muted/50">
            <th className="sticky left-0 z-10 bg-muted px-2 py-2 text-left font-semibold text-muted-foreground">Rd</th>
            {teams.map((t) => (
              <th key={t.team_id} className={`min-w-28 px-2 py-2 text-left font-semibold ${mine.has(t.team_id) ? "text-emerald-700 dark:text-emerald-400" : "text-foreground"}`}>
                {t.name}{mine.has(t.team_id) && <span className="ml-1 text-[10px] font-normal">(you)</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => (
            <tr key={r} className="border-t border-border">
              <td className="sticky left-0 z-10 bg-card px-2 py-1.5 font-semibold text-muted-foreground">{r}</td>
              {teams.map((t) => {
                const s = at.get(`${r}:${t.team_id}`);
                if (!s) return <td key={t.team_id} className="bg-muted/30" />;
                const current = board.next?.overall === s.overall && board.draft.status !== "done";
                return (
                  <td key={t.team_id} className={`px-2 py-1.5 align-top ${current ? "bg-emerald-500/15 ring-2 ring-inset ring-emerald-500" : s.marked && !s.pick ? "bg-amber-500/10" : ""}`}>
                    {s.pick ? (
                      <div>
                        <div className="font-semibold leading-tight text-foreground">{s.pick.bib ? `#${s.pick.bib} ` : ""}{name(s.pick)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          age {s.pick.league_age ?? "?"}{KIND[s.pick.kind] ? ` · ${KIND[s.pick.kind]}` : ""}{s.pick.override ? " · override" : ""}{s.pick.moved_to ? ` · moved to ${s.pick.moved_to}` : ""}
                        </div>
                      </div>
                    ) : current ? (
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">On the clock</span>
                    ) : labels.has(s.overall) ? (
                      <span className="text-[10px] font-semibold text-violet-700 dark:text-violet-300">{labels.get(s.overall)}</span>
                    ) : s.marked ? (
                      <span className="text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300">Must draft</span>
                    ) : <span className="text-muted-foreground/50">{s.overall}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NoteEditor({ player, onSaved }: { player: RoomPlayer; onSaved: (text: string) => void }) {
  const [text, setText] = useState(player.my_note ?? "");
  const [msg, setMsg] = useState("");
  return (
    <div className="mt-2 space-y-1">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-label={`My note on ${name(player)}`}
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground" placeholder="Only you can see this note." />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={async () => {
          const r = await saveNote(player.player_season_id, text);
          setMsg(r.ok ? "Saved" : r.message);
          if (r.ok) onSaved(text);
        }}>Save note</Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
    </div>
  );
}

export function DraftRoom({ draftId, divisionId, initialBoard, initialPlayers, projector }: {
  draftId: number; divisionId: number; initialBoard: Board; initialPlayers: RoomPlayer[]; projector: boolean;
}) {
  const { board, apply, skew, stale } = useBoard(draftId, initialBoard);
  const [players, setPlayers] = useState(initialPlayers);
  const [sort, setSort] = useState<SortKey>("evaluator");
  const [show, setShow] = useState<"available" | "must" | "starred" | "drafted">("available");
  const [age, setAge] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openNote, setOpenNote] = useState<number | null>(null);
  const [tab, setTab] = useState<"players" | "board" | "team">("players");
  const knownIds = useRef(new Set(initialPlayers.map((p) => p.player_season_id)));

  // A player added to the pool during the draft: load the list again.
  useEffect(() => {
    if (board.available.some((id) => !knownIds.current.has(id))) {
      fetchPlayers(draftId).then((r) => { if (r.ok) { setPlayers(r.data); knownIds.current = new Set(r.data.map((p) => p.player_season_id)); } });
    }
  }, [board.available, draftId]);

  const available = useMemo(() => new Set(board.available), [board.available]);
  const teamName = useMemo(() => new Map(board.teams.map((t) => [t.team_id, t.name])), [board.teams]);
  const onClock = board.next ? teamName.get(board.next.team_id) ?? "" : "";
  const queued = useMemo(() => new Map(board.queued.map((q) => [q.player_season_id, q.team_id])), [board.queued]);
  const ages = useMemo(() => [...new Set(players.map((p) => p.league_age).filter((a): a is number => a !== null))].sort((a, b) => b - a), [players]);
  const list = useMemo(() => {
    const base = players.filter((p) => {
      const isAvail = available.has(p.player_season_id);
      if (show === "drafted") return !isAvail;
      if (!isAvail) return false;
      if (show === "must" && !p.must_draft) return false;
      if (show === "starred" && !p.starred) return false;
      return age === null || p.league_age === age;
    });
    return sortPlayers(base, sort);
  }, [players, available, show, age, sort]);
  // Next best: the top available player under the current sort who could be taken now without an override
  // (the team on the clock for admins; my team for a manager or coach).
  const myTeam = board.my_team_ids[0] ?? null;
  const nextBest = list.find((p) => {
    if (!available.has(p.player_season_id)) return false;
    const r = board.reserved[String(p.player_season_id)];
    if (r && r !== (board.can_run ? board.next?.team_id : myTeam)) return false;
    if (r) return true;
    if (board.draft.age_order === "open" && board.next?.must_only && !p.must_draft) return false;
    if (board.draft.age_order === "oldest_first" && board.tier_age !== null && p.league_age !== board.tier_age) return false;
    return true;
  });
  const sel = players.find((p) => p.player_season_id === selected) ?? null;
  // Queued siblings: shown in their team's next open slot.
  const labels = useMemo(() => {
    const m = new Map<number, string>();
    for (const q of board.queued) {
      const slot = board.slots.find((x) => x.team_id === q.team_id && !x.pick && !m.has(x.overall));
      const p = players.find((x) => x.player_season_id === q.player_season_id);
      if (slot && p) m.set(slot.overall, `Sibling: ${p.first_name} ${p.last_name}`);
    }
    return m;
  }, [board.queued, board.slots, players]);
  const rule = sel ? pickRule(board, sel) : null;
  const running = board.draft.status === "live";

  async function act(fn: () => Promise<{ ok: true; data: Board } | { ok: false; message: string }>) {
    setBusy(true); setError("");
    const r = await fn();
    setBusy(false);
    if (r.ok) { apply(r.data); setSelected(null); setNote(""); } else setError(r.message);
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-sm">
      <div>
        <h1 className="text-xl font-black tracking-tight text-foreground sm:text-2xl">{board.draft.division} draft <span className="text-sm font-normal text-muted-foreground">{board.draft.season}</span></h1>
        <p className="text-sm text-muted-foreground">
          {board.draft.status === "done" ? "Finished." : board.draft.status === "paused" ? "Paused." : board.next
            ? <>On the clock: <strong className="text-foreground">{onClock}</strong> · round {board.next.round}, pick {board.next.pick_in_round} ({board.next.overall} overall)</>
            : "Every pick has been made."}
          {board.draft.status !== "done" && <> · {board.available.length} left · {board.must_left} must be drafted</>}
          {board.tier_age !== null && board.draft.status !== "done" && <> · <strong className="text-foreground">{board.tier_age}-year-olds</strong> now</>}
        </p>
        {stale && <p className="text-xs text-amber-700 dark:text-amber-300">Can&apos;t reach the server; showing the last update.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Clock board={board} skew={skew} />
        {board.draft.status === "paused" && <span className="rounded-md bg-amber-500 px-2 py-1 text-sm font-bold text-white">PAUSED</span>}
        {board.can_run && !projector && board.draft.status !== "done" && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => pauseDraft(draftId, running))}>
              {running ? <><Pause className="mr-1 h-4 w-4" /> Pause</> : <><Play className="mr-1 h-4 w-4" /> Resume</>}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => {
              if (window.confirm(`Finish the ${board.draft.division} draft? ${board.available.length} undrafted ${board.available.length === 1 ? "player drops" : "players drop"} to the next division whose ages fit. This can't be undone.`)) act(() => finishDraft(draftId));
            }}><Flag className="mr-1 h-4 w-4" /> Finish draft</Button>
          </>
        )}
        {!projector && (
          <Button asChild size="sm" variant="ghost"><Link href={`/protected/drafts/${divisionId}/room?view=board`} target="_blank"><MonitorPlay className="mr-1 h-4 w-4" /> Projector</Link></Button>
        )}
        {board.can_run && !projector && <Button asChild size="sm" variant="ghost"><Link href={`/protected/drafts/${divisionId}`}><Settings2 className="mr-1 h-4 w-4" /> Setup</Link></Button>}
      </div>
    </div>
  );

  if (projector) {
    const last = [...board.slots].filter((s) => s.pick).sort((a, b) => Date.parse(b.pick!.made_at) - Date.parse(a.pick!.made_at)).slice(0, 3);
    return (
      <div className="space-y-4">
        {header}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl bg-emerald-700 p-6 text-white lg:col-span-1">
            <div className="text-sm uppercase tracking-widest text-white/70">On the clock</div>
            <div className="text-5xl font-black">{board.draft.status === "done" ? "Done" : onClock || "—"}</div>
            {board.next && <div className="mt-1 text-lg text-white/80">Round {board.next.round} · pick {board.next.pick_in_round}</div>}
          </div>
          <div className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
            <div className="text-sm uppercase tracking-widest text-muted-foreground">Latest picks</div>
            <ol className="mt-2 space-y-1 text-2xl">
              {last.map((s) => <li key={s.overall}><strong>{teamName.get(s.team_id)}</strong>: {s.pick!.bib ? `#${s.pick!.bib} ` : ""}{name(s.pick!)}</li>)}
              {last.length === 0 && <li className="text-muted-foreground">No picks yet.</li>}
            </ol>
          </div>
        </div>
        <BoardGrid board={board} big labels={labels} />
      </div>
    );
  }

  const asks = board.asks.length > 0 && (
    <div role="alert" className="space-y-2 rounded-xl border-2 border-amber-500 bg-amber-500/10 p-3">
      {board.asks.map((a) => (
        <div key={a.player_season_id} className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-foreground">
            <strong>{name(a)}</strong> (age {a.league_age ?? "?"}) is {a.because_of ? `${name(a.because_of)}'s` : "a"} sibling. Take them with {teamName.get(a.team_id)}&apos;s next pick, or send them down to the next division?
          </p>
          {board.can_run ? (
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => act(() => siblingDecision(draftId, a.player_season_id, true))}>Take with next pick</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => siblingDecision(draftId, a.player_season_id, false))}>Send down</Button>
            </div>
          ) : <span className="text-sm text-muted-foreground">Waiting for the admin.</span>}
        </div>
      ))}
    </div>
  );

  const playerList = (
    <section aria-label="Players" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="ml-1 h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            {SORTS.filter((s) => s.key !== "mine" || !board.can_run).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <select value={age ?? ""} onChange={(e) => setAge(e.target.value ? Number(e.target.value) : null)} aria-label="Age" className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground">
          <option value="">All ages</option>
          {ages.map((a) => <option key={a} value={a}>Age {a}</option>)}
        </select>
        <div className="flex flex-wrap gap-1">
          {(["available", "must", ...(board.can_run ? [] : ["starred"]), "drafted"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setShow(k as typeof show)}
              className={`rounded-md border px-2 py-1 text-xs ${show === k ? "border-emerald-500 bg-emerald-600 text-white" : "border-border bg-card hover:bg-accent"}`}>
              {k === "available" ? "Available" : k === "must" ? "Must draft" : k === "starred" ? "My stars" : "Drafted"}
            </button>
          ))}
        </div>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {list.length === 0 && <li className="p-3 text-sm text-muted-foreground">Nobody here.</li>}
        {list.map((p) => {
          const isNext = p === nextBest && show !== "drafted";
          const reservedFor = board.reserved[String(p.player_season_id)];
          const picked = !available.has(p.player_season_id);
          return (
            <li key={p.player_season_id} data-player={p.player_season_id} data-must={p.must_draft ? "yes" : "no"} data-reserved={reservedFor ? "yes" : "no"}
              data-queued={queued.has(p.player_season_id) ? "yes" : "no"} data-age={p.league_age ?? ""}
              className={`px-3 py-2 ${selected === p.player_season_id ? "bg-emerald-500/15" : isNext ? "bg-sky-500/10" : ""} ${board.can_run && running && !picked ? "cursor-pointer hover:bg-accent" : ""}`}
              onClick={() => { if (board.can_run && running && !picked) { setSelected(p.player_season_id); setNote(""); setError(""); } }}>
              <div className="flex items-center gap-2">
                {!board.can_run && (
                  <button type="button" aria-label={p.starred ? `Unstar ${name(p)}` : `Star ${name(p)}`} onClick={async (e) => {
                    e.stopPropagation();
                    const r = await toggleStar(p.player_season_id);
                    if (r.ok) setPlayers((all) => all.map((x) => x.player_season_id === p.player_season_id ? { ...x, starred: r.data } : x)); else setError(r.message);
                  }}><Star className={`h-4 w-4 ${p.starred ? "fill-amber-400 text-amber-500" : "text-muted-foreground"}`} /></button>
                )}
                <span className="w-10 shrink-0 text-xs text-muted-foreground">{p.bib ? `#${p.bib}` : ""}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">{p.last_name}, {p.first_name}</span> <span className="text-xs text-muted-foreground">age {p.league_age ?? "?"}</span>
                  <span className="ml-1 inline-flex flex-wrap gap-1 align-middle text-[10px]">
                    {isNext && <span className="rounded bg-sky-600 px-1 font-semibold text-white">Next best</span>}
                    {p.must_draft && !picked && <span className="rounded bg-emerald-600 px-1 font-semibold text-white">Must</span>}
                    {reservedFor && <span className="rounded bg-sky-500/20 px-1 text-sky-800 dark:text-sky-300"><Baby className="inline h-3 w-3" /> {teamName.get(reservedFor)}</span>}
                    {queued.has(p.player_season_id) && <span className="rounded bg-violet-500/20 px-1 text-violet-800 dark:text-violet-300">Sibling → {teamName.get(queued.get(p.player_season_id)!)}</span>}
                    {p.sibling_group && <span className="rounded bg-muted px-1">Sibling</span>}
                    {p.evaluations === 0 && <span className="rounded bg-rose-500/15 px-1 text-rose-800 dark:text-rose-300">No ratings</span>}
                  </span>
                </span>
                {!board.can_run && (
                  <button type="button" aria-label={`My note on ${name(p)}`} onClick={(e) => { e.stopPropagation(); setOpenNote(openNote === p.player_season_id ? null : p.player_season_id); }}>
                    <StickyNote className={`h-4 w-4 ${p.my_note ? "text-amber-600" : "text-muted-foreground"}`} />
                  </button>
                )}
              </div>
              <div className="mt-0.5 flex gap-3 pl-12 text-xs tabular-nums text-muted-foreground">
                {SORTS.filter((s) => s.key !== "mine" || !board.can_run).map((s) => (
                  <span key={s.key} className={sort === s.key ? "font-bold text-foreground" : ""}>{s.short} {fmt(sortValue(p, s.key))}</span>
                ))}
              </div>
              {openNote === p.player_season_id && <div onClick={(e) => e.stopPropagation()}><NoteEditor player={p} onSaved={(t) => setPlayers((all) => all.map((x) => x.player_season_id === p.player_season_id ? { ...x, my_note: t } : x))} /></div>}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">Coach* = coach average with each skill&apos;s highest and lowest coach score left out. {board.can_run ? "" : "Stars and notes are yours alone."}</p>
    </section>
  );

  const myTeams = board.teams.filter((t) => board.my_team_ids.includes(t.team_id));
  const teamPanel = myTeams.map((t) => {
    const picks = board.slots.filter((s) => s.team_id === t.team_id && s.pick);
    return (
      <section key={t.team_id} className="rounded-xl border border-border bg-card p-3">
        <h2 className="flex items-center gap-2 font-bold text-foreground"><Users className="h-4 w-4" /> {t.name} <span className="text-xs font-normal text-muted-foreground">{picks.length} of {t.roster_size}</span></h2>
        <ol className="mt-1 space-y-0.5 text-sm">
          {picks.map((s) => <li key={s.overall}><span className="text-xs text-muted-foreground">Rd {s.round}</span> {s.pick!.bib ? `#${s.pick!.bib} ` : ""}{name(s.pick!)} <span className="text-xs text-muted-foreground">age {s.pick!.league_age ?? "?"}</span></li>)}
          {picks.length === 0 && <li className="text-muted-foreground">No players yet.</li>}
        </ol>
      </section>
    );
  });

  return (
    <div className="space-y-3 pb-28">
      {header}
      {asks}
      {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{error}</div>}
      <nav className="flex gap-1 lg:hidden" aria-label="Views">
        {(["players", "board", ...(myTeams.length ? ["team"] : [])] as const).map((k) => (
          <button key={k} type="button" onClick={() => setTab(k as typeof tab)} className={`flex-1 rounded-md border px-2 py-1.5 text-sm ${tab === k ? "border-emerald-500 bg-emerald-600 text-white" : "border-border bg-card"}`}>
            {k === "players" ? "Players" : k === "board" ? "Board" : "My team"}
          </button>
        ))}
      </nav>
      <div className="grid gap-3 lg:grid-cols-5">
        <div className={`space-y-3 lg:col-span-3 ${tab === "board" ? "" : "hidden lg:block"}`}><BoardGrid board={board} labels={labels} /></div>
        <div className={`space-y-3 lg:col-span-2 ${tab === "board" ? "hidden lg:block" : ""}`}>
          <div className={tab === "team" ? "hidden lg:block" : ""}>{playerList}</div>
          <div className={tab === "team" ? "space-y-3" : "hidden space-y-3 lg:block"}>{teamPanel}</div>
        </div>
      </div>

      {board.can_run && sel && board.next && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-emerald-500 bg-card p-3 shadow-2xl">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
            <p className="text-sm text-foreground">
              Pick <strong>{sel.bib ? `#${sel.bib} ` : ""}{name(sel)}</strong> (age {sel.league_age ?? "?"}) for <strong>{onClock}</strong>?
              {rule?.why && <span className="ml-2 inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><AlertTriangle className="h-4 w-4" /> {rule.why}</span>}
            </p>
            {rule?.needsNote && (
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why override? (kept with the pick)" aria-label="Override note"
                className="h-9 min-w-64 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground" />
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button>
              <Button disabled={busy || !rule?.allowed || (rule.needsNote && note.trim().length < 3) || board.asks.length > 0}
                onClick={() => act(() => makePick(draftId, sel.player_season_id, rule?.needsNote ? note : ""))}>
                Pick for {onClock}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
