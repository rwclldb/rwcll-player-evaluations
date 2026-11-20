"use client";

import { useMemo, useState } from "react";
import { ArrowRightLeft, Baby, Download, Eye, EyeOff, History, Search, Shirt, UserMinus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL, moveTargets, placementLabel, type RosterDivision, type SeasonRosters } from "@/lib/team-rosters";
import { movePlayer, releaseRosters } from "./actions";

const input = "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground";
const name = (p: { first_name: string; last_name: string }) => `${p.last_name}, ${p.first_name}`;
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

function MoveForm({ divisions, divisionId, onTeam, onSave, onCancel, busy }: {
  divisions: RosterDivision[]; divisionId: number | null; onTeam: boolean; busy: boolean;
  onSave: (teamId: number | null, note: string) => void; onCancel: () => void;
}) {
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="mt-2 space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2">
      <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Move to" className={`${input} w-full`}>
        <option value="">{onTeam ? "Move to…" : "Place on…"}</option>
        {onTeam && <option value="pool">Back to the pool (unplaced)</option>}
        {moveTargets(divisions, divisionId).map((g) => (
          <optgroup key={g.division} label={g.division}>
            {g.teams.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.count}{t.size ? ` of ${t.size}` : ""})</option>)}
          </optgroup>
        ))}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why? (kept in the log)" aria-label="Note" className={`${input} w-full`} />
      {target === "pool" && <p className="text-xs text-muted-foreground">If their draft is still running, their pick opens again and comes up next.</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !target || note.trim().length < 3} onClick={() => onSave(target === "pool" ? null : Number(target), note)}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function RosterBoard({ seasonId, initial, isAdmin }: { seasonId: number; initial: SeasonRosters; isAdmin: boolean }) {
  const [data, setData] = useState(initial);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState("");
  const divisionOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of data.divisions) for (const t of d.teams) for (const p of t.players) m.set(p.player_season_id, d.season_division_id);
    return m;
  }, [data]);
  const match = (p: { first_name: string; last_name: string; bib: number | null }) => {
    const s = q.trim().toLowerCase().replace(/^#/, "");
    return !s || `${p.first_name} ${p.last_name} ${p.last_name}, ${p.first_name} ${p.bib ?? ""}`.toLowerCase().includes(s);
  };

  async function run(fn: () => ReturnType<typeof movePlayer>, ok: string) {
    setBusy(true); setMessage(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) { setData(r.data); setOpen(null); setMessage({ ok: true, text: ok }); } else setMessage({ ok: false, text: r.message });
  }

  const unplacedByPool = useMemo(() => {
    const groups = new Map<string, typeof data.unplaced>();
    for (const u of data.unplaced.filter(match)) {
      const k = u.pools?.[u.pools.length - 1] ?? "In no division's pool";
      groups.set(k, [...(groups.get(k) ?? []), u]);
    }
    return [...groups.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.unplaced, q]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a player by name or bib" aria-label="Find a player" className={`${input} w-full pl-8`} />
        </label>
        <Button asChild variant="outline" size="sm"><a href={`/protected/team-rosters/export?season=${seasonId}`}><Download className="mr-1 h-4 w-4" /> Download CSV</a></Button>
      </div>
      {message && <div role={message.ok ? "status" : "alert"} className={`rounded-lg border p-3 text-sm ${message.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"}`}>{message.text}</div>}
      <nav aria-label="Divisions" className="flex flex-wrap gap-2">
        {data.divisions.map((d) => (
          <a key={d.season_division_id} href={`#div-${d.season_division_id}`} className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent">
            {d.name} <span className="opacity-70">({d.teams.reduce((n, t) => n + t.players.length, 0)})</span>
          </a>
        ))}
        <a href="#unplaced" className="rounded-md border border-amber-500/50 bg-card px-3 py-1.5 text-sm hover:bg-accent">Unplaced <span className="opacity-70">({data.unplaced.length})</span></a>
      </nav>

      {data.divisions.map((d) => (
        <section key={d.season_division_id} id={`div-${d.season_division_id}`} className="scroll-mt-24 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
            <h2 className="text-xl font-bold text-foreground">{d.name} <span className="text-sm font-normal text-muted-foreground">
              {d.teams.length} {d.teams.length === 1 ? "team" : "teams"} · {plural(d.teams.reduce((n, t) => n + t.players.length, 0), "player")}{d.draft_status ? ` · draft ${d.draft_status === "done" ? "finished" : d.draft_status}` : ""}</span></h2>
            {d.teams.length > 0 && <a href={`/protected/drafts/${d.season_division_id}/make-teams`} className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">Make teams</a>}
            {d.teams.length > 0 && (d.released_at ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-800 dark:text-emerald-300"><Eye className="h-4 w-4" /> Released to managers and coaches</span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => releaseRosters(seasonId, d.season_division_id, false), `${d.name} rosters hidden again.`)}><EyeOff className="mr-1 h-4 w-4" /> Unrelease</Button>
              </span>
            ) : (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                if (window.confirm(`Release the ${d.name} rosters? Each team's manager, coach and assistants will see their own team.`)) run(() => releaseRosters(seasonId, d.season_division_id, true), `${d.name} rosters released.`);
              }}><Eye className="mr-1 h-4 w-4" /> Release rosters</Button>
            ))}
          </div>
          {d.teams.length === 0 && <p className="text-sm text-muted-foreground">No teams yet (Teams page).</p>}
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {d.teams.map((t) => {
              const players = t.players.filter(match);
              if (q && players.length === 0) return null;
              return (
                <li key={t.id} className="rounded-xl border border-border bg-card p-3 shadow-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="flex items-center gap-1.5 font-bold text-foreground"><Shirt className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> {t.name}</h3>
                    <span className={`text-xs ${t.roster_size && t.players.length > t.roster_size ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
                      {t.players.length}{t.roster_size ? ` of ${t.roster_size}` : ""} {(t.roster_size ?? t.players.length) === 1 ? "player" : "players"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.staff.length ? t.staff.map((s) => `${ROLE_LABEL[s.role]}: ${s.name}${isAdmin && s.email ? ` (${s.email})` : ""}`).join(" · ") : "No staff yet"}
                  </p>
                  <ol className="mt-2 divide-y divide-border text-sm">
                    {players.map((p) => (
                      <li key={p.player_season_id} className="py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-10 shrink-0 text-xs text-muted-foreground">{p.bib ? `#${p.bib}` : ""}</span>
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{name(p)}</span> <span className="text-xs text-muted-foreground">age {p.league_age ?? "?"}</span>
                            {p.is_coach_kid && <Baby className="ml-1 inline h-3.5 w-3.5 text-sky-600" aria-label="Coach's kid" />}
                            <span className="block text-[11px] text-muted-foreground">{placementLabel(p.placement)}{p.placement.how === "moved" ? `: "${p.placement.note}"` : ""}</span>
                          </span>
                          <button type="button" onClick={() => setOpen(open === p.player_season_id ? null : p.player_season_id)} aria-label={`Move ${name(p)}`}
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowRightLeft className="h-4 w-4" /></button>
                        </div>
                        {open === p.player_season_id && (
                          <MoveForm divisions={data.divisions} divisionId={divisionOf.get(p.player_season_id) ?? null} onTeam busy={busy} onCancel={() => setOpen(null)}
                            onSave={(teamId, note) => run(() => movePlayer(seasonId, p.player_season_id, teamId, note), `Moved ${p.first_name} ${p.last_name}.`)} />
                        )}
                      </li>
                    ))}
                    {t.players.length === 0 && <li className="py-1.5 text-muted-foreground">No players yet.</li>}
                  </ol>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section id="unplaced" className="scroll-mt-24 space-y-3">
        <h2 className="flex items-center gap-2 border-b border-border pb-2 text-xl font-bold text-foreground"><UserMinus className="h-5 w-5 text-amber-600" /> Unplaced <span className="text-sm font-normal text-muted-foreground">{data.unplaced.length} players not on a team</span></h2>
        {unplacedByPool.length === 0 && <p className="text-sm text-muted-foreground">Everyone is on a team.</p>}
        {unplacedByPool.map(([pool, list]) => (
          <div key={pool} className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">{pool === "In no division's pool" ? pool : `In the ${pool} pool`} <span className="font-normal text-muted-foreground">({list.length})</span></h3>
            <ul className="grid gap-x-4 gap-y-1 text-sm md:grid-cols-2 xl:grid-cols-3">
              {list.map((u) => (
                <li key={u.player_season_id}>
                  <div className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-xs text-muted-foreground">{u.bib ? `#${u.bib}` : ""}</span>
                    <span className="min-w-0 flex-1"><span className="font-medium">{name(u)}</span> <span className="text-xs text-muted-foreground">age {u.league_age ?? "?"}{u.pools && u.pools.length > 1 ? ` · also ${u.pools.slice(0, -1).join(", ")}` : ""}</span></span>
                    <button type="button" onClick={() => setOpen(open === u.player_season_id ? null : u.player_season_id)} aria-label={`Place ${name(u)} on a team`}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowRightLeft className="h-4 w-4" /></button>
                  </div>
                  {open === u.player_season_id && (
                    <MoveForm divisions={data.divisions} divisionId={data.divisions.find((d) => d.name === u.pools?.[u.pools.length - 1])?.season_division_id ?? null} onTeam={false} busy={busy}
                      onCancel={() => setOpen(null)} onSave={(teamId, note) => run(() => movePlayer(seasonId, u.player_season_id, teamId, note), `Placed ${u.first_name} ${u.last_name}.`)} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground"><History className="h-5 w-5" /> Moves <span className="text-sm font-normal text-muted-foreground">({data.moves.length})</span></h2>
        {data.moves.length === 0 ? <p className="text-sm text-muted-foreground">No players moved by hand yet.</p> : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {data.moves.map((m, i) => (
              <li key={i} className="px-3 py-2">
                <span className="font-medium">{m.first_name} {m.last_name}</span>: {m.from ?? "unplaced"} → {m.to ?? "the pool"}
                {m.pick_removed && <span className="ml-1 rounded bg-amber-500/15 px-1 text-xs text-amber-800 dark:text-amber-300">pick reopened</span>}
                <span className="text-xs text-muted-foreground"> · &ldquo;{m.note}&rdquo; · {m.by}, {new Date(m.at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /> Released rosters show each team&apos;s manager, coach and assistants their own team on their home page.</p>
    </div>
  );
}
