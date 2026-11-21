import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, Baby, Link2, Plus, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { groupSiblings, linkCoachKid, removeSibling, unlinkCoachKid } from "../actions";
import { FamilySuggestions } from "./suggestions";

type SearchParams = Promise<{ season?: string; message?: string; error?: string }>;

type Brief = { player_season_id: number; first_name: string; last_name: string; league_age: number | null; bib: number | null; is_coach_kid?: boolean };
type Parent = { user_id: string; name: string; teams: { team: string; division: string; role: string }[] };
type Overview = {
  coach_kids: (Brief & { parents: Parent[] })[];
  sibling_groups: { group_id: number; players: Brief[] }[];
  suggestions: { kind: "siblings" | "coach_kid"; key: string; players: Brief[]; parent: { user_id: string; name: string } | null }[];
  players: Brief[];
  coaches: { user_id: string; name: string }[];
};

const ROLE: Record<string, string> = { manager: "Manager", coach: "Coach", assistant_coach: "Assistant" };
const select = "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground";
const who = (p: Brief) => `${p.first_name} ${p.last_name}`;
const detail = (p: Brief) => `age ${p.league_age ?? "?"}${p.bib ? ` · #${p.bib}` : ""}`;

function PlayerOptions({ players, placeholder }: { players: Brief[]; placeholder: string }) {
  return (
    <>
      <option value="">{placeholder}</option>
      {players.map((p) => <option key={p.player_season_id} value={p.player_season_id}>{p.last_name}, {p.first_name} ({detail(p)})</option>)}
    </>
  );
}

async function FamiliesContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_admin_or_registrar");
  if (allowed !== true) redirect("/protected");

  const { data: seasonData } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
  const seasons = seasonData ?? [];
  const season = seasons.find((s) => String(s.id) === params.season) ?? seasons.find((s) => !s.is_closed) ?? seasons[0];
  if (!season) redirect("/protected");
  const { data, error } = await supabase.rpc("family_overview", { p_season_id: season.id });
  const o = (data ?? { coach_kids: [], sibling_groups: [], suggestions: [], players: [], coaches: [] }) as Overview;
  const hidden = <input type="hidden" name="seasonId" value={season.id} />;
  const unlinked = o.coach_kids.filter((k) => k.parents.length === 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href={`/protected/teams?season=${season.id}`}><ArrowLeft className="mr-1 h-4 w-4" /> Teams</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <Users className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> Coach&apos;s kids and siblings
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The draft keeps a coach&apos;s kid with their parent&apos;s team and siblings together. Link each coach&apos;s kid to their parent (a coach
          this season; the rules apply where the parent is a team&apos;s Manager or Coach), and group siblings. {season.name}.
        </p>
      </div>

      {params.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{params.message}</div>}
      {params.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{params.error}</div>}
      {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">Could not load: {error.message}</div>}

      {/* Suggestions: tick several to accept or dismiss together. */}
      <FamilySuggestions seasonId={season.id} suggestions={o.suggestions} />

      {/* Coach's kids */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <Baby className="h-5 w-5 text-sky-600" /> Coach&apos;s kids <span className="text-sm font-normal text-muted-foreground">({o.coach_kids.length})</span>
        </h2>
        {unlinked.length > 0 && (
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
            {unlinked.length} marked &quot;Coach&apos;s kid&quot; with no parent linked. The draft can only place a kid whose parent is linked.
          </p>
        )}
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2">Player</th><th className="px-3 py-2">Parent</th><th className="px-3 py-2">Link a parent</th></tr>
            </thead>
            <tbody>
              {o.coach_kids.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-muted-foreground">No coach&apos;s kids yet.</td></tr>}
              {o.coach_kids.map((k) => (
                <tr key={k.player_season_id} className={`border-t border-border align-top ${k.parents.length === 0 ? "bg-amber-500/5" : ""}`}>
                  <td className="px-3 py-2">
                    <Link href={`/protected/players/${k.player_season_id}`} className="font-medium text-foreground hover:underline">{k.last_name}, {k.first_name}</Link>
                    <div className="text-xs text-muted-foreground">{detail(k)}</div>
                  </td>
                  <td className="px-3 py-2">
                    {k.parents.length === 0 && <span className="text-xs font-medium text-amber-700 dark:text-amber-300">No parent linked</span>}
                    <ul className="space-y-1">
                      {k.parents.map((p) => (
                        <li key={p.user_id} className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {p.teams.length ? p.teams.map((t) => `${ROLE[t.role] ?? t.role}, ${t.division} ${t.team}`).join("; ") : "not on a team yet"}
                          </span>
                          <form action={unlinkCoachKid}>{hidden}<input type="hidden" name="playerSeasonId" value={k.player_season_id} />
                            <input type="hidden" name="parentUserId" value={p.user_id} />
                            <button type="submit" title="Remove this link" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3.5 w-3.5" /><span className="sr-only">Remove link</span></button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-2">
                    <form action={linkCoachKid} className="flex gap-2">{hidden}<input type="hidden" name="playerSeasonId" value={k.player_season_id} />
                      <select name="parentUserId" required defaultValue="" aria-label={`Parent of ${who(k)}`} className={select}>
                        <option value="">Choose a coach…</option>
                        {o.coaches.filter((c) => !k.parents.some((p) => p.user_id === c.user_id)).map((c) => <option key={c.user_id} value={c.user_id}>{c.name}</option>)}
                      </select>
                      <Button type="submit" size="sm" variant="outline" className="h-9"><Link2 className="mr-1 h-3.5 w-3.5" /> Link</Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={linkCoachKid} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-3">{hidden}
          <span className="w-full text-sm font-medium text-foreground">Add a coach&apos;s kid</span>
          <select name="playerSeasonId" required defaultValue="" aria-label="Player" className={`${select} min-w-64`}>
            <PlayerOptions players={o.players} placeholder="Choose the player…" />
          </select>
          <select name="parentUserId" required defaultValue="" aria-label="Parent" className={select}>
            <option value="">Choose the parent (a coach)…</option>
            {o.coaches.map((c) => <option key={c.user_id} value={c.user_id}>{c.name}</option>)}
          </select>
          <Button type="submit" size="sm" className="h-9"><Plus className="mr-1 h-4 w-4" /> Link</Button>
          <span className="w-full text-xs text-muted-foreground">Twins: link each twin to the same parent. Linking also marks the player &quot;Coach&apos;s kid&quot;.</span>
        </form>
      </section>

      {/* Siblings */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <Users className="h-5 w-5 text-emerald-600" /> Sibling groups <span className="text-sm font-normal text-muted-foreground">({o.sibling_groups.length})</span>
        </h2>
        {o.sibling_groups.length === 0 && <p className="text-sm text-muted-foreground">No sibling groups yet.</p>}
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {o.sibling_groups.map((g) => (
            <li key={g.group_id} className="rounded-xl border border-border bg-card p-4">
              <ul className="space-y-1">
                {g.players.map((p) => (
                  <li key={p.player_season_id} className="flex items-center justify-between gap-2 text-sm">
                    <span><span className="font-medium">{who(p)}</span> <span className="text-xs text-muted-foreground">{detail(p)}</span></span>
                    <form action={removeSibling}>{hidden}<input type="hidden" name="playerSeasonId" value={p.player_season_id} />
                      <button type="submit" title="Take out of this group" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3.5 w-3.5" /><span className="sr-only">Remove {who(p)}</span></button>
                    </form>
                  </li>
                ))}
              </ul>
              <form action={groupSiblings} className="mt-3 flex gap-2">{hidden}
                {g.players.slice(0, 1).map((p) => <input key={p.player_season_id} type="hidden" name="playerSeasonId" value={p.player_season_id} />)}
                <select name="playerSeasonId" required defaultValue="" aria-label="Add a sibling" className={`${select} min-w-0 flex-1`}>
                  <PlayerOptions players={o.players.filter((x) => !g.players.some((p) => p.player_season_id === x.player_season_id))} placeholder="+ Add a sibling…" />
                </select>
                <Button type="submit" size="sm" variant="outline" className="h-9">Add</Button>
              </form>
            </li>
          ))}
        </ul>
        <form action={groupSiblings} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-3">{hidden}
          <span className="w-full text-sm font-medium text-foreground">New sibling group</span>
          {[0, 1, 2].map((i) => (
            <select key={i} name="playerSeasonId" required={i < 2} defaultValue="" aria-label={`Sibling ${i + 1}`} className={`${select} min-w-56`}>
              <PlayerOptions players={o.players} placeholder={i < 2 ? `Sibling ${i + 1}…` : "Sibling 3 (optional)…"} />
            </select>
          ))}
          <Button type="submit" size="sm" className="h-9"><Plus className="mr-1 h-4 w-4" /> Group</Button>
        </form>
      </section>
    </div>
  );
}

export default function FamiliesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <FamiliesContent searchParams={searchParams} />
    </Suspense>
  );
}
