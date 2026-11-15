import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { AutoRefresh } from "./auto-refresh";

type Row = {
  session_id: number; league_age: number; session_status: string; released: boolean; players: number; checked_in_today: number; called: number;
  user_id: string | null; scorer_name: string | null; evaluator_type: "coach" | "independent_evaluator" | null;
  saved: number; not_evaluated: number; drafts: number; last_saved_at: string | null; called_not_done: number;
};
type SearchParams = Promise<{ season?: string }>;

const STALE_MINUTES = 15;
const STATUS: Record<string, { label: string; className: string }> = {
  open: { label: "Scoring open", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
  setup: { label: "Not open yet", className: "bg-muted text-muted-foreground" },
  locked: { label: "Locked", className: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
};

function ago(iso: string, now: number) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Evaluation day: how far each assigned coach and independent evaluator has got in each age group (admins).
async function ProgressContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");

  const { data: seasonData } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
  const seasons = seasonData ?? [];
  const season = seasons.find((s) => String(s.id) === sp.season) ?? seasons.find((s) => !s.is_closed) ?? seasons[0];
  const { data, error } = season ? await supabase.rpc("admin_scoring_progress", { p_season_id: season.id }) : { data: [], error: null };
  const rows = (data ?? []) as Row[];
  // eslint-disable-next-line react-hooks/purity -- the page is re-rendered every 30 seconds; "now" is meant to change.
  const now = Date.now();

  const groups = [...new Map(rows.map((r) => [r.session_id, rows.filter((x) => x.session_id === r.session_id)])).values()]
    .sort((a, b) => Number(b[0].session_status === "open") - Number(a[0].session_status === "open") || a[0].league_age - b[0].league_age);
  const open = rows.filter((r) => r.session_status === "open" && r.user_id);
  // Not started yet, and started but quiet for a while (the ones worth a nudge).
  const notStarted = open.filter((r) => !r.last_saved_at);
  const quiet = open.filter((r) => r.last_saved_at && (now - new Date(r.last_saved_at).getTime()) / 60000 > STALE_MINUTES);

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={30} />
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> Roadmap</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground sm:text-3xl">
          <Gauge className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> Scoring Progress
        </h1>
        <p className="text-sm text-muted-foreground">
          How far each coach and independent evaluator has got in each age group: players done (saved or not evaluated) out of the players
          registered at that age. &quot;Called&quot; counts players the announcer has called up. Updates every 30 seconds. Counts only;
          scores are on Data Review. After the day, the <Link href="/protected/end-of-day" className="underline">End-of-day check</Link> lists anyone who may have been missed.
        </p>
        {seasons.length > 1 && (
          <form className="flex items-end gap-2">
            <label className="text-xs text-muted-foreground">Season
              <select name="season" defaultValue={season?.id} className="mt-1 block h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_closed ? " (closed)" : ""}</option>)}
              </select>
            </label>
            <Button type="submit" variant="outline" className="h-10">Show</Button>
          </form>
        )}
      </div>

      {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">Could not load progress: {error.message}</p>}
      {open.length > 0 && (
        <p className={`rounded-lg border p-3 text-sm ${quiet.length ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200" : "border-border bg-card text-foreground"}`}>
          {open.length - notStarted.length} of {open.length} people scoring open age groups have started.
          {quiet.length > 0
            ? ` Quiet for ${STALE_MINUTES}+ minutes: ${quiet.map((r) => `${r.scorer_name} (age ${r.league_age})`).join(", ")}.`
            : notStarted.length < open.length ? ` Everyone who has started saved in the last ${STALE_MINUTES} minutes.` : ""}
        </p>
      )}
      {groups.length === 0 && !error && <p className="text-sm text-muted-foreground">No age groups are set up for this season yet.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => {
          const head = g[0];
          const people = g.filter((r) => r.user_id);
          const status = STATUS[head.session_status] ?? STATUS.setup;
          return (
            <section key={head.session_id} className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-foreground">Age {head.league_age}</h2>
                <span className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{head.players} players{head.checked_in_today ? ` · ${head.checked_in_today} here today` : ""}{head.called ? ` · ${head.called} called` : ""}</span>
                  <span className={`rounded px-2 py-0.5 font-semibold ${status.className}`}>{status.label}{head.released ? " · released" : ""}</span>
                </span>
              </div>
              {people.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody is assigned. <Link href="/protected/assignments" className="underline">Assignments</Link></p>
              ) : (
                <ul className="space-y-2.5">
                  {people.map((r) => {
                    const done = r.saved + r.not_evaluated;
                    const pct = head.players ? Math.min(100, Math.round((done / head.players) * 100)) : 0;
                    const idle = head.session_status === "open" && (!r.last_saved_at || (now - new Date(r.last_saved_at).getTime()) / 60000 > STALE_MINUTES);
                    return (
                      <li key={r.user_id} className="space-y-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                          <span className="font-medium text-foreground">
                            {r.scorer_name} <span className="text-xs font-normal text-muted-foreground">{r.evaluator_type === "coach" ? "Coach" : "Evaluator"}</span>
                          </span>
                          <span className="font-mono text-foreground">{done} of {head.players}</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={head.players}
                          aria-label={`${r.scorer_name}: ${done} of ${head.players} done`}>
                          <div className={`h-full rounded-full ${r.evaluator_type === "coach" ? "bg-emerald-600" : "bg-sky-600"}`} style={{ width: `${pct}%` }} />
                        </div>
                        <p className={`text-xs ${idle ? "font-medium text-amber-800 dark:text-amber-300" : "text-muted-foreground"}`}>
                          {r.last_saved_at ? `Last save ${ago(r.last_saved_at, now)}` : "No saves yet"}
                          {r.not_evaluated ? ` · ${r.not_evaluated} not evaluated` : ""}
                          {r.drafts ? ` · ${r.drafts} draft${r.drafts === 1 ? "" : "s"} (not counted)` : ""}
                        </p>
                        {r.called_not_done > 0 && (
                          <p className="text-xs font-medium text-sky-800 dark:text-sky-300">
                            {r.called_not_done} called by the announcer but not scored by {r.evaluator_type === "coach" ? "this coach" : "this evaluator"} yet
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default function ProgressPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <ProgressContent searchParams={searchParams} />
    </Suspense>
  );
}
