import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, ClipboardCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { closeTeamRatings, openTeamRatings } from "./actions";
import { ConfirmSubmit } from "./confirm-submit";
import type { RatingTeam } from "@/lib/team-ratings";

type SearchParams = Promise<{ season?: string; message?: string; error?: string }>;
type Progress = {
  season_closed: boolean;
  window: { opened_at: string; opened_by: string | null; closed_at: string | null; closed_by: string | null; is_open: boolean } | null;
  teams: { team_id: number; team: string; division: string; manager: string | null; manager_signed_in: boolean | null; players: number; rated: number; not_rated: number; last_saved_at: string | null }[];
};

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Bar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-muted"><div className={`h-full ${done === total && total > 0 ? "bg-emerald-600" : "bg-amber-500"}`} style={{ width: `${pct}%` }} /></div>
      <span className="text-xs tabular-nums text-muted-foreground">{done} of {total}</span>
    </div>
  );
}

async function AdminView({ params }: { params: Awaited<SearchParams> }) {
  const supabase = await createClient();
  const { data: seasonData } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
  const seasons = seasonData ?? [];
  const season = seasons.find((s) => String(s.id) === params.season) ?? seasons.find((s) => !s.is_closed) ?? seasons[0];
  if (!season) redirect("/protected");
  const { data, error } = await supabase.rpc("admin_team_rating_progress", { p_season_id: season.id });
  const p = (data ?? { season_closed: false, window: null, teams: [] }) as Progress;
  const total = p.teams.reduce((n, t) => n + t.players, 0);
  const rated = p.teams.reduce((n, t) => n + t.rated, 0);
  const notRated = p.teams.reduce((n, t) => n + t.not_rated, 0);
  const w = p.window;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> Roadmap</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <ClipboardCheck className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> End-of-season ratings
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          At the end of {season.name}, each team&apos;s manager rates the players on their team with the evaluation-day form: the five
          core skills, optional pitching and catching, or Not rated. Next season these are the players&apos; prior-year ratings on the
          draft report and while scoring. Open ratings when the season ends, then close them when the managers are done.
        </p>
        {seasons.length > 1 && (
          <form action="/protected/team-ratings" className="flex items-end gap-2">
            <select name="season" defaultValue={season.id} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_closed ? " (closed)" : ""}</option>)}
            </select>
            <Button type="submit" variant="outline" size="sm">Show</Button>
          </form>
        )}
      </div>
      {params.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{params.message}</div>}
      {(params.error || error) && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{params.error ?? error?.message}</div>}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="text-sm">
          {!w && <p><strong>Not open yet.</strong> Managers can&apos;t rate until you open ratings.</p>}
          {w?.is_open && <p><strong className="text-emerald-700 dark:text-emerald-400">Open</strong> since {when(w.opened_at)}{w.opened_by ? ` (${w.opened_by})` : ""}. Managers can rate and change their ratings.</p>}
          {w && !w.is_open && w.closed_at && <p><strong>Closed</strong> on {when(w.closed_at)}{w.closed_by ? ` (${w.closed_by})` : ""}. Managers can look but not change; you can still fill in a rating.</p>}
          {p.season_closed && <p className="mt-1 text-muted-foreground">The season is closed, so ratings can&apos;t change.</p>}
        </div>
        {!p.season_closed && (
          <form action={w?.is_open ? closeTeamRatings : openTeamRatings}>
            <input type="hidden" name="seasonId" value={season.id} />
            {w?.is_open
              ? <ConfirmSubmit variant="outline" label="Close ratings" question="Close end-of-season ratings? Managers can still see what they saved but can't change it. You can open them again." />
              : <ConfirmSubmit label={w ? "Open ratings again" : "Open ratings"} question={`Open end-of-season ratings for ${season.name}? Each team's manager gets a Rate your players card on their home page.`} />}
          </form>
        )}
      </section>

      {p.teams.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No teams in {season.name} yet. Ratings are per team, so set up teams and rosters first.</p>
      ) : (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-foreground">Teams</h2>
          <p className="text-sm text-muted-foreground">
            {plural(total, "player")} on teams: {rated} rated, {notRated} marked Not rated, {total - rated - notRated} to do.
          </p>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr>
                <th className="px-3 py-2">Team</th><th className="px-3 py-2">Manager</th><th className="px-3 py-2">Done</th><th className="px-3 py-2">Not rated</th><th className="px-3 py-2">Last saved</th><th className="px-3 py-2"></th>
              </tr></thead>
              <tbody>
                {p.teams.map((t) => (
                  <tr key={t.team_id} className="border-t border-border">
                    <td className="px-3 py-2"><span className="font-medium">{t.team}</span> <span className="text-muted-foreground">· {t.division}</span></td>
                    <td className="px-3 py-2">
                      {t.manager ?? <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" /> No manager</span>}
                      {t.manager && t.manager_signed_in === false && <span className="block text-xs text-amber-700 dark:text-amber-400">hasn&apos;t signed in yet</span>}
                    </td>
                    <td className="px-3 py-2"><Bar done={t.rated + t.not_rated} total={t.players} /></td>
                    <td className="px-3 py-2 tabular-nums">{t.not_rated || ""}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{when(t.last_saved_at)}</td>
                    <td className="px-3 py-2 text-right"><Link href={`/protected/team-ratings/${t.team_id}`} className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Open shows a team&apos;s ratings. You can fill one in for a manager (it&apos;s recorded as yours) until the season is closed.</p>
        </section>
      )}
    </div>
  );
}

async function ManagerView() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_rating_teams");
  const teams = (data ?? []) as RatingTeam[];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
        <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> Home</Link>
      </Button>
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground"><ClipboardCheck className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> Rate your players</h1>
      <p className="text-sm text-muted-foreground">Rate each player on your team the way you would on evaluation day. Next season&apos;s coaches see these as the player&apos;s prior-year ratings.</p>
      {teams.length === 0 && <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Nothing to rate right now. Team managers rate their players here when the league opens end-of-season ratings.</p>}
      {teams.map((t) => (
        <Link key={t.team_id} href={`/protected/team-ratings/${t.team_id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 hover:border-emerald-500/50">
          <span><strong>{t.team}</strong> <span className="text-sm text-muted-foreground">· {t.division} · {t.season}{t.is_open ? "" : " · closed"}</span></span>
          <Bar done={t.rated + t.not_rated} total={t.players} />
        </Link>
      ))}
    </div>
  );
}

async function TeamRatingsContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  return isAdmin === true ? <AdminView params={params} /> : <ManagerView />;
}

export default function TeamRatingsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading ratings…</p>}>
      <TeamRatingsContent searchParams={searchParams} />
    </Suspense>
  );
}
