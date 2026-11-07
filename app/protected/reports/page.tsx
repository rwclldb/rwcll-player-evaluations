import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ seasonId?: string }>;
type Season = { id: number; name: string };
type Registration = {
  id: number;
  player_id: number;
  season_id: number;
  league_age: number | null;
  evaluation_number: number | null;
  registration_payment_status: string | null;
  players: { first_name: string; last_name: string } | null;
};

export default function PlayerReportsPage({ searchParams }: { searchParams: SearchParams }) {
  return <Suspense fallback={<main className="w-full max-w-5xl p-4">Loading player reports…</main>}><PlayerReportsContent searchParams={searchParams} /></Suspense>;
}

async function PlayerReportsContent({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims) redirect("/auth/login");
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError || isAdmin !== true) redirect("/protected");

  const [seasonResult] = await Promise.all([
    supabase.from("seasons").select("id, name").order("id", { ascending: false }),
  ]);
  const seasons = (seasonResult.data ?? []) as Season[];
  const requestedSeasonId = params.seasonId ? Number(params.seasonId) : seasons[0]?.id;
  const selectedSeason = seasons.find((season) => season.id === requestedSeasonId);
  const registrationResult = selectedSeason
    ? await supabase.from("player_seasons")
        .select("id, player_id, season_id, league_age, evaluation_number, registration_payment_status, players(first_name, last_name)")
        .eq("season_id", selectedSeason.id)
        .order("league_age", { ascending: false })
        .order("evaluation_number", { ascending: true, nullsFirst: false })
    : { data: [], error: null };
  const registrations = (registrationResult.data ?? []) as unknown as Registration[];

  return (
    <main className="w-full max-w-5xl space-y-6">
      <header className="space-y-2">
        <Link href="/protected" className="text-sm text-muted-foreground hover:underline">← Back to workspace</Link>
        <h1 className="text-3xl font-bold tracking-tight">Player reports</h1>
        <p className="text-sm text-muted-foreground">Administrator-only individual reports. Current-season evaluations and historical coach ratings are displayed separately.</p>
      </header>

      {seasonResult.error || registrationResult.error ? (
        <p role="alert" className="rounded-md border p-4 text-sm">Could not load report data: {seasonResult.error?.message ?? registrationResult.error?.message}</p>
      ) : seasons.length === 0 ? (
        <p className="rounded-md border p-4 text-sm">No seasons are available yet.</p>
      ) : (
        <>
          <section className="rounded-lg border p-4 space-y-3">
            <h2 className="font-semibold">Choose a season</h2>
            <div className="flex flex-wrap gap-2">
              {seasons.map((season) => (
                <Link key={season.id} href={`/protected/reports?seasonId=${season.id}`}
                  aria-current={selectedSeason?.id === season.id ? "page" : undefined}
                  className={`rounded-md border px-3 py-2 text-sm ${selectedSeason?.id === season.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
                  {season.name}
                </Link>
              ))}
            </div>
            {selectedSeason && <a href={`/protected/reports/export?seasonId=${selectedSeason.id}`} className="inline-flex rounded-md border px-3 py-2 text-sm font-medium">Export season CSV</a>}
          </section>

          {!selectedSeason ? (
            <p role="alert" className="rounded-md border p-4 text-sm">Choose a valid season.</p>
          ) : registrations.length === 0 ? (
            <p className="rounded-md border p-4 text-sm">No player registrations found for {selectedSeason.name}.</p>
          ) : (
            <section className="space-y-3">
              <h2 className="text-xl font-semibold">{selectedSeason.name} · {registrations.length} registrations</h2>
              <ul className="space-y-2">
                {registrations.map((registration) => {
                  const player = registration.players;
                  const name = player ? `${player.last_name}, ${player.first_name}` : `Registration #${registration.id}`;
                  return (
                    <li key={registration.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium">{name}</p>
                        <p className="text-sm text-muted-foreground">Age {registration.league_age ?? "not set"} · Eval # {registration.evaluation_number ?? "—"} · Registration status: {registration.registration_payment_status ?? "Unknown"}</p>
                      </div>
                      <Link href={`/protected/reports/player/${registration.id}`} className="inline-flex w-fit rounded-md border px-3 py-2 text-sm">Open report</Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
