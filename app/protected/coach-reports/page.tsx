import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

export default async function CoachReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims) redirect("/auth/login");

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError) {
    return <main className="w-full max-w-4xl space-y-4 p-4"><p role="alert" className="rounded-md border p-4 text-sm">Could not verify account permissions.</p></main>;
  }
  if (isAdmin === true) redirect("/protected/reports");

  const seasonsResult = await supabase.from("seasons").select("id, name").order("id", { ascending: false });
  const seasons = (seasonsResult.data ?? []) as Season[];
  const requestedSeasonId = params.seasonId ? Number(params.seasonId) : seasons[0]?.id;
  const selectedSeason = seasons.find((season) => season.id === requestedSeasonId);
  const rosterResult = selectedSeason
    ? await supabase.rpc("coach_historical_report_roster", { p_season_id: selectedSeason.id })
    : { data: [], error: null };
  const roster = (rosterResult.data ?? []) as RosterRow[];

  return (
    <main className="w-full max-w-4xl space-y-6">
      <header className="space-y-2">
        <Link href="/protected/evaluations" className="text-sm text-muted-foreground hover:underline">← Back to evaluator workspace</Link>
        <h1 className="text-3xl font-bold tracking-tight">My players’ historical ratings</h1>
        <p className="text-sm text-muted-foreground">Only players on teams assigned to your account are listed. This page shows prior-season coach ratings only, not individual current-season evaluations.</p>
      </header>

      {seasonsResult.error ? <p role="alert" className="rounded-md border p-4 text-sm">Could not load seasons.</p> : seasons.length === 0 ? <p className="rounded-md border p-4 text-sm">No seasons are available.</p> : (
        <>
          <section className="rounded-lg border p-4 space-y-3">
            <h2 className="font-semibold">Choose a season</h2>
            <div className="flex flex-wrap gap-2">
              {seasons.map((season) => <Link key={season.id} href={`/protected/coach-reports?seasonId=${season.id}`} aria-current={selectedSeason?.id === season.id ? "page" : undefined} className={`rounded-md border px-3 py-2 text-sm ${selectedSeason?.id === season.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>{season.name}</Link>)}
            </div>
          </section>
          {!selectedSeason ? <p role="alert" className="rounded-md border p-4 text-sm">Choose a valid season.</p> : rosterResult.error ? (
            <p role="alert" className="rounded-md border p-4 text-sm">Could not load assigned players. Confirm that the local migration for scoped coach reports has been applied.</p>
          ) : roster.length === 0 ? (
            <p className="rounded-md border p-4 text-sm">No players are assigned to your teams for {selectedSeason.name}. Ask an administrator to verify team and coach assignments.</p>
          ) : (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold">{selectedSeason.name} · {roster.length} assigned players</h2>
              <ul className="space-y-2">
                {roster.map((player) => <li key={player.player_season_id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="font-medium">{player.last_name}, {player.first_name}</p><p className="text-sm text-muted-foreground">{player.team_name ?? "Team name not set"} · Age {player.league_age ?? "not set"} · Eval # {player.evaluation_number ?? "—"}</p></div>
                  <Link href={`/protected/coach-reports/player/${player.player_season_id}`} className="inline-flex w-fit rounded-md border px-3 py-2 text-sm">View historical ratings</Link>
                </li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
