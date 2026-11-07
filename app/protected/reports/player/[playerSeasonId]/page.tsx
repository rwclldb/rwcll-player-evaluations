import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ playerSeasonId: string }> };
type PlayerSeason = {
  id: number; player_id: number; season_id: number; league_age: number | null; evaluation_number: number | null; registration_payment_status: string | null;
  players: { first_name: string; last_name: string; date_of_birth: string | null } | null;
};
type Session = { id: number; league_age: number | null; status: string };
type Evaluation = { id: number; evaluation_session_id: number; evaluator_user_id: string; evaluator_type: string; status: string; submitted_at: string | null };
type Category = { id: number; code: string; name: string; category_group: string; sort_order: number };
type Rating = { evaluation_id: number; rating_category_id: number; score: number };
type Profile = { user_id: string; display_name: string | null };
type HistoricalEvaluation = { id: number; source_season_label: string; source_division_name: string; source_team_label: string | null; source_coach_name: string | null; coverage_note: string | null; source_season_id: number | null };
type HistoricalRating = { historical_evaluation_id: number; category_name: string; score: number; rating_category_id: number | null };

export default function PlayerReportPage({ params }: Props) {
  return <Suspense fallback={<main className="w-full max-w-5xl p-4">Loading player report…</main>}><PlayerReportContent params={params} /></Suspense>;
}

async function PlayerReportContent({ params }: Props) {
  await connection();
  const { playerSeasonId: rawId } = await params;
  const playerSeasonId = Number(rawId);
  if (!Number.isSafeInteger(playerSeasonId) || playerSeasonId <= 0) notFound();
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims) redirect("/auth/login");
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError || isAdmin !== true) redirect("/protected");

  const registrationResult = await supabase.from("player_seasons")
    .select("id, player_id, season_id, league_age, evaluation_number, registration_payment_status, players(first_name, last_name, date_of_birth)")
    .eq("id", playerSeasonId).maybeSingle();
  if (registrationResult.error) return <main className="w-full max-w-5xl p-4"><p role="alert">Could not load player report: {registrationResult.error.message}</p></main>;
  if (!registrationResult.data) notFound();
  const registration = registrationResult.data as unknown as PlayerSeason;
  const playerName = registration.players ? `${registration.players.first_name} ${registration.players.last_name}` : `Player #${registration.player_id}`;

  const [seasonResult, sessionsResult, categoriesResult, profilesResult, historyResult] = await Promise.all([
    supabase.from("seasons").select("id, name").eq("id", registration.season_id).maybeSingle(),
    supabase.from("evaluation_sessions").select("id, league_age, status").eq("season_id", registration.season_id).is("season_division_id", null),
    supabase.from("rating_categories").select("id, code, name, category_group, sort_order").order("sort_order"),
    supabase.from("user_profiles").select("user_id, display_name"),
    supabase.from("historical_evaluations").select("id, source_season_label, source_division_name, source_team_label, source_coach_name, coverage_note, source_season_id").eq("player_id", registration.player_id).order("source_season_id", { ascending: false }),
  ]);
  const loadError = seasonResult.error?.message ?? sessionsResult.error?.message ?? categoriesResult.error?.message ?? profilesResult.error?.message ?? historyResult.error?.message;
  if (loadError) return <main className="w-full max-w-5xl p-4"><p role="alert">Could not load report details: {loadError}</p></main>;
  const sessions = (sessionsResult.data ?? []) as Session[];
  const categories = (categoriesResult.data ?? []) as Category[];
  const historical = (historyResult.data ?? []) as HistoricalEvaluation[];
  const profiles = (profilesResult.data ?? []) as Profile[];
  const sessionIds = sessions.map((session) => session.id);
  const evaluationResult = sessionIds.length ? await supabase.from("evaluations")
    .select("id, evaluation_session_id, evaluator_user_id, evaluator_type, status, submitted_at")
    .eq("player_season_id", registration.id).in("evaluation_session_id", sessionIds) : { data: [], error: null };
  const evaluations = (evaluationResult.data ?? []) as Evaluation[];
  const evaluationIds = evaluations.map((evaluation) => evaluation.id);
  const ratingResult = evaluationIds.length ? await supabase.from("ratings")
    .select("evaluation_id, rating_category_id, score").in("evaluation_id", evaluationIds) : { data: [], error: null };
  const ratings = (ratingResult.data ?? []) as Rating[];
  const historicalIds = historical.map((item) => item.id);
  const historicalRatingResult = historicalIds.length ? await supabase.from("historical_ratings")
    .select("historical_evaluation_id, category_name, score, rating_category_id").in("historical_evaluation_id", historicalIds) : { data: [], error: null };
  const historicalRatings = (historicalRatingResult.data ?? []) as HistoricalRating[];
  const downstreamError = evaluationResult.error?.message ?? ratingResult.error?.message ?? historicalRatingResult.error?.message;
  const seasonName = seasonResult.data?.name ?? `Season #${registration.season_id}`;
  const evaluatorName = (userId: string) => profiles.find((profile) => profile.user_id === userId)?.display_name?.trim() || "Evaluator";

  return (
    <main className="w-full max-w-5xl space-y-8">
      <header className="space-y-2">
        <Link href={`/protected/reports?seasonId=${registration.season_id}`} className="text-sm text-muted-foreground hover:underline">← Back to {seasonName} reports</Link>
        <h1 className="text-3xl font-bold tracking-tight">{playerName}</h1>
        <p className="text-sm text-muted-foreground">{seasonName} · Little League age {registration.league_age ?? "not set"} · Evaluation # {registration.evaluation_number ?? "—"} · Registration status: {registration.registration_payment_status ?? "Unknown"}</p>
        <p className="text-sm text-muted-foreground">Administrator report. Current ratings and historical coach ratings are separate and are never combined into one average.</p>
      </header>
      {downstreamError && <p role="alert" className="rounded-md border p-4 text-sm">Could not load all ratings: {downstreamError}</p>}

      <section className="space-y-4">
        <div><h2 className="text-2xl font-semibold">Current-season evaluations</h2><p className="text-sm text-muted-foreground">Only ratings actually entered are shown. Draft records are labeled as drafts and are not treated as submitted evaluations.</p></div>
        {evaluations.length === 0 ? <p className="rounded-md border p-4 text-sm">No current-season evaluation records.</p> : evaluations.map((evaluation) => {
          const session = sessions.find((item) => item.id === evaluation.evaluation_session_id);
          const ownRatings = ratings.filter((rating) => rating.evaluation_id === evaluation.id);
          return <article key={evaluation.id} className="space-y-3 rounded-lg border p-4">
            <div><h3 className="font-semibold">Age {session?.league_age ?? "—"} · {evaluation.evaluator_type === "independent_evaluator" ? "Independent evaluator" : "Coach"}</h3><p className="text-sm text-muted-foreground">{evaluatorName(evaluation.evaluator_user_id)} · {evaluation.status}{evaluation.submitted_at ? ` · Submitted ${new Date(evaluation.submitted_at).toLocaleDateString()}` : ""}</p></div>
            {ownRatings.length === 0 ? <p className="text-sm text-muted-foreground">No ratings entered.</p> : <div className="grid gap-2 sm:grid-cols-2">{ownRatings.map((rating) => {
              const category = categories.find((item) => item.id === rating.rating_category_id);
              return <div key={rating.rating_category_id} className="flex items-center justify-between rounded-md border p-3 text-sm"><span>{category?.name ?? "Unmapped category"}</span><strong>{rating.score}/5</strong></div>;
            })}</div>}
          </article>;
        })}
      </section>

      <section className="space-y-4">
        <div><h2 className="text-2xl font-semibold">Historical coach evaluations</h2><p className="text-sm text-muted-foreground">Prior-season source ratings for context only. They do not affect current-season ratings, averages, or completion counts.</p></div>
        {historical.length === 0 ? <p className="rounded-md border p-4 text-sm">No matched historical coach evaluations.</p> : historical.map((item) => {
          const ownRatings = historicalRatings.filter((rating) => rating.historical_evaluation_id === item.id);
          return <article key={item.id} className="space-y-3 rounded-lg border p-4">
            <div><h3 className="font-semibold">{item.source_season_label}</h3><p className="text-sm text-muted-foreground">{item.source_coach_name ? `Coach: ${item.source_coach_name}` : "Coach not recorded"} · {item.source_division_name}{item.source_team_label ? ` · Team: ${item.source_team_label}` : ""}</p>{item.coverage_note && <p className="mt-2 text-sm">{item.coverage_note}</p>}</div>
            {ownRatings.length === 0 ? <p className="text-sm text-muted-foreground">No historical ratings recorded.</p> : <div className="grid gap-2 sm:grid-cols-2">{ownRatings.map((rating) => {
              const category = categories.find((entry) => entry.id === rating.rating_category_id);
              return <div key={`${item.id}:${rating.category_name}`} className="flex items-center justify-between rounded-md border p-3 text-sm"><span>{category?.name ?? rating.category_name}</span><strong>{rating.score}/5</strong></div>;
            })}</div>}
          </article>;
        })}
      </section>
    </main>
  );
}
