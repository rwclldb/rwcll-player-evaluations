import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ClipboardList, 
  ArrowLeft, 
  UserCheck, 
  Layers, 
  ArrowRight,
  ShieldAlert
} from "lucide-react";

type SearchParams = Promise<{ seasonId?: string }>;

type Season = { id: number; name: string };

type RosterRow = {
  player_season_id: number;
  player_id: number;
  season_id: number;
  league_age: number | null;
  evaluation_number: number | null;
  team_id: number;
  team_name: string | null;
  first_name: string;
  last_name: string;
};

async function CoachReportsContent({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/auth/login");
  }

  // Verify permissions via RPC: Admins are redirected to full reports
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");

  if (adminError) {
    return (
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected/evaluations">
            <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Back to evaluator workspace
          </Link>
        </Button>
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
          Could not verify account permissions.
        </div>
      </div>
    );
  }

  if (isAdmin === true) {
    return redirect("/protected/reports");
  }

  // Fetch seasons
  const seasonsResult = await supabase
    .from("seasons")
    .select("id, name")
    .order("id", { ascending: false });

  const seasons = (seasonsResult.data ?? []) as Season[];
  const requestedSeasonId = params.seasonId ? Number(params.seasonId) : seasons[0]?.id;
  const selectedSeason = seasons.find((season) => season.id === requestedSeasonId);

  // Fetch coach-scoped player roster using Supabase RPC function
  const rosterResult = selectedSeason
    ? await supabase.rpc("coach_historical_report_roster", { p_season_id: selectedSeason.id })
    : { data: [], error: null };

  const roster = (rosterResult.data ?? []) as RosterRow[];

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
              <Link href="/protected/evaluations">
                <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Back to evaluator workspace
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ClipboardList className="h-7 w-7 text-emerald-700 dark:text-emerald-400" />
            My Players’ Historical Ratings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Only players on teams assigned to your account are listed. Shows prior-season coach ratings only.
          </p>
        </div>
      </div>

      {seasonsResult.error ? (
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300 font-mono">
          Could not load seasons.
        </div>
      ) : seasons.length === 0 ? (
        <Card className="border-border bg-card p-6 text-center text-xs text-muted-foreground">
          No seasons are available.
        </Card>
      ) : (
        <>
          {/* Season Selector Card */}
          <Card className="border-border bg-card">
            <CardHeader className="py-4 border-b border-border/50">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Layers className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> Select Season
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="flex flex-wrap gap-2">
                {seasons.map((season) => {
                  const isActive = selectedSeason?.id === season.id;
                  return (
                    <Button
                      key={season.id}
                      asChild
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      className={
                        isActive
                          ? "bg-emerald-600 hover:bg-emerald-500 text-foreground text-xs font-semibold"
                          : "border-border bg-background text-slate-700 dark:text-slate-300 hover:bg-accent text-xs"
                      }
                    >
                      <Link href={`/protected/coach-reports?seasonId=${season.id}`}>
                        {season.name}
                      </Link>
                    </Button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Roster & Ratings Table Card */}
          {!selectedSeason ? (
            <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-300">
              Choose a valid season.
            </div>
          ) : rosterResult.error ? (
            <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300 font-mono">
              Could not load assigned players. Confirm that the local migration for scoped coach reports has been applied.
            </div>
          ) : roster.length === 0 ? (
            <Card className="border-border bg-card p-8 text-center text-xs text-muted-foreground space-y-2">
              <ShieldAlert className="h-8 w-8 text-amber-700 dark:text-amber-400 mx-auto" />
              <p className="font-semibold text-foreground">No Assigned Players Found</p>
              <p>No players are assigned to your teams for {selectedSeason.name}. Ask an administrator to verify team and coach assignments.</p>
            </Card>
          ) : (
            <Card className="border-border bg-card">
              <CardHeader className="py-4 border-b border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                    {selectedSeason.name} &bull; {roster.length} Assigned Player{roster.length === 1 ? "" : "s"}
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">
                    Scoped team roster and historical evaluation access.
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-background text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
                      <tr>
                        <th className="px-4 py-3">Player Name</th>
                        <th className="px-4 py-3">Team</th>
                        <th className="px-4 py-3 text-center">League Age</th>
                        <th className="px-4 py-3 text-center">Eval #</th>
                        <th className="px-4 py-3 text-right">Ratings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {roster.map((player) => (
                        <tr key={player.player_season_id} className="hover:bg-accent/50 transition-colors">
                          <td className="px-4 py-4 font-semibold text-foreground text-xs">
                            {player.last_name}, {player.first_name}
                          </td>
                          <td className="px-4 py-4 text-xs font-mono text-slate-700 dark:text-slate-300">
                            {player.team_name ?? "Team name not set"}
                          </td>
                          <td className="px-4 py-4 text-center text-xs font-mono text-emerald-700 dark:text-emerald-400 font-bold">
                            {player.league_age ?? "—"}
                          </td>
                          <td className="px-4 py-4 text-center text-xs font-mono text-muted-foreground">
                            {player.evaluation_number ?? "—"}
                          </td>
                          <td className="px-4 py-4 text-right">
                            <Button asChild variant="outline" size="sm" className="h-7 border-border bg-background hover:bg-accent text-xs text-slate-700 dark:text-slate-200">
                              <Link href={`/protected/coach-reports/player/${player.player_season_id}`}>
                                View Historical Ratings <ArrowRight className="ml-1 h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export default function CoachReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense
      fallback={
        <div className="h-96 w-full rounded-lg border border-border bg-card animate-pulse" />
      }
    >
      <CoachReportsContent searchParams={searchParams} />
    </Suspense>
  );
}