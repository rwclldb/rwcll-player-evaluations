import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, Hash, Search, UserPlus, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { CoachKidBadge } from "@/components/coach-kid-badge";
import { type RegistrationRow, usDate } from "@/lib/players";

type SearchParams = Promise<{ season?: string; q?: string; show?: string; age?: string; message?: string; error?: string }>;


const FILTERS = [
  { key: "all", label: "All" },
  { key: "nobib", label: "No bib" },
  { key: "noage", label: "No age group" },
  { key: "onsite", label: "Added on site" },
  { key: "coachkid", label: "Coach's kids" },
] as const;


async function PlayersContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");

  const { data: seasonData } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
  const seasons = seasonData ?? [];
  const season = seasons.find((s) => String(s.id) === params.season) ?? seasons.find((s) => !s.is_closed) ?? seasons[0];

  const { data, error } = season
    ? await supabase.from("player_seasons")
        .select("id, season_id, evaluation_number, league_age, league_age_source, registration_source, external_player_id, is_coach_kid, players(id, first_name, last_name, date_of_birth)")
        .eq("season_id", season.id)
    : { data: [], error: null };
  const all = ((data ?? []) as unknown as RegistrationRow[]).sort(
    (a, b) => (a.players?.last_name ?? "").localeCompare(b.players?.last_name ?? "") || (a.players?.first_name ?? "").localeCompare(b.players?.first_name ?? ""),
  );

  const counts = {
    all: all.length,
    nobib: all.filter((r) => r.evaluation_number === null && r.league_age !== null).length,
    noage: all.filter((r) => r.league_age === null).length,
    onsite: all.filter((r) => r.registration_source === "on_site").length,
    coachkid: all.filter((r) => r.is_coach_kid).length,
  };
  const show = FILTERS.some((f) => f.key === params.show) ? params.show! : "all";
  const q = (params.q ?? "").trim().toLowerCase();
  const ages = [...new Set(all.map((r) => r.league_age).filter((a): a is number => a !== null))].sort((a, b) => a - b);
  const rows = all.filter((r) => {
    if (show === "nobib" && !(r.evaluation_number === null && r.league_age !== null)) return false;
    if (show === "noage" && r.league_age !== null) return false;
    if (show === "onsite" && r.registration_source !== "on_site") return false;
    if (show === "coachkid" && !r.is_coach_kid) return false;
    if (params.age && String(r.league_age) !== params.age) return false;
    if (!q) return true;
    const hay = `${r.players?.first_name} ${r.players?.last_name} ${r.players?.last_name}, ${r.players?.first_name} ${r.evaluation_number ?? ""} ${r.external_player_id ?? ""}`.toLowerCase();
    return hay.includes(q.replace(/^#/, ""));
  });
  const base = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    if (season) p.set("season", String(season.id));
    const merged = { show, q: params.q, age: params.age, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "show" && v === "all")) p.set(k, v);
    return `/protected/players?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> Roadmap</Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            <Users className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> Players
          </h1>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm"><Link href="/protected/players/bibs"><Hash className="mr-1 h-4 w-4" /> Upload bibs</Link></Button>
            <Button asChild size="sm"><Link href="/protected/players/new"><UserPlus className="mr-1 h-4 w-4" /> Add player on site</Link></Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Registered players for the season. Open a player to fix their name or birthdate, set their age group, or change their bib.
        </p>
      </div>

      {params.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{params.message}</div>}
      {params.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{params.error}</div>}
      {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">Could not load players: {error.message}</div>}

      <form action="/protected/players" className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">
          Season
          <select name="season" defaultValue={season?.id} className="mt-1 block h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_closed ? " (closed)" : ""}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Age
          <select name="age" defaultValue={params.age ?? ""} className="mt-1 block h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            <option value="">All</option>
            {ages.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="min-w-48 flex-1 text-xs text-muted-foreground">
          Search
          <input name="q" defaultValue={params.q ?? ""} placeholder="Name, bib, or Player Id" className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-base text-foreground sm:text-sm" />
        </label>
        {show !== "all" && <input type="hidden" name="show" value={show} />}
        <Button type="submit" className="h-10"><Search className="mr-1 h-4 w-4" /> Find</Button>
      </form>

      <nav aria-label="Filters" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={base({ show: f.key })}
            className={`rounded-md border px-3 py-1.5 text-sm ${show === f.key ? "border-emerald-500 bg-emerald-600 text-white" : "border-border bg-card text-foreground hover:bg-accent"}`}>
            {f.label} <span className="opacity-75">({counts[f.key]})</span>
          </Link>
        ))}
      </nav>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Bib</th>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2">Birthdate</th>
              <th className="px-3 py-2">Age</th>
              <th className="hidden px-3 py-2 sm:table-cell">Player Id</th>
              <th className="px-3 py-2"><span className="sr-only">Notes</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-accent/50">
                <td className="px-3 py-2 font-mono font-bold">{r.evaluation_number ?? <span className="font-sans text-xs font-normal text-amber-700 dark:text-amber-400">none</span>}</td>
                <td className="px-3 py-2">
                  <Link href={`/protected/players/${r.id}`} className="font-medium text-foreground underline-offset-2 hover:underline">
                    {r.players?.last_name}, {r.players?.first_name}
                  </Link>
                  {r.is_coach_kid && <span className="ml-2 align-middle"><CoachKidBadge /></span>}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{usDate(r.players?.date_of_birth ?? null) || <span className="font-sans text-amber-700 dark:text-amber-400">missing</span>}</td>
                <td className="px-3 py-2">{r.league_age ?? <span className="text-xs text-amber-700 dark:text-amber-400">not set</span>}</td>
                <td className="hidden px-3 py-2 font-mono text-xs text-muted-foreground sm:table-cell">{r.external_player_id ?? "—"}</td>
                <td className="px-3 py-2 text-xs">
                  <div className="flex flex-wrap gap-1">
                    {r.registration_source === "on_site" && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-800 dark:text-sky-300">On site{r.external_player_id ? "" : ", not in Sports Connect yet"}</span>}
                    {r.league_age_source === "admin" && <span className="rounded bg-slate-500/15 px-1.5 py-0.5 text-slate-700 dark:text-slate-300">Age set by admin</span>}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No players match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Showing {rows.length} of {all.length} registrations. Players with no age group are not in any evaluation session until one is set.</p>
    </div>
  );
}

export default function PlayersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <PlayersContent searchParams={searchParams} />
    </Suspense>
  );
}
