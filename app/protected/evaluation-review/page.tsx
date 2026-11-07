import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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
  registration_payment_status: string | null;
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
const AGES = [16, 15, 14, 13, 12, 11, 10, 9, 8];

function isEligibleRegistrationStatus(status: string | null) {
  const normalized = status?.trim().toLowerCase();
  return ["completed", "paid", "pending"].includes(normalized ?? "");
}

function ratingSummary(
  evaluationId: number,
  ratings: Rating[],
  categories: Category[],
) {
  const coreIds = new Map(
    categories
      .filter((category) => CORE_CODES.includes(category.code as (typeof CORE_CODES)[number]))
      .map((category) => [category.id, category.code]),
  );
  const byCode = new Map<string, number>();
  for (const rating of ratings) {
    if (rating.evaluation_id !== evaluationId) continue;
    const code = coreIds.get(rating.rating_category_id);
    if (code) byCode.set(code, rating.score);
  }
  const scores = CORE_CODES.flatMap((code) =>
    byCode.has(code) ? [byCode.get(code)!] : [],
  );
  const total = scores.reduce((sum, score) => sum + score, 0);
  const average = scores.length ? (total / scores.length).toFixed(1) : "—";
  return {
    total: scores.length === 5 ? `${total}/25` : scores.length ? `${total} (${scores.length}/5)` : "—",
    average,
    count: scores.length,
  };
}

function EvaluationReviewFallback() {
  return (
    <main className="w-full max-w-6xl space-y-4">
      <h1 className="text-3xl font-bold">Evaluation review</h1>
      <p className="text-sm text-muted-foreground">Loading evaluation summaries…</p>
    </main>
  );
}

export default function EvaluationReviewPage() {
  return (
    <Suspense fallback={<EvaluationReviewFallback />}>
      <EvaluationReviewContent />
    </Suspense>
  );
}

async function EvaluationReviewContent() {
  await connection();
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims) redirect("/auth/login");

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError || isAdmin !== true) redirect("/protected");

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
    supabase
      .from("player_seasons")
      .select("id, season_id, league_age, evaluation_number, registration_payment_status, players(first_name, last_name)"),
    supabase
      .from("evaluations")
      .select("id, evaluation_session_id, player_season_id, evaluator_user_id, evaluator_type, status"),
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

  const ratingResult = evaluations.length
    ? await supabase
        .from("ratings")
        .select("evaluation_id, rating_category_id, score")
        .in("evaluation_id", evaluations.map((evaluation) => evaluation.id))
    : { data: [] as Rating[], error: null };
  const ratings = (ratingResult.data ?? []) as Rating[];

  const seasonName = (seasonId: number) =>
    seasons.find((season) => season.id === seasonId)?.name ?? `Season #${seasonId}`;
  const evaluatorName = (userId: string) =>
    profiles.find((profile) => profile.user_id === userId)?.display_name?.trim() || userId;

  return (
    <main className="w-full max-w-6xl space-y-8">
      <header className="space-y-2">
        <Link href="/protected" className="text-sm text-muted-foreground hover:underline">
          ← Back to workspace
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Administrator evaluation review</h1>
        <p className="text-sm text-muted-foreground">
          Read-only completion tracking by season, age, and evaluator. Missing ratings remain missing; they are not treated as zero.
        </p>
      </header>

      {loadError || ratingResult.error ? (
        <p role="alert" className="rounded-md border p-4 text-sm">
          Could not load evaluation review data: {loadError ?? ratingResult.error?.message}
        </p>
      ) : sessions.length === 0 ? (
        <div className="rounded-lg border p-5">
          <p className="font-medium">No age-based evaluation sessions found.</p>
          <Link href="/protected/sessions" className="mt-3 inline-flex rounded-md border px-3 py-2 text-sm">
            Manage sessions
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {seasons.map((season) => {
            const seasonSessions = sessions.filter((session) => session.season_id === season.id);
            if (!seasonSessions.length) return null;
            return (
              <section key={season.id} className="space-y-4">
                <div>
                  <h2 className="text-2xl font-semibold">{season.name}</h2>
                  <p className="text-sm text-muted-foreground">Evaluation completion and saved ratings</p>
                </div>
                {AGES.filter((age) => seasonSessions.some((session) => session.league_age === age)).map((age) => {
                  const session = seasonSessions.find((item) => item.league_age === age)!;
                  const eligible = registrations.filter((registration) =>
                    registration.season_id === season.id &&
                    registration.league_age === age &&
                    isEligibleRegistrationStatus(registration.registration_payment_status),
                  );
                  const sessionEvaluations = evaluations.filter((evaluation) => evaluation.evaluation_session_id === session.id);
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
                    <article key={session.id} className="space-y-4 rounded-lg border p-4 sm:p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <h3 className="text-xl font-semibold">Age {age}</h3>
                          <p className="text-sm text-muted-foreground">Session #{session.id} · Status: <strong>{session.status}</strong></p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                          <div className="rounded-md border p-2"><p className="text-muted-foreground">Eligible</p><p className="text-lg font-semibold">{eligible.length}</p></div>
                          <div className="rounded-md border p-2"><p className="text-muted-foreground">Players with a record</p><p className="text-lg font-semibold">{eligible.filter((registration) => evaluatedPlayerIds.has(registration.id)).length}</p></div>
                          <div className="rounded-md border p-2"><p className="text-muted-foreground">Missing</p><p className="text-lg font-semibold">{missing.length}</p></div>
                          <div className="rounded-md border p-2"><p className="text-muted-foreground">Draft / Submitted</p><p className="text-lg font-semibold">{statusCounts.draft} / {statusCounts.submitted}</p></div>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-3">
                        <p className="text-sm">Not evaluated records: <strong>{statusCounts.notEvaluated}</strong></p>
                        <p className="text-sm">Evaluator submissions: <strong>{sessionEvaluations.length}</strong></p>
                        <p className="text-sm">Players missing all evaluations: <strong>{missing.length}</strong></p>
                      </div>

                      {evaluatorGroups.size > 0 && (
                        <section className="space-y-2">
                          <h4 className="font-semibold">Evaluator progress</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[34rem] text-left text-sm">
                              <thead><tr className="border-b"><th className="py-2 pr-3">Evaluator</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Records</th><th className="py-2 pr-3">Draft</th><th className="py-2">Submitted</th></tr></thead>
                              <tbody>
                                {[...evaluatorGroups.entries()].map(([key, rows]) => {
                                  const [type, userId] = key.split(":");
                                  return <tr key={key} className="border-b last:border-0"><td className="py-2 pr-3">{evaluatorName(userId)}</td><td className="py-2 pr-3">{type === "independent_evaluator" ? "Independent evaluator" : "Coach"}</td><td className="py-2 pr-3">{rows.length}</td><td className="py-2 pr-3">{rows.filter((row) => row.status === "draft").length}</td><td className="py-2">{rows.filter((row) => row.status === "submitted").length}</td></tr>;
                                })}
                              </tbody>
                            </table>
                          </div>
                        </section>
                      )}

                      <details>
                        <summary className="cursor-pointer font-medium">Player-level review ({eligible.length} eligible)</summary>
                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full min-w-[44rem] text-left text-sm">
                            <thead><tr className="border-b"><th className="py-2 pr-3">Player</th><th className="py-2 pr-3">Eval #</th><th className="py-2 pr-3">Registration</th><th className="py-2 pr-3">Evaluation records</th><th className="py-2">Missing core ratings</th></tr></thead>
                            <tbody>
                              {eligible.map((registration) => {
                                const playerEvaluations = sessionEvaluations.filter((evaluation) => evaluation.player_season_id === registration.id);
                                const player = registration.players;
                                const name = player ? `${player.last_name}, ${player.first_name}` : `Registration #${registration.id}`;
                                const missingCore = playerEvaluations.filter((evaluation) => ratingSummary(evaluation.id, ratings, categories).count < 5).length;
                                return (
                                  <tr key={registration.id} className="border-b last:border-0 align-top">
                                    <td className="py-2 pr-3">{name}</td>
                                    <td className="py-2 pr-3">{registration.evaluation_number ?? "—"}</td>
                                    <td className="py-2 pr-3">{registration.registration_payment_status ?? "Unknown"}</td>
                                    <td className="py-2 pr-3">
                                      {playerEvaluations.length ? (
                                        <ul className="space-y-2">
                                          {playerEvaluations.map((evaluation) => {
                                            const summary = ratingSummary(evaluation.id, ratings, categories);
                                            return <li key={evaluation.id} className="rounded-md border p-2"><p className="font-medium">{evaluation.status} · {evaluation.evaluator_type === "independent_evaluator" ? "Independent evaluator" : "Coach"}</p><p className="text-xs text-muted-foreground">{evaluatorName(evaluation.evaluator_user_id)}</p><p>Core total: {summary.total} · Average: {summary.average} · Rated: {summary.count}/5</p></li>;
                                          })}
                                        </ul>
                                      ) : <span className="text-muted-foreground">No evaluation record</span>}
                                    </td>
                                    <td className="py-2">{missingCore}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </details>

                      {missing.length > 0 && (
                        <details>
                          <summary className="cursor-pointer font-medium">Players with no evaluation record ({missing.length})</summary>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                            {missing.map((registration) => <li key={registration.id}>{registration.players ? `${registration.players.last_name}, ${registration.players.first_name}` : `Registration #${registration.id}`}</li>)}
                          </ul>
                        </details>
                      )}
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
