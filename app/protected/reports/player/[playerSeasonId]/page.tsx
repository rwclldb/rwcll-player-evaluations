import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft, 
  Award, 
  User, 
  Calendar, 
  ShieldCheck, 
  FileText, 
  BarChart3,
  History,
  Users
} from "lucide-react";

type Props = { params: Promise<{ playerSeasonId: string }> };

type PlayerSeason = {
  id: number;
  player_id: number;
  season_id: number;
  league_age: number | null;
  evaluation_number: number | null;
  registration_payment_status: string | null;
  players: { first_name: string; last_name: string; date_of_birth: string | null } | null;
};

type Session = { id: number; league_age: number | null; status: string };

type Evaluation = {
  id: number;
  evaluation_session_id: number;
  evaluator_user_id: string;
  evaluator_type: string;
  status: string;
  submitted_at: string | null;
};

type GroupEvaluation = { id: number; evaluation_session_id: number; evaluator_type: string; status: string };
type Category = { id: number; code: string; name: string; category_group: string; sort_order: number };
type Rating = { evaluation_id: number; rating_category_id: number; score: number };
type Profile = { user_id: string; display_name: string | null };

type HistoricalEvaluation = {
  id: number;
  source_season_label: string;
  source_division_name: string;
  source_team_label: string | null;
  source_coach_name: string | null;
  coverage_note: string | null;
  source_season_id: number | null;
};

type HistoricalRating = {
  historical_evaluation_id: number;
  category_name: string;
  score: number;
  rating_category_id: number | null;
};

const CORE_CODES = ["hitting", "throwing", "grounders", "fly_balls", "running_awareness"] as const;

async function PlayerReportContent({ params }: Props) {
  const { playerSeasonId: rawId } = await params;
  const playerSeasonId = Number(rawId);
  if (!Number.isSafeInteger(playerSeasonId) || playerSeasonId <= 0) notFound();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/auth/login");
  }

  // Verify administrator privileges via RPC
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError || isAdmin !== true) redirect("/protected");

  const registrationResult = await supabase
    .from("player_seasons")
    .select("id, player_id, season_id, league_age, evaluation_number, registration_payment_status, players(first_name, last_name, date_of_birth)")
    .eq("id", playerSeasonId)
    .maybeSingle();

  if (registrationResult.error) {
    return (
      <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300 font-mono">
        Could not load player report: {registrationResult.error.message}
      </div>
    );
  }

  if (!registrationResult.data) notFound();
  const registration = registrationResult.data as unknown as PlayerSeason;
  const playerName = registration.players
    ? `${registration.players.first_name} ${registration.players.last_name}`
    : `Player #${registration.player_id}`;

  const [seasonResult, sessionsResult, categoriesResult, profilesResult, historyResult] = await Promise.all([
    supabase.from("seasons").select("id, name").eq("id", registration.season_id).maybeSingle(),
    supabase.from("evaluation_sessions").select("id, league_age, status").eq("season_id", registration.season_id).is("season_division_id", null),
    supabase.from("rating_categories").select("id, code, name, category_group, sort_order").order("sort_order"),
    supabase.from("user_profiles").select("user_id, display_name"),
    supabase.from("historical_evaluations").select("id, source_season_label, source_division_name, source_team_label, source_coach_name, coverage_note, source_season_id").eq("player_id", registration.player_id).order("source_season_id", { ascending: false }),
  ]);

  const loadError =
    seasonResult.error?.message ??
    sessionsResult.error?.message ??
    categoriesResult.error?.message ??
    profilesResult.error?.message ??
    historyResult.error?.message;

  if (loadError) {
    return (
      <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300 font-mono">
        Could not load report details: {loadError}
      </div>
    );
  }

  const sessions = (sessionsResult.data ?? []) as Session[];
  const categories = (categoriesResult.data ?? []) as Category[];
  const historical = (historyResult.data ?? []) as HistoricalEvaluation[];
  const profiles = (profilesResult.data ?? []) as Profile[];
  const sessionIds = sessions.map((session) => session.id);

  const evaluationResult = sessionIds.length
    ? await supabase
        .from("evaluations")
        .select("id, evaluation_session_id, evaluator_user_id, evaluator_type, status, submitted_at")
        .eq("player_season_id", registration.id)
        .in("evaluation_session_id", sessionIds)
    : { data: [], error: null };

  const evaluations = (evaluationResult.data ?? []) as Evaluation[];
  const evaluationIds = evaluations.map((evaluation) => evaluation.id);

  const ratingResult = evaluationIds.length
    ? await supabase
        .from("ratings")
        .select("evaluation_id, rating_category_id, score")
        .in("evaluation_id", evaluationIds)
    : { data: [], error: null };

  const ratings = (ratingResult.data ?? []) as Rating[];

  const historicalIds = historical.map((item) => item.id);
  const historicalRatingResult = historicalIds.length
    ? await supabase
        .from("historical_ratings")
        .select("historical_evaluation_id, category_name, score, rating_category_id")
        .in("historical_evaluation_id", historicalIds)
    : { data: [], error: null };

  const historicalRatings = (historicalRatingResult.data ?? []) as HistoricalRating[];

  const groupSessionIds = sessions
    .filter((session) => session.league_age === registration.league_age)
    .map((session) => session.id);

  const groupEvaluationResult = groupSessionIds.length
    ? await supabase
        .from("evaluations")
        .select("id, evaluation_session_id, evaluator_type, status")
        .in("evaluation_session_id", groupSessionIds)
        .eq("status", "submitted")
    : { data: [], error: null };

  const groupEvaluations = (groupEvaluationResult.data ?? []) as GroupEvaluation[];
  const groupEvaluationIds = groupEvaluations.map((item) => item.id);

  const groupRatingResult = groupEvaluationIds.length
    ? await supabase
        .from("ratings")
        .select("evaluation_id, rating_category_id, score")
        .in("evaluation_id", groupEvaluationIds)
    : { data: [], error: null };

  const groupRatings = (groupRatingResult.data ?? []) as Rating[];

  const downstreamError =
    evaluationResult.error?.message ??
    ratingResult.error?.message ??
    historicalRatingResult.error?.message ??
    groupEvaluationResult.error?.message ??
    groupRatingResult.error?.message;

  const seasonName = seasonResult.data?.name ?? `Season #${registration.season_id}`;
  const evaluatorName = (userId: string) =>
    profiles.find((profile) => profile.user_id === userId)?.display_name?.trim() || "Evaluator";

  return (
    <div className="space-y-8">
      {/* Navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="h-9 border-border bg-card text-xs text-slate-700 dark:text-slate-300 hover:bg-accent">
            <Link href={`/protected/reports?seasonId=${registration.season_id}`}>
              <ArrowLeft className="h-4 w-4 mr-1 text-muted-foreground" /> Back to {seasonName} Reports
            </Link>
          </Button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
              <User className="h-6 w-6 text-emerald-700 dark:text-emerald-400" />
              {playerName}
            </h1>
            <p className="text-xs text-muted-foreground">
              Individual Player Evaluation & History Report
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-emerald-700 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10 py-1 px-3 text-xs">
            {seasonName}
          </Badge>
          <Badge variant="default" className="font-mono py-1 px-3 bg-emerald-600 text-foreground text-xs">
            Eval #{registration.evaluation_number ?? "—"}
          </Badge>
        </div>
      </div>

      {downstreamError && (
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300 font-mono">
          Could not load all ratings: {downstreamError}
        </div>
      )}

      {/* Demographics Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Little League Age
            </CardTitle>
            <Calendar className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground font-mono">
              Age {registration.league_age ?? "Not Set"}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              DOB: {registration.players?.date_of_birth || "Not recorded"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Registration Status
            </CardTitle>
            <ShieldCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-emerald-700 dark:text-emerald-400 font-mono uppercase">
              {registration.registration_payment_status ?? "Unknown"}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Payment & clearance state</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Current Evaluation Records
            </CardTitle>
            <Award className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground font-mono">
              {evaluations.length}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Logged evaluator forms</p>
          </CardContent>
        </Card>
      </div>

      {/* 1. Current-Season Evaluator Ratings */}
      <Card className="border-border bg-card">
        <CardHeader className="py-4 border-b border-border/50">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            Current-Season Evaluator Submissions
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Ratings actually entered. Draft records are labeled and not treated as submitted.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-4 space-y-4">
          {evaluations.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-600 dark:text-slate-400 italic">
              No current-season evaluation records found for this player.
            </div>
          ) : (
            evaluations.map((evaluation) => {
              const session = sessions.find((item) => item.id === evaluation.evaluation_session_id);
              const ownRatings = ratings.filter((rating) => rating.evaluation_id === evaluation.id);

              return (
                <div key={evaluation.id} className="rounded-lg border border-border bg-background p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-2">
                    <div>
                      <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                        Age {session?.league_age ?? "—"} &bull;{" "}
                        <span className="text-emerald-700 dark:text-emerald-400">
                          {evaluation.evaluator_type === "independent_evaluator" ? "Independent Evaluator" : "Coach"}
                        </span>
                      </h4>
                      <p className="text-xs font-mono text-muted-foreground mt-0.5">
                        {evaluatorName(evaluation.evaluator_user_id)} &bull; Status: {evaluation.status}
                        {evaluation.submitted_at ? ` &bull; Submitted ${new Date(evaluation.submitted_at).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                  </div>

                  {ownRatings.length === 0 ? (
                    <p className="text-xs text-slate-600 dark:text-slate-400 italic">No category ratings entered.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {ownRatings.map((rating) => {
                        const category = categories.find((item) => item.id === rating.rating_category_id);
                        return (
                          <div key={rating.rating_category_id} className="flex items-center justify-between rounded border border-border bg-card p-2.5 text-xs">
                            <span className="text-slate-700 dark:text-slate-300 font-medium">{category?.name ?? "Unmapped category"}</span>
                            <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-950/60 border border-emerald-500/40 px-2 py-0.5 rounded">
                              {rating.score} / 5
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* 2. Current Age-Group Aggregate Ratings */}
      <Card className="border-border bg-card">
        <CardHeader className="py-4 border-b border-border/50">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            Current Age-Group Benchmark Ratings
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Submitted evaluations across the current age group. Coach and independent ratings remain separate.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          {registration.league_age === null || groupSessionIds.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-600 dark:text-slate-400 italic">
              No age-group session is available for this registration.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-background text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Core Skill</th>
                    <th className="px-4 py-3 text-center">Coach Avg</th>
                    <th className="px-4 py-3 text-center">Coach Count</th>
                    <th className="px-4 py-3 text-center">Independent Avg</th>
                    <th className="px-4 py-3 text-center">Independent Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {categories
                    .filter((category) => CORE_CODES.includes(category.code as (typeof CORE_CODES)[number]))
                    .sort((a, b) => CORE_CODES.indexOf(a.code as (typeof CORE_CODES)[number]) - CORE_CODES.indexOf(b.code as (typeof CORE_CODES)[number]))
                    .map((category) => {
                      const stats = (type: string) => {
                        const scores = groupRatings
                          .filter(
                            (rating) =>
                              rating.rating_category_id === category.id &&
                              groupEvaluations.some((evaluation) => evaluation.id === rating.evaluation_id && evaluation.evaluator_type === type)
                          )
                          .map((rating) => rating.score);
                        return {
                          average: scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : "—",
                          count: scores.length,
                        };
                      };

                      const coach = stats("coach");
                      const independent = stats("independent_evaluator");

                      return (
                        <tr key={category.id} className="hover:bg-accent/50 transition-colors">
                          <td className="px-4 py-3 font-medium text-foreground text-xs">{category.name}</td>
                          <td className="px-4 py-3 text-center font-mono text-xs text-slate-700 dark:text-slate-300">{coach.average}</td>
                          <td className="px-4 py-3 text-center font-mono text-xs text-muted-foreground">{coach.count}</td>
                          <td className="px-4 py-3 text-center font-mono text-xs text-emerald-700 dark:text-emerald-400 font-bold">{independent.average}</td>
                          <td className="px-4 py-3 text-center font-mono text-xs text-muted-foreground">{independent.count}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Historical Player Evaluations */}
      <Card className="border-border bg-card">
        <CardHeader className="py-4 border-b border-border/50">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <History className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            Historical Player Evaluations
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Prior-season player ratings for reference only. The source coach is identified where available. They do not alter current-season averages.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-4 space-y-4">
          {historical.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-600 dark:text-slate-400 italic">
              No matched historical player evaluations found.
            </div>
          ) : (
            historical.map((item) => {
              const ownRatings = historicalRatings.filter((rating) => rating.historical_evaluation_id === item.id);

              return (
                <div key={item.id} className="rounded-lg border border-border bg-background p-4 space-y-3">
                  <div>
                    <h4 className="text-sm font-bold text-foreground">{item.source_season_label}</h4>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">
                      {item.source_coach_name ? `Coach: ${item.source_coach_name}` : "Coach not recorded"} &bull; {item.source_division_name}
                      {item.source_team_label ? ` &bull; Team: ${item.source_team_label}` : ""}
                    </p>
                    {item.coverage_note && <p className="mt-2 text-xs text-slate-700 dark:text-slate-300 italic">{item.coverage_note}</p>}
                  </div>

                  {ownRatings.length === 0 ? (
                    <p className="text-xs text-slate-600 dark:text-slate-400 italic">No historical ratings recorded.</p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {ownRatings.map((rating) => {
                        const category = categories.find((entry) => entry.id === rating.rating_category_id);
                        return (
                          <div key={`${item.id}:${rating.category_name}`} className="flex items-center justify-between rounded border border-border bg-card p-2.5 text-xs">
                            <span className="text-slate-700 dark:text-slate-300 font-medium">{category?.name ?? rating.category_name}</span>
                            <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-950/60 border border-emerald-500/40 px-2 py-0.5 rounded">
                              {rating.score} / 5
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function PlayerReportDetailPage({ params }: Props) {
  return (
    <Suspense
      fallback={
        <div className="h-96 w-full rounded-lg border border-border bg-card animate-pulse" />
      }
    >
      <PlayerReportContent params={params} />
    </Suspense>
  );
}