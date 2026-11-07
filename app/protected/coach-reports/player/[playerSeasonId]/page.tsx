import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ playerSeasonId: string }> };
type HistoricalRow = {
  historical_evaluation_id: number;
  source_season_label: string;
  source_division_name: string;
  source_team_label: string | null;
  source_coach_name: string | null;
  coverage_note: string | null;
  category_name: string | null;
  score: number | null;
  rating_category_id: number | null;
};

export default async function CoachHistoricalPlayerReportPage({ params }: Props) {
  await connection();
  const { playerSeasonId: rawId } = await params;
  const playerSeasonId = Number(rawId);
  if (!Number.isSafeInteger(playerSeasonId) || playerSeasonId <= 0) notFound();

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims) redirect("/auth/login");
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError) return <main className="w-full max-w-4xl p-4"><p role="alert">Could not verify account permissions.</p></main>;
  if (isAdmin === true) redirect(`/protected/reports/player/${playerSeasonId}`);

  // The SECURITY DEFINER RPC validates the current user's team assignment before
  // returning any historical information. Do not query historical tables directly.
  const result = await supabase.rpc("coach_historical_report", { p_player_season_id: playerSeasonId });
  if (result.error) notFound();
  const rows = (result.data ?? []) as HistoricalRow[];
  const evaluations = [...new Map(rows.map((row) => [row.historical_evaluation_id, {
    id: row.historical_evaluation_id,
    season: row.source_season_label,
    division: row.source_division_name,
    team: row.source_team_label,
    coach: row.source_coach_name,
    coverage: row.coverage_note,
  }])).values()];

  return (
    <main className="w-full max-w-4xl space-y-6">
      <header className="space-y-2">
        <Link href="/protected/coach-reports" className="text-sm text-muted-foreground hover:underline">← Back to my assigned players</Link>
        <h1 className="text-3xl font-bold tracking-tight">Historical coach ratings</h1>
        <p className="text-sm text-muted-foreground">Prior-season coach ratings for a player on a team assigned to your account. These ratings are read-only and are not combined with current-season averages.</p>
      </header>
      {evaluations.length === 0 ? <p className="rounded-md border p-4 text-sm">No matched historical coach evaluations are available for this player.</p> : evaluations.map((evaluation) => {
        const ratings = rows.filter((row) => row.historical_evaluation_id === evaluation.id && row.category_name !== null && row.score !== null);
        return <section key={evaluation.id} className="space-y-3 rounded-lg border p-4">
          <div><h2 className="text-xl font-semibold">{evaluation.season}</h2><p className="text-sm text-muted-foreground">{evaluation.coach ? `Coach: ${evaluation.coach}` : "Coach not recorded"} · {evaluation.division}{evaluation.team ? ` · Team: ${evaluation.team}` : ""}</p>{evaluation.coverage && <p className="mt-2 text-sm">{evaluation.coverage}</p>}</div>
          {ratings.length === 0 ? <p className="text-sm text-muted-foreground">No historical ratings recorded.</p> : <div className="grid gap-2 sm:grid-cols-2">{ratings.map((rating) => <div key={`${evaluation.id}:${rating.category_name}`} className="flex items-center justify-between rounded-md border p-3 text-sm"><span>{rating.category_name}</span><strong>{rating.score}/5</strong></div>)}</div>}
        </section>;
      })}
    </main>
  );
}
