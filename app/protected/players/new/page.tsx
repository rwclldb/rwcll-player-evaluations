import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { usDate } from "@/lib/players";
import { addOnSitePlayer } from "../actions";

type SearchParams = Promise<{ first?: string; last?: string; message?: string; error?: string }>;
type KnownPlayer = { id: number; first_name: string; last_name: string; date_of_birth: string | null; player_seasons: { season_id: number; league_age: number | null }[] };

// Treat % and _ in typed names literally.
const like = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
const input = "mt-1 block h-11 w-full rounded-md border border-input bg-background px-3 text-base text-foreground sm:text-sm";

async function NewPlayerContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");

  const { data: seasonData } = await supabase.from("seasons").select("id, name, is_closed, start_date").eq("is_closed", false).order("start_date", { ascending: false });
  const seasons = seasonData ?? [];

  // Step 1 looks for players the league already knows (e.g. from last season) so we don't create a duplicate.
  const first = (sp.first ?? "").trim();
  const last = (sp.last ?? "").trim();
  let known: KnownPlayer[] = [];
  if (last) {
    const { data } = await supabase.from("players").select("id, first_name, last_name, date_of_birth, player_seasons(season_id, league_age)")
      .ilike("last_name", like(last)).ilike("first_name", first ? `${like(first)}%` : "%").limit(20);
    known = (data ?? []) as KnownPlayer[];
  }
  const openSeasonIds = new Set(seasons.map((s) => s.id));
  const seasonName = (id: number) => seasons.find((s) => s.id === id)?.name ?? `season ${id}`;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected/players"><ArrowLeft className="mr-1 h-4 w-4" /> All players</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground"><UserPlus className="h-6 w-6 text-emerald-700 dark:text-emerald-400" /> Add a player on site</h1>
        <p className="text-sm text-muted-foreground">
          For a child who shows up at evaluations but isn&apos;t registered in the app. They&apos;re marked &quot;on site&quot;. When they show up in a
          later Sports Connect import, approve the match to this player in import review and the registration is linked.
        </p>
      </div>

      {sp.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{sp.message}</div>}
      {sp.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{sp.error}</div>}

      <form action="/protected/players/new" className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-4">
        <p className="w-full text-sm font-medium text-foreground">1. Check whether the league already knows this child</p>
        <label className="min-w-36 flex-1 text-xs text-muted-foreground">First name<input name="first" defaultValue={first} className={input} /></label>
        <label className="min-w-36 flex-1 text-xs text-muted-foreground">Last name<input name="last" required defaultValue={last} className={input} /></label>
        <Button type="submit" variant="outline" className="h-11">Check</Button>
      </form>

      {last && (
        <form action={addOnSitePlayer} className="space-y-4 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">2. Add them</p>
          <fieldset className="space-y-2">
            <legend className="text-xs text-muted-foreground">Player</legend>
            {known.filter((p) => p.player_seasons.some((r) => openSeasonIds.has(r.season_id))).map((p) => (
              <p key={p.id} className="rounded border border-border p-2 text-sm text-muted-foreground">
                {p.first_name} {p.last_name}{p.date_of_birth ? `, born ${usDate(p.date_of_birth)}` : ""} is already registered this season.{" "}
                <Link href={`/protected/players?q=${encodeURIComponent(`${p.first_name} ${p.last_name}`)}`} className="text-foreground underline">Find them</Link>
              </p>
            ))}
            {known.filter((p) => !p.player_seasons.some((r) => openSeasonIds.has(r.season_id))).map((p) => (
              <label key={p.id} className="flex items-start gap-2 rounded border border-border p-2 text-sm">
                <input type="radio" name="existingPlayerId" value={p.id} className="mt-1" />
                <span>
                  Use {p.first_name} {p.last_name}{p.date_of_birth ? `, born ${usDate(p.date_of_birth)}` : ", no birthdate"}
                  <span className="block text-xs text-muted-foreground">
                    {p.player_seasons.length ? `Registered: ${p.player_seasons.map((r) => `${seasonName(r.season_id)}${r.league_age ? ` (age ${r.league_age})` : ""}`).join(", ")}` : "No registrations"}
                  </span>
                </span>
              </label>
            ))}
            <label className="flex items-start gap-2 rounded border border-border p-2 text-sm">
              <input type="radio" name="existingPlayerId" value="new" defaultChecked className="mt-1" />
              <span>{known.length ? "None of these: add a new player" : "No one by that name yet: add a new player"}</span>
            </label>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-foreground">First name<input name="firstName" defaultValue={first} className={input} /></label>
            <label className="text-sm font-medium text-foreground">Last name<input name="lastName" defaultValue={last} className={input} /></label>
            <label className="text-sm font-medium text-foreground">Birthdate (if known)<input name="birthDate" placeholder="MM/DD/YYYY" className={input} /></label>
            <label className="text-sm font-medium text-foreground">Age group (league age)
              <input name="leagueAge" required inputMode="numeric" className={input} />
            </label>
            <label className="text-sm font-medium text-foreground">Bib (optional)<input name="bib" inputMode="numeric" className={input} /></label>
            <label className="text-sm font-medium text-foreground">Season
              <select name="seasonId" className={input}>
                {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Name and birthdate fields are used only for a new player; choosing an existing player keeps their details.</p>
          <label className="block text-sm font-medium text-foreground">Reason
            <input name="reason" required defaultValue="Walk-up at evaluations" className={input} />
          </label>
          <div className="flex justify-end"><Button type="submit" className="min-h-11">Add player</Button></div>
        </form>
      )}
    </div>
  );
}

export default function NewPlayerPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <NewPlayerContent searchParams={searchParams} />
    </Suspense>
  );
}
