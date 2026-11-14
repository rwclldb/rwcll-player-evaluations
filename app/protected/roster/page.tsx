import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoachKidBadge } from "@/components/coach-kid-badge";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "./print-button";

type Registration = {
  id: number;
  league_age: number;
  evaluation_number: number | null;
  is_coach_kid: boolean;
  players: { first_name: string; last_name: string; date_of_birth: string | null } | null;
};

// Evaluation-day roster: bib, name, birthdate, and blank Check-in / Notes columns. No ratings.
export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ age?: string; sort?: string; seasonId?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");

  const { data: seasons } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
  const season = (seasons ?? []).find((s) => String(s.id) === params.seasonId) ?? (seasons ?? []).find((s) => !s.is_closed) ?? seasons?.[0];
  const sort = params.sort === "name" ? "name" : "bib";
  const age = params.age === "all" || !params.age ? "all" : Number(params.age);

  const registrations: Registration[] = [];
  if (season) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("player_seasons")
        .select("id, league_age, evaluation_number, is_coach_kid, players(first_name, last_name, date_of_birth)")
        .eq("season_id", season.id)
        .gte("league_age", 7)
        .lte("league_age", 16)
        .order("id")
        .range(from, from + 999);
      if (error || !data) break;
      registrations.push(...(data as unknown as Registration[]));
      if (data.length < 1000) break;
    }
  }

  const ages = [...new Set(registrations.map((r) => r.league_age))].sort((a, b) => a - b);
  const shownAges = age === "all" ? ages : ages.filter((a) => a === age);
  const byName = (a: Registration, b: Registration) =>
    `${a.players?.last_name} ${a.players?.first_name}`.localeCompare(`${b.players?.last_name} ${b.players?.first_name}`);
  const order = (list: Registration[]) =>
    [...list].sort(sort === "name" ? byName : (a, b) => (a.evaluation_number ?? Infinity) - (b.evaluation_number ?? Infinity) || byName(a, b));
  const link = (next: Partial<{ age: string; sort: string }>) =>
    `/protected/roster?seasonId=${season?.id}&age=${next.age ?? String(age)}&sort=${next.sort ?? sort}`;
  const pill = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm ${active ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-card text-foreground hover:bg-accent"}`;

  return (
    <div className="space-y-6">
      <style>{"@media print { @page { size: portrait; margin: 0.5in; } }"}</style>
      <div className="flex flex-col gap-3 border-b border-border pb-5 print:hidden">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> Roadmap</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <ClipboardList className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> Evaluation-Day Roster
        </h1>
        <p className="text-sm text-muted-foreground">
          Printable check-in sheet for {season?.name ?? "the season"}. No ratings are shown. &quot;All ages&quot; prints each age group on its own page.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Age:</span>
          <Link href={link({ age: "all" })} className={pill(age === "all")}>All ages</Link>
          {ages.map((a) => <Link key={a} href={link({ age: String(a) })} className={pill(age === a)}>{a}</Link>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort:</span>
          <Link href={link({ sort: "bib" })} className={pill(sort === "bib")}>Bib number</Link>
          <Link href={link({ sort: "name" })} className={pill(sort === "name")}>Last name, first name</Link>
          <PrintButton />
        </div>
      </div>

      {shownAges.length === 0 && <p className="text-sm text-muted-foreground">No registrations in ages 7–16 for this season.</p>}

      {shownAges.map((a, i) => {
        const list = order(registrations.filter((r) => r.league_age === a));
        return (
          <section key={a} className={`space-y-2 ${i > 0 ? "print:break-before-page" : ""}`}>
            <h2 className="text-lg font-semibold text-foreground print:text-black">
              {season?.name} — Age {a} — Evaluation Check-in ({list.length} players)
            </h2>
            <table className="w-full border-collapse text-sm print:text-[11px] print:text-black">
              <thead>
                <tr className="border-b-2 border-border text-left print:border-black">
                  <th className="w-14 px-2 py-1.5">Bib</th>
                  <th className="px-2 py-1.5">Last name</th>
                  <th className="px-2 py-1.5">First name</th>
                  <th className="w-24 px-2 py-1.5">Birthdate</th>
                  <th className="w-20 px-2 py-1.5 text-center">Check-in</th>
                  <th className="w-[35%] px-2 py-1.5">Notes</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="h-8 border-b border-border print:break-inside-avoid print:border-gray-400">
                    <td className="px-2 font-mono font-semibold">{r.evaluation_number ?? "—"}</td>
                    <td className="px-2">{r.players?.last_name}</td>
                    <td className="px-2">{r.players?.first_name}{r.is_coach_kid && <span className="ml-2"><CoachKidBadge short /></span>}</td>
                    <td className="px-2 font-mono text-xs">{r.players?.date_of_birth ?? "—"}</td>
                    <td className="px-2 text-center"><span className="inline-block h-4 w-4 border border-gray-500" aria-hidden /></td>
                    <td className="px-2" />
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
