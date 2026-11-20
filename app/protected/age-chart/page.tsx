import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, CalendarRange, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import type { ChartEntry } from "@/lib/age-chart";
import { ChartGrid, ChartUpload, DownloadChart } from "./chart-upload";

type SearchParams = Promise<{ season?: string }>;
type Mismatch = { player_season_id: number; first_name: string; last_name: string; bib: number | null; league_age: number | null; chart_age: number; age_source: string | null };

async function AgeChartContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_admin_or_registrar");
  if (allowed !== true) redirect("/protected");
  const { data: isAdmin } = await supabase.rpc("is_admin");
  const { data: seasonData } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
  const seasons = seasonData ?? [];
  const season = seasons.find((s) => String(s.id) === params.season) ?? seasons.find((s) => !s.is_closed) ?? seasons[0];
  if (!season) redirect("/protected");
  const [{ data: chart }, { data: mismatchData }] = await Promise.all([
    supabase.rpc("season_age_chart", { p_season_id: season.id }),
    supabase.rpc("age_chart_mismatches", { p_season_id: season.id }),
  ]);
  const rows = ((chart as { rows?: ChartEntry[] } | null)?.rows ?? []);
  const upload = (chart as { upload?: { file_name: string | null; uploaded_at: string; by: string | null } | null } | null)?.upload ?? null;
  const mismatches = (mismatchData ?? []) as Mismatch[];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> {isAdmin === true ? "Roadmap" : "Home"}</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <CalendarRange className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> Age chart
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The official Little League age chart for {season.name}: which birth year and month gives which league age. The registration import
          and the player page use it to work out each player&apos;s age. Upload it once a season, before importing registrations.
        </p>
        {seasons.length > 1 && (
          <form action="/protected/age-chart" className="flex items-end gap-2">
            <select name="season" defaultValue={season.id} aria-label="Season" className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_closed ? " (closed)" : ""}</option>)}
            </select>
            <Button type="submit" variant="outline" size="sm" className="h-9">Show</Button>
          </form>
        )}
      </div>

      {isAdmin === true && !season.is_closed && (
        <section className="space-y-2">
          <h2 className="text-lg font-bold text-foreground">{rows.length ? "Replace the chart" : "Upload the chart"}</h2>
          <ChartUpload seasonId={season.id} seasonName={season.name} hasChart={rows.length > 0} />
        </section>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-foreground">{season.name} chart</h2>
          {rows.length > 0 && <DownloadChart entries={rows} name={season.name} />}
        </div>
        {rows.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><AlertTriangle className="h-4 w-4 text-amber-600" />
            No age chart yet. Until there is one, imported players get no age group (they&apos;re flagged in the import preview).</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{upload?.file_name ?? "Uploaded"}{upload?.by ? `, by ${upload.by}` : ""}{upload?.uploaded_at ? `, ${new Date(upload.uploaded_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" })}` : ""}.
              September to December (blue) belong to the earlier birth year.</p>
            <ChartGrid entries={rows} />
          </>
        )}
      </section>

      {rows.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-bold text-foreground">Players whose age doesn&apos;t match the chart <span className="text-sm font-normal text-muted-foreground">({mismatches.length})</span></h2>
          {mismatches.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Every player with a birthdate has the age the chart gives.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Ages don&apos;t change by themselves. Open a player to fix the age (with a reason), or leave it if it was set by hand on purpose.</p>
              <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
                {mismatches.map((m) => (
                  <li key={m.player_season_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span><Link href={`/protected/players/${m.player_season_id}`} className="font-medium text-foreground hover:underline">{m.last_name}, {m.first_name}</Link>
                      {m.bib ? <span className="text-xs text-muted-foreground"> #{m.bib}</span> : null}</span>
                    <span className="text-xs">age {m.league_age ?? "none"} → chart says <strong>{m.chart_age}</strong>{m.age_source === "admin" ? " (age set by hand)" : ""}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}

export default function AgeChartPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <AgeChartContent searchParams={searchParams} />
    </Suspense>
  );
}
