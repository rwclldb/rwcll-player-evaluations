import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, ListOrdered, Plus, Shirt } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { DRAFTED_DIVISIONS as DRAFTED, STATUS_LABEL, type DraftOverview } from "@/lib/drafts";
import { createDraft } from "./actions";

type SearchParams = Promise<{ season?: string; message?: string; error?: string }>;

async function DraftsContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_admin_or_registrar");
  if (allowed !== true) redirect("/protected");
  const { data: realAdmin } = await supabase.rpc("is_admin");

  const { data: seasonData } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
  const seasons = seasonData ?? [];
  const season = seasons.find((s) => String(s.id) === params.season) ?? seasons.find((s) => !s.is_closed) ?? seasons[0];
  if (!season) redirect("/protected");
  const { data, error } = await supabase.rpc("drafts_overview", { p_season_id: season.id });
  // Oldest division first: the order the drafts happen in.
  const divisions = ((data ?? []) as DraftOverview[]).slice().reverse();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> {realAdmin === true ? "Roadmap" : "Home"}</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <ListOrdered className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> Drafts
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          One draft per division, run oldest first: Juniors, then Majors, then AAA. Players a draft doesn&apos;t take drop to the next
          division whose ages fit. Set up each draft here: who&apos;s in the pool, roster sizes, the first-round order and the rules. A new
          draft starts with last season&apos;s rules for that division. {season.name}.
        </p>
      </div>

      {params.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{params.message}</div>}
      {params.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{params.error}</div>}
      {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">Could not load drafts: {error.message}</div>}

      {seasons.length > 1 && (
        <form action="/protected/drafts" className="flex items-end gap-2">
          <label className="text-xs text-muted-foreground">
            Season
            <select name="season" defaultValue={season.id} className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_closed ? " (closed)" : ""}</option>)}
            </select>
          </label>
          <Button type="submit" variant="outline" size="sm" className="h-9">Show</Button>
        </form>
      )}

      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {divisions.map((d) => {
          const drafted = DRAFTED.includes(d.name);
          return (
            <li key={d.season_division_id} className={`flex flex-col rounded-xl border bg-card p-4 shadow-sm ${d.draft ? "border-emerald-500/40" : "border-border"}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-lg font-bold text-foreground">{d.name}</h2>
                <span className="text-xs text-muted-foreground">{d.min_age !== null ? `ages ${d.min_age}–${d.max_age}` : ""}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {d.pool} in the pool · {d.must_draft} must be drafted · {d.teams} {d.teams === 1 ? "team" : "teams"}
              </p>
              {d.draft ? (
                <p className="mt-2 flex items-center gap-1.5 text-sm">
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">{STATUS_LABEL[d.draft.status] ?? d.draft.status}</span>
                  {d.draft.order_set
                    ? <span className="flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Order set</span>
                    : <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Order not set</span>}
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {drafted ? "Usually drafted." : d.name === "AA" ? "AA teams are usually made by the team generator (coming soon)." : d.name === "Seniors" ? "Usually one team, so no draft." : ""}
                </p>
              )}
              <div className="mt-auto flex flex-wrap gap-2 pt-3">
                {d.draft ? (
                  <Button asChild size="sm"><Link href={`/protected/drafts/${d.season_division_id}`}>Open setup <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
                ) : (
                  <>
                    <form action={createDraft}>
                      <input type="hidden" name="divisionId" value={d.season_division_id} />
                      <input type="hidden" name="from" value="list" />
                      <Button type="submit" size="sm" variant={drafted ? "default" : "outline"}><Plus className="mr-1 h-4 w-4" /> Set up a {d.name} draft</Button>
                    </form>
                    <Button asChild size="sm" variant="ghost"><Link href={`/protected/drafts/${d.season_division_id}`}>See the pool</Link></Button>
                  </>
                )}
                {d.teams === 0 && (
                  <Button asChild size="sm" variant="ghost"><Link href={`/protected/teams?season=${season.id}#div-${d.season_division_id}`}><Shirt className="mr-1 h-4 w-4" /> Add teams</Link></Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function DraftsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading drafts…</p>}>
      <DraftsContent searchParams={searchParams} />
    </Suspense>
  );
}
