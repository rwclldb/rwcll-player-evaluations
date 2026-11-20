import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, Shuffle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import type { TMPlayer, TMTeam } from "@/lib/team-maker";
import { TeamMaker } from "./team-maker";

type Params = Promise<{ divisionId: string }>;
type MakerData = {
  division: { season_division_id: number; season_id: number; name: string; season: string; min_age: number | null; max_age: number | null; draft_status: string | null };
  teams: TMTeam[];
  players: TMPlayer[];
};

async function MakeTeamsContent({ params }: { params: Params }) {
  const { divisionId } = await params;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_admin_or_registrar");
  if (allowed !== true) redirect("/protected");
  const { data, error } = await supabase.rpc("team_maker_data", { p_season_division_id: Number(divisionId) });
  if (error || !data) return <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">Could not load: {error?.message ?? "not found"}</p>;
  const d = data as MakerData;
  const running = d.division.draft_status === "live" || d.division.draft_status === "paused";
  const unplaced = d.players.filter((p) => p.team_id === null).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href={`/protected/drafts?season=${d.division.season_id}`}><ArrowLeft className="mr-1 h-4 w-4" /> Drafts</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <Shuffle className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> Make {d.division.name} teams
          <span className="text-base font-normal text-muted-foreground">{d.division.min_age !== null ? `ages ${d.division.min_age}–${d.division.max_age} · ` : ""}{d.division.season}</span>
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Balanced teams for any division, instead of a draft. The players are the {d.division.name} pool (including anyone left over from the
          division above&apos;s finished draft) plus anyone already on a {d.division.name} team, who stays put. Coach&apos;s kids go to their
          parent&apos;s team and siblings stay together. Nothing is saved until you press Place.
        </p>
      </div>
      {running ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">The {d.division.name} draft is running. Finish it before making teams this way.</p>
      ) : d.teams.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No {d.division.name} teams yet. <Link href={`/protected/teams?season=${d.division.season_id}#div-${d.division.season_division_id}`} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">Add them on the Teams page</Link>.</p>
      ) : unplaced === 0 ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Everyone in the {d.division.name} pool is already on a team. <Link href={`/protected/team-rosters?season=${d.division.season_id}#div-${d.division.season_division_id}`} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">See Team rosters</Link>.</p>
      ) : (
        <TeamMaker divisionId={d.division.season_division_id} divisionName={d.division.name} teams={d.teams} players={d.players} />
      )}
    </div>
  );
}

export default function MakeTeamsPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <MakeTeamsContent params={params} />
    </Suspense>
  );
}
