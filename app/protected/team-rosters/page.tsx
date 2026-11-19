import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import type { SeasonRosters } from "@/lib/team-rosters";
import { RosterBoard } from "./roster-board";

type SearchParams = Promise<{ season?: string }>;

async function RostersContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_admin_or_registrar");
  if (allowed !== true) redirect("/protected");
  const { data: realAdmin } = await supabase.rpc("is_admin");
  const { data: seasonData } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
  const seasons = seasonData ?? [];
  const season = seasons.find((s) => String(s.id) === params.season) ?? seasons.find((s) => !s.is_closed) ?? seasons[0];
  if (!season) redirect("/protected");
  const { data, error } = await supabase.rpc("season_rosters", { p_season_id: season.id });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> {realAdmin === true ? "Roadmap" : "Home"}</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <ClipboardList className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> Team rosters
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every team&apos;s players, and who isn&apos;t on a team yet. Move a player to another team, or back to the pool, with a short note; every
          move is logged. Moving a pick back to the pool while its draft is running opens that pick again (the way to fix a wrong pick).
          Release each division&apos;s rosters when they&apos;re final, and download the CSV for Sports Connect. {season.name}.
        </p>
        {seasons.length > 1 && (
          <form action="/protected/team-rosters" className="flex items-end gap-2">
            <select name="season" defaultValue={season.id} aria-label="Season" className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_closed ? " (closed)" : ""}</option>)}
            </select>
            <Button type="submit" variant="outline" size="sm" className="h-9">Show</Button>
          </form>
        )}
      </div>
      {error ? <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">Could not load rosters: {error.message}</p>
        : <RosterBoard seasonId={season.id} initial={data as SeasonRosters} isAdmin={realAdmin === true} />}
    </div>
  );
}

export default function TeamRostersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading rosters…</p>}>
      <RostersContent searchParams={searchParams} />
    </Suspense>
  );
}
