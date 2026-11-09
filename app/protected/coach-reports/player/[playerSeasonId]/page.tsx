import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft, 
  User, 
  Award, 
  History, 
  ShieldAlert, 
  CheckCircle2 
} from "lucide-react";

type Props = { params: Promise<{ playerSeasonId: string }> };

type HistoricalRow = {
  player_first_name: string;
  player_last_name: string;
  historical_evaluation_id: number | null;
  source_season_label: string | null;
  source_division_name: string | null;
  source_team_label: string | null;
  source_coach_name: string | null;
  coverage_note: string | null;
  category_name: string | null;
  score: number | null;
  rating_category_id: number | null;
};

async function CoachPlayerReportContent({ params }: Props) {
  const { playerSeasonId: rawId } = await params;
  const playerSeasonId = Number(rawId);

  if (!Number.isSafeInteger(playerSeasonId) || playerSeasonId <= 0) {
    notFound();
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/auth/login");
  }

  // Verify permissions via RPC: Redirect admins to full executive report
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");

  if (adminError) {
    return (
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected/coach-reports">
            <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Back to assigned players
          </Link>
        </Button>
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
          Could not verify account permissions.
        </div>
      </div>
    );
  }

  if (isAdmin === true) {
    redirect(`/protected/reports/player/${playerSeasonId}`);
  }

  // SECURITY DEFINER RPC validates current user's team assignment before returning historical data
  const result = await supabase.rpc("coach_historical_report", {
    p_player_season_id: playerSeasonId,
  });

  if (result.error) {
    notFound();
  }

  const rows = (result.data ?? []) as HistoricalRow[];
  const playerName = rows.length
    ? `${rows[0].player_first_name} ${rows[0].player_last_name}`
    : "Player";

  const evaluations = [
    ...new Map(
      rows
        .filter((row) => row.historical_evaluation_id !== null)
        .map((row) => [
          row.historical_evaluation_id,
          {
            id: row.historical_evaluation_id as number,
            season: row.source_season_label,
            division: row.source_division_name,
            team: row.source_team_label,
            coach: row.source_coach_name,
            coverage: row.coverage_note,
          },
        ])
    ).values(),
  ];

  return (
    <div className="space-y-8">
      {/* Top Header & Navigation Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-9 border-border bg-card text-xs text-slate-700 dark:text-slate-300 hover:bg-accent">
            <Link href="/protected/coach-reports">
              <ArrowLeft className="h-4 w-4 mr-1 text-muted-foreground" /> Back to Assigned Players
            </Link>
          </Button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <User className="h-6 w-6 text-emerald-700 dark:text-emerald-400" />
              {playerName}
            </h1>
            <p className="text-xs text-muted-foreground">
              Prior-Season Historical Coach Ratings
            </p>
          </div>
        </div>

        <Badge variant="outline" className="font-mono text-emerald-700 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10 py-1 px-3 text-xs w-fit">
          Coach Access Scoped
        </Badge>
      </div>

      {/* Info Context Note */}
      <Card className="border-border bg-card">
        <CardContent className="p-4 flex items-center gap-3 text-xs text-slate-700 dark:text-slate-300">
          <History className="h-5 w-5 text-emerald-700 dark:text-emerald-400 shrink-0" />
          <span>
            These ratings show prior-season coach evaluations for context only. They are read-only and are not combined with current-season evaluation averages.
          </span>
        </CardContent>
      </Card>

      {/* Historical Evaluations Grid */}
      <div className="space-y-6">
        {evaluations.length === 0 ? (
          <Card className="border-border bg-card p-8 text-center space-y-2">
            <ShieldAlert className="h-8 w-8 text-amber-700 dark:text-amber-400 mx-auto" />
            <p className="text-sm font-semibold text-foreground">No Historical Ratings Available</p>
            <p className="text-xs text-muted-foreground">
              No matched historical coach evaluations were found for this player.
            </p>
          </Card>
        ) : (
          evaluations.map((evaluation) => {
            const ratings = rows.filter(
              (row) =>
                row.historical_evaluation_id === evaluation.id &&
                row.category_name !== null &&
                row.score !== null
            );

            return (
              <Card key={evaluation.id} className="border-border bg-card">
                <CardHeader className="py-4 border-b border-border/50">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                        <Award className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                        {evaluation.season ?? "Season Not Recorded"}
                      </CardTitle>
                      <CardDescription className="text-xs text-muted-foreground font-mono mt-0.5">
                        {evaluation.coach ? `Coach: ${evaluation.coach}` : "Coach not recorded"} &bull;{" "}
                        {evaluation.division ?? "Division not recorded"}
                        {evaluation.team ? ` &bull; Team: ${evaluation.team}` : ""}
                      </CardDescription>
                    </div>
                  </div>
                  {evaluation.coverage && (
                    <p className="mt-2 text-xs text-slate-700 dark:text-slate-300 italic font-mono">
                      {evaluation.coverage}
                    </p>
                  )}
                </CardHeader>

                <CardContent className="p-4">
                  {ratings.length === 0 ? (
                    <p className="text-xs text-slate-600 dark:text-slate-400 italic">No historical ratings recorded.</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {ratings.map((rating) => (
                        <div
                          key={`${evaluation.id}:${rating.category_name}`}
                          className="flex items-center justify-between rounded-lg border border-border bg-background p-3 text-xs"
                        >
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{rating.category_name}</span>
                          <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-950/60 border border-emerald-500/40 px-2.5 py-1 rounded">
                            {rating.score} / 5
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function CoachHistoricalPlayerReportPage({ params }: Props) {
  return (
    <Suspense
      fallback={
        <div className="h-96 w-full rounded-lg border border-border bg-card animate-pulse" />
      }
    >
      <CoachPlayerReportContent params={params} />
    </Suspense>
  );
}