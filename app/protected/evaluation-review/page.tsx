import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllByIds, fetchAllRows } from "@/lib/supabase/fetch-all";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ClipboardCheck, 
  ArrowLeft, 
  ShieldAlert, 
  Users, 
  UserCheck, 
  Layers, 
  CheckCircle2,
  Calendar
} from "lucide-react";

type Season = { id: number; name: string };
type Session = {
  id: number;
  season_id: number;
  league_age: number | null;
  status: string;
};
type Registration = {
  id: number;
  season_id: number;
  league_age: number | null;
  evaluation_number: number | null;
  players: { first_name: string; last_name: string } | null;
};
type Evaluation = {
  id: number;
  evaluation_session_id: number;
  player_season_id: number;
  evaluator_user_id: string;
  evaluator_type: string;
  status: string;
};
type Rating = {
  evaluation_id: number;
  rating_category_id: number;
  score: number;
};
type Category = {
  id: number;
  code: string;
  name: string;
  category_group: string;
  sort_order: number;
};
type Profile = { user_id: string; display_name: string | null };

const CORE_CODES = [
  "hitting",
  "throwing",
  "grounders",
  "fly_balls",
  "running_awareness",
] as const;
const AGES = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7];

function ratingSummary(
  evaluationId: number,
  ratings: Rating[],
  categories: Category[]
) {
  const coreIds = new Map(
    categories
      .filter((category) => CORE_CODES.includes(category.code as (typeof CORE_CODES)[number]))
      .map((category) => [category.id, category.code])
  );
  const byCode = new Map<string, number>();
  for (const rating of ratings) {
    if (rating.evaluation_id !== evaluationId) continue;
    const code = coreIds.get(rating.rating_category_id);
    if (code) byCode.set(code, rating.score);
  }
  const scores = CORE_CODES.flatMap((code) =>
    byCode.has(code) ? [byCode.get(code)!] : []
  );
  const total = scores.reduce((sum, score) => sum + score, 0);
  const average = scores.length ? (total / scores.length).toFixed(1) : "—";
  return {
    total: scores.length === 5 ? `${total}/25` : scores.length ? `${total} (${scores.length}/5)` : "—",
    average,
    count: scores.length,
  };
}

async function EvaluationReviewContent() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/auth/login");
  }

  // Verify administrator privileges
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");

  if (adminError || isAdmin !== true) {
    return redirect("/protected");
  }

  const [
    seasonsResult,
    sessionsResult,
    registrationsResult,
    evaluationsResult,
    categoriesResult,
    profilesResult,
  ] = await Promise.all([
    supabase.from("seasons").select("id, name").order("id", { ascending: false }),
    supabase
      .from("evaluation_sessions")
      .select("id, season_id, league_age, status")
      .is("season_division_id", null)
      .order("season_id", { ascending: false })
      .order("league_age", { ascending: false }),
    // Every row, not just the first 1,000.
    fetchAllRows((from, to) => supabase
      .from("player_seasons")
      .select("id, season_id, league_age, evaluation_number, players(first_name, last_name)")
      .order("id").range(from, to)),
    fetchAllRows((from, to) => supabase
      .from("evaluations")
      .select("id, evaluation_session_id, player_season_id, evaluator_user_id, evaluator_type, status")
      .order("id").range(from, to)),
    supabase
      .from("rating_categories")
      .select("id, code, name, category_group, sort_order")
      .order("sort_order"),
    supabase.from("user_profiles").select("user_id, display_name"),
  ]);

  const loadError =
    seasonsResult.error?.message ??
    sessionsResult.error?.message ??
    registrationsResult.error?.message ??
    evaluationsResult.error?.message ??
    categoriesResult.error?.message ??
    profilesResult.error?.message;

  const seasons = (seasonsResult.data ?? []) as Season[];
  const sessions = (sessionsResult.data ?? []) as Session[];
  const registrations = (registrationsResult.data ?? []) as unknown as Registration[];
  const evaluations = (evaluationsResult.data ?? []) as Evaluation[];
  const categories = (categoriesResult.data ?? []) as Category[];
  const profiles = (profilesResult.data ?? []) as Profile[];

  const ratingResult = await fetchAllByIds(evaluations.map((evaluation) => evaluation.id), (ids, from, to) => supabase
    .from("ratings")
    .select("evaluation_id, rating_category_id, score")
    .in("evaluation_id", ids)
    .order("id").range(from, to));
  const ratings = (ratingResult.data ?? []) as Rating[];

  // Evaluations an admin has corrected (admin_save_evaluation_correction writes these audit entries).
  const { data: correctionData } = await supabase.from("audit_log").select("target_id")
    .eq("action", "evaluation_admin_corrected").eq("target_table", "evaluations");
  const corrected = new Set((correctionData ?? []).map((row) => Number(row.target_id)));

  const evaluatorName = (userId: string) =>
    profiles.find((profile) => profile.user_id === userId)?.display_name?.trim() || userId;

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
              <Link href="/protected">
                <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Back to workspace
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ClipboardCheck className="h-7 w-7 text-emerald-700 dark:text-emerald-400" />
            Administrator Evaluation Review
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only completion tracking by season, age, and evaluator. Missing ratings are not treated as zero.
          </p>
        </div>
      </div>

      {loadError || ratingResult.error ? (
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300 font-mono">
          Could not load evaluation review data: {loadError ?? ratingResult.error?.message}
        </div>
      ) : sessions.length === 0 ? (
        <Card className="border-border bg-card p-8 text-center space-y-3">
          <ShieldAlert className="h-8 w-8 text-amber-700 dark:text-amber-400 mx-auto" />
          <p className="text-sm font-semibold text-foreground">No Age-Based Evaluation Sessions Found</p>
          <Button asChild variant="outline" size="sm" className="border-border bg-background text-xs text-slate-700 dark:text-slate-300 hover:bg-accent">
            <Link href="/protected/sessions">Manage Sessions</Link>
          </Button>
        </Card>
      ) : (
        <div className="space-y-8">
          {seasons.map((season) => {
            const seasonSessions = sessions.filter((session) => session.season_id === season.id);
            if (!seasonSessions.length) return null;

            return (
              <div key={season.id} className="space-y-6">
                <div className="border-b border-border pb-3">
                  <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                    <Layers className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                    {season.name}
                  </h2>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    Evaluation completion log & saved category ratings
                  </p>
                </div>

                {AGES.filter((age) => seasonSessions.some((session) => session.league_age === age)).map((age) => {
                  const session = seasonSessions.find((item) => item.league_age === age)!;
                  const eligible = registrations.filter(
                    (registration) =>
                      registration.season_id === season.id &&
                      registration.league_age === age
                  );
                  const sessionEvaluations = evaluations.filter(
                    (evaluation) => evaluation.evaluation_session_id === session.id
                  );
                  const evaluatedPlayerIds = new Set(sessionEvaluations.map((evaluation) => evaluation.player_season_id));
                  const missing = eligible.filter((registration) => !evaluatedPlayerIds.has(registration.id));
                  const evaluatorGroups = new Map<string, Evaluation[]>();

                  for (const evaluation of sessionEvaluations) {
                    const key = `${evaluation.evaluator_type}:${evaluation.evaluator_user_id}`;
                    evaluatorGroups.set(key, [...(evaluatorGroups.get(key) ?? []), evaluation]);
                  }

                  const statusCounts = {
                    draft: sessionEvaluations.filter((evaluation) => evaluation.status === "draft").length,
                    submitted: sessionEvaluations.filter((evaluation) => evaluation.status === "submitted").length,
                    notEvaluated: sessionEvaluations.filter((evaluation) => evaluation.status === "not_evaluated").length,
                  };

                  return (
                    <Card key={session.id} className="border-border bg-card">
                      <CardHeader className="py-4 border-b border-border/50">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                              Age {age} &bull; Session #{session.id}
                            </CardTitle>
                            <CardDescription className="text-xs text-muted-foreground font-mono mt-1">
                              Status: <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{session.status}</span>
                            </CardDescription>
                          </div>

                          {/* Quick Summary Metrics Pills */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            <div className="rounded border border-border bg-background p-2">
                              <p className="text-[10px] font-mono text-muted-foreground">Eligible</p>
                              <p className="text-sm font-bold text-foreground font-mono">{eligible.length}</p>
                            </div>
                            <div className="rounded border border-border bg-background p-2">
                              <p className="text-[10px] font-mono text-muted-foreground">Evaluated</p>
                              <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 font-mono">
                                {eligible.filter((r) => evaluatedPlayerIds.has(r.id)).length}
                              </p>
                            </div>
                            <div className="rounded border border-border bg-background p-2">
                              <p className="text-[10px] font-mono text-muted-foreground">Missing</p>
                              <p className="text-sm font-bold text-amber-700 dark:text-amber-400 font-mono">{missing.length}</p>
                            </div>
                            <div className="rounded border border-border bg-background p-2">
                              <p className="text-[10px] font-mono text-muted-foreground">Draft/Submitted</p>
                              <p className="text-sm font-bold text-foreground font-mono">
                                {statusCounts.draft} / {statusCounts.submitted}
                              </p>
                            </div>
                          </div>
                        </div>
                      </CardHeader>

                      <CardContent className="p-6 space-y-6">
                        {/* Age Group Rating Summary Table */}
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold text-foreground font-mono uppercase tracking-wider">
                            Age-Group Rating Summary
                          </h4>
                          <p className="text-[11px] text-muted-foreground font-mono">
                            Averages use submitted evaluations only. Coach and independent ratings are shown separately.
                          </p>

                          <div className="overflow-x-auto rounded-md border border-border">
                            <table className="w-full text-left text-sm">
                              <thead className="bg-background text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
                                <tr>
                                  <th className="px-4 py-2.5">Core Skill</th>
                                  <th className="px-4 py-2.5 text-center">Coach Avg</th>
                                  <th className="px-4 py-2.5 text-center">Coach Ratings</th>
                                  <th className="px-4 py-2.5 text-center">Independent Avg</th>
                                  <th className="px-4 py-2.5 text-center">Independent Ratings</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {categories
                                  .filter((category) => CORE_CODES.includes(category.code as (typeof CORE_CODES)[number]))
                                  .sort((a, b) => CORE_CODES.indexOf(a.code as (typeof CORE_CODES)[number]) - CORE_CODES.indexOf(b.code as (typeof CORE_CODES)[number]))
                                  .map((category) => {
                                    const groupStats = (type: string) => {
                                      const values = sessionEvaluations
                                        .filter((evaluation) => evaluation.status === "submitted" && evaluation.evaluator_type === type)
                                        .flatMap((evaluation) =>
                                          ratings
                                            .filter((rating) => rating.evaluation_id === evaluation.id && rating.rating_category_id === category.id)
                                            .map((rating) => rating.score)
                                        );
                                      return {
                                        average: values.length ? (values.reduce((sum, score) => sum + score, 0) / values.length).toFixed(1) : "—",
                                        count: values.length,
                                      };
                                    };

                                    const coach = groupStats("coach");
                                    const independent = groupStats("independent_evaluator");

                                    return (
                                      <tr key={category.id} className="hover:bg-accent/50 transition-colors">
                                        <td className="px-4 py-2.5 font-medium text-foreground text-xs">
                                          {category.name}
                                        </td>
                                        <td className="px-4 py-2.5 text-center font-mono text-xs text-slate-700 dark:text-slate-300">
                                          {coach.average}
                                        </td>
                                        <td className="px-4 py-2.5 text-center font-mono text-xs text-muted-foreground">
                                          {coach.count}
                                        </td>
                                        <td className="px-4 py-2.5 text-center font-mono text-xs text-emerald-700 dark:text-emerald-400 font-bold">
                                          {independent.average}
                                        </td>
                                        <td className="px-4 py-2.5 text-center font-mono text-xs text-muted-foreground">
                                          {independent.count}
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Evaluator Progress Table */}
                        {evaluatorGroups.size > 0 && (
                          <div className="space-y-3 pt-3 border-t border-border">
                            <h4 className="text-xs font-bold text-foreground font-mono uppercase tracking-wider">
                              Evaluator Submission Progress
                            </h4>
                            <div className="overflow-x-auto rounded-md border border-border">
                              <table className="w-full text-left text-sm">
                                <thead className="bg-background text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
                                  <tr>
                                    <th className="px-4 py-2.5">Evaluator</th>
                                    <th className="px-4 py-2.5">Type</th>
                                    <th className="px-4 py-2.5 text-center">Records</th>
                                    <th className="px-4 py-2.5 text-center">Draft</th>
                                    <th className="px-4 py-2.5 text-center">Submitted</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {[...evaluatorGroups.entries()].map(([key, rows]) => {
                                    const [type, userId] = key.split(":");
                                    return (
                                      <tr key={key} className="hover:bg-accent/50 transition-colors">
                                        <td className="px-4 py-2.5 font-medium text-foreground text-xs">
                                          {evaluatorName(userId)}
                                        </td>
                                        <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">
                                          {type === "independent_evaluator" ? "Independent evaluator" : "Coach"}
                                        </td>
                                        <td className="px-4 py-2.5 text-center font-mono text-xs text-slate-700 dark:text-slate-300">
                                          {rows.length}
                                        </td>
                                        <td className="px-4 py-2.5 text-center font-mono text-xs text-amber-700 dark:text-amber-400">
                                          {rows.filter((row) => row.status === "draft").length}
                                        </td>
                                        <td className="px-4 py-2.5 text-center font-mono text-xs text-emerald-700 dark:text-emerald-400 font-bold">
                                          {rows.filter((row) => row.status === "submitted").length}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* Collapsible Player Level Details */}
                        <details className="group pt-2 border-t border-border">
                          <summary className="cursor-pointer font-bold text-xs font-mono text-emerald-700 dark:text-emerald-400 hover:text-emerald-300 py-2">
                            + View Player-Level Review ({eligible.length} Eligible Players)
                          </summary>
                          <div className="mt-3 overflow-x-auto rounded-md border border-border">
                            <table className="w-full text-left text-sm">
                              <thead className="bg-background text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
                                <tr>
                                  <th className="px-4 py-2.5">Player</th>
                                  <th className="px-4 py-2.5 text-center">Eval #</th>
                                  <th className="px-4 py-2.5">Evaluation Records</th>
                                  <th className="px-4 py-2.5 text-center">Missing Core</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {eligible.map((registration) => {
                                  const playerEvaluations = sessionEvaluations.filter(
                                    (evaluation) => evaluation.player_season_id === registration.id
                                  );
                                  const player = registration.players;
                                  const name = player
                                    ? `${player.last_name}, ${player.first_name}`
                                    : `Registration #${registration.id}`;
                                  const missingCore = playerEvaluations.filter(
                                    (evaluation) => ratingSummary(evaluation.id, ratings, categories).count < 5
                                  ).length;

                                  return (
                                    <tr key={registration.id} className="hover:bg-accent/50 transition-colors align-top">
                                      <td className="px-4 py-3 font-medium text-foreground text-xs">
                                        {name}
                                      </td>
                                      <td className="px-4 py-3 text-center font-mono text-xs text-emerald-700 dark:text-emerald-400 font-bold">
                                        {registration.evaluation_number ?? "—"}
                                      </td>
                                      <td className="px-4 py-3">
                                        {playerEvaluations.length ? (
                                          <div className="space-y-2">
                                            {playerEvaluations.map((evaluation) => {
                                              const summary = ratingSummary(evaluation.id, ratings, categories);
                                              return (
                                                <div key={evaluation.id} className="rounded border border-border bg-background p-2 text-xs">
                                                  <p className="font-semibold text-foreground">
                                                    {evaluation.status} &bull;{" "}
                                                    <span className="text-emerald-700 dark:text-emerald-400">
                                                      {evaluation.evaluator_type === "independent_evaluator" ? "Independent" : "Coach"}
                                                    </span>
                                                  </p>
                                                  <p className="text-[11px] font-mono text-muted-foreground">
                                                    {evaluatorName(evaluation.evaluator_user_id)}
                                                  </p>
                                                  <p className="text-[11px] font-mono text-slate-700 dark:text-slate-300 mt-1">
                                                    Total: {summary.total} &bull; Avg: {summary.average} &bull; Rated: {summary.count}/5
                                                  </p>
                                                  <div className="mt-1 flex flex-wrap items-center gap-2">
                                                    <Link href={`/protected/evaluation-review/${evaluation.id}`} className="text-[11px] font-semibold text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
                                                      View / correct
                                                    </Link>
                                                    {corrected.has(evaluation.id) && (
                                                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-800 dark:text-amber-300">Corrected by admin</span>
                                                    )}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        ) : (
                                          <span className="text-xs text-slate-600 dark:text-slate-400 italic">No record</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-3 text-center font-mono text-xs font-bold text-amber-700 dark:text-amber-400">
                                        {missingCore}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </details>

                        {missing.length > 0 && (
                          <details className="group pt-2 border-t border-border">
                            <summary className="cursor-pointer font-bold text-xs font-mono text-rose-700 dark:text-rose-400 hover:text-rose-300 py-1">
                              + View Players With No Evaluation Record ({missing.length})
                            </summary>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs font-mono text-muted-foreground">
                              {missing.map((registration) => (
                                <li key={registration.id}>
                                  {registration.players
                                    ? `${registration.players.last_name}, ${registration.players.first_name}`
                                    : `Registration #${registration.id}`}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function EvaluationReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="h-96 w-full rounded-lg border border-border bg-card animate-pulse" />
      }
    >
      <EvaluationReviewContent />
    </Suspense>
  );
}