"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Baby, Lock, Shuffle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { makeTeams, ratingOf, spread, teamStats, type Sources, type TMPlayer, type TMTeam } from "@/lib/team-maker";
import { saveTeams } from "./actions";

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(2));
const SOURCE_LABEL: Record<keyof Sources, string> = { evaluator: "Evaluator average", coach: "Coach average", prior: "Prior-year rating" };

export function TeamMaker({ divisionId, divisionName, teams, players }: { divisionId: number; divisionName: string; teams: TMTeam[]; players: TMPlayer[] }) {
  const router = useRouter();
  const [sources, setSources] = useState<Sources>({ evaluator: true, coach: true, prior: false });
  const [balanceAges, setBalanceAges] = useState(true);
  const [seed, setSeed] = useState(1);
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const result = useMemo(() => makeTeams(players, teams, { sources, balanceAges, seed }), [players, teams, sources, balanceAges, seed]);
  const teamOf = useMemo(() => ({ ...result.teamOf, ...overrides }), [result, overrides]);
  const stats = useMemo(() => teamStats(players, teams, teamOf, sources), [players, teams, teamOf, sources]);
  const toPlace = players.filter((p) => p.team_id === null);
  const placedAlready = players.length - toPlace.length;
  const gap = spread(stats);
  const restart = (fn: () => void) => { fn(); setOverrides({}); setError(""); };

  async function save() {
    const assignments = toPlace.map((p) => ({ player_season_id: p.player_season_id, team_id: teamOf[p.player_season_id] }));
    if (!window.confirm(`Place ${assignments.length} players on the ${divisionName} teams as shown? Each placement is logged; players can still be moved afterwards on Team rosters.`)) return;
    setBusy(true); setError("");
    const r = await saveTeams(divisionId, assignments, {
      sources: (Object.keys(sources) as (keyof Sources)[]).filter((k) => sources[k]), balance_ages: balanceAges, seed, moved_by_hand: Object.keys(overrides).length,
      team_averages: Object.fromEntries(stats.map((s) => [teams.find((t) => t.id === s.id)?.name, s.average === null ? null : Number(s.average.toFixed(2))])),
    });
    setBusy(false);
    if (r.ok) router.push(`/protected/team-rosters#div-${divisionId}`); else setError(r.message);
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border border-border bg-card p-4">
        <fieldset>
          <legend className="text-sm font-semibold text-foreground">Balance on</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {(Object.keys(SOURCE_LABEL) as (keyof Sources)[]).map((k) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="checkbox" checked={sources[k]} onChange={(e) => restart(() => setSources({ ...sources, [k]: e.target.checked }))} className="h-4 w-4" /> {SOURCE_LABEL[k]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{result.random ? "Nothing ticked: teams are completely random (coach's kids and siblings still stay together)." : "A player's number is the average of the ticked ratings they have; players with none count as the group's middle."}</p>
        </fieldset>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={balanceAges} disabled={result.random} onChange={(e) => restart(() => setBalanceAges(e.target.checked))} className="h-4 w-4" /> Balance ages too</label>
        <Button variant="outline" onClick={() => restart(() => setSeed((s) => s + 1))}><Shuffle className="mr-1 h-4 w-4" /> Make again</Button>
      </section>

      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground">{toPlace.length}</strong> players to place{placedAlready ? ` (${placedAlready} already on teams stay where they are)` : ""} on {teams.length} {teams.length === 1 ? "team" : "teams"}:
        {" "}{stats.map((s) => s.count).join(" / ")} players.
        {!result.random && gap !== null && <> Team averages are within <strong className="text-foreground">{gap.toFixed(2)}</strong> of each other.</>}
        {Object.keys(overrides).length > 0 && <> {Object.keys(overrides).length} moved by hand.</>}
      </p>
      {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{error}</div>}

      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {teams.map((t) => {
          const s = stats.find((x) => x.id === t.id)!;
          const mine = players.filter((p) => teamOf[p.player_season_id] === t.id)
            .sort((a, b) => (result.rating[b.player_season_id] ?? 0) - (result.rating[a.player_season_id] ?? 0));
          return (
            <li key={t.id} className="rounded-xl border border-border bg-card p-3 shadow-sm">
              <h3 className="font-bold text-foreground">{t.name}</h3>
              <p className="text-xs text-muted-foreground">{t.staff.filter((x) => x.role !== "assistant_coach").map((x) => x.name).join(" · ") || "No staff yet"}</p>
              <p className="mt-1 text-xs">
                <strong>{s.count}</strong> players{!result.random && <> · average <strong>{fmt(s.average)}</strong></>}
                {" · "}{Object.entries(s.ages).sort((a, b) => Number(b[0]) - Number(a[0])).map(([a, n]) => `${n}×${a}`).join(", ")}
              </p>
              <ol className="mt-2 divide-y divide-border text-sm">
                {mine.map((p) => {
                  const why = result.fixed[p.player_season_id];
                  const r = ratingOf(p, sources);
                  return (
                    <li key={p.player_season_id} className="flex items-center gap-1.5 py-1">
                      <span className="w-9 shrink-0 text-xs text-muted-foreground">{p.bib ? `#${p.bib}` : ""}</span>
                      <span className="min-w-0 flex-1 truncate" title={why || undefined}>
                        {p.last_name}, {p.first_name} <span className="text-xs text-muted-foreground">{p.league_age}</span>
                        {why && <span className="ml-1 text-[10px] text-sky-700 dark:text-sky-300">{why.startsWith("Coach") ? <Baby className="inline h-3 w-3" /> : why.startsWith("Already") ? <Lock className="inline h-3 w-3" /> : <Users className="inline h-3 w-3" />} {why}</span>}
                      </span>
                      {!result.random && <span className="text-xs tabular-nums text-muted-foreground">{r === null ? "—" : r.toFixed(1)}</span>}
                      {p.team_id === null && (
                        <select value={teamOf[p.player_season_id]} aria-label={`Team for ${p.first_name} ${p.last_name}`}
                          onChange={(e) => setOverrides({ ...overrides, [p.player_season_id]: Number(e.target.value) })}
                          className="h-7 w-20 rounded border border-input bg-background px-1 text-xs text-foreground">
                          {teams.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      )}
                    </li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy || toPlace.length === 0} onClick={save}>Place {toPlace.length} players on these teams</Button>
        <span className="text-xs text-muted-foreground">Nothing is saved until you press this. A sibling group or coach&apos;s kid moved by hand isn&apos;t kept together automatically.</span>
      </div>
    </div>
  );
}
