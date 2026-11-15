import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "../roster/print-button";

type Gap = {
  session_id: number; league_age: number; player_season_id: number; first_name: string; last_name: string;
  evaluation_number: number | null; gap: "called_not_scored" | "here_not_called" | "not_here"; missing_scorers: string[] | null;
};
type SearchParams = Promise<{ season?: string }>;

const KINDS: { key: Gap["gap"]; title: string; text: string }[] = [
  { key: "called_not_scored", title: "Called, but a score is missing",
    text: "The announcer called these players, but a coach or evaluator assigned to the age group has no saved score (or Not Evaluated) for them. Ask the scorer to finish, before the age group is locked." },
  { key: "here_not_called", title: "Checked in, never called",
    text: "These players came but were never called up. They may have been missed: check with the announcer and scorers. If they weren't seen, they're on the makeup day's lists automatically." },
  { key: "not_here", title: "Never checked in",
    text: "The age group's evaluation day has passed and these players never came (exempt players aren't listed). They're on the makeup day's check-in and calling lists." },
];

// End-of-day check (admins): who may have been missed, from check-in, the announcer's calls and the scores.
async function EndOfDayContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");

  const { data: seasonData } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
  const seasons = seasonData ?? [];
  const season = seasons.find((s) => String(s.id) === sp.season) ?? seasons.find((s) => !s.is_closed) ?? seasons[0];
  const { data, error } = season ? await supabase.rpc("admin_call_gaps", { p_season_id: season.id }) : { data: [], error: null };
  const gaps = (data ?? []) as Gap[];
  const ages = [...new Set(gaps.map((g) => g.league_age))].sort((a, b) => a - b);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-col gap-3 border-b border-border pb-5 print:hidden">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> Roadmap</Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground sm:text-3xl">
            <ClipboardList className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> End-of-day check
          </h1>
          <PrintButton />
        </div>
        <p className="text-sm text-muted-foreground">
          Players who may have been missed, from check-in, the announcer&apos;s calls and the scores. Use it at the end of each
          evaluation day, and before locking an age group. Lists only appear where check-in or calling was used.
        </p>
        {seasons.length > 1 && (
          <form className="flex items-end gap-2">
            <label className="text-xs text-muted-foreground">Season
              <select name="season" defaultValue={season?.id} className="mt-1 block h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_closed ? " (closed)" : ""}</option>)}
              </select>
            </label>
            <Button type="submit" variant="outline" className="h-10">Show</Button>
          </form>
        )}
      </div>
      <h1 className="hidden text-xl font-bold print:block">{season?.name}: End-of-day check</h1>

      {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">Could not load the check: {error.message}</p>}
      {!error && gaps.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing to follow up: everyone checked in was called, and everyone called has all their scores.
        </p>
      )}
      <div className="grid grid-cols-3 gap-3 print:hidden">
        {KINDS.map((k) => (
          <div key={k.key} className="rounded-xl border border-border bg-card p-3">
            <p className="text-2xl font-bold text-foreground">{gaps.filter((g) => g.gap === k.key).length}</p>
            <p className="text-xs text-muted-foreground">{k.title}</p>
          </div>
        ))}
      </div>

      {ages.map((age) => (
        <section key={age} className="space-y-3 rounded-xl border border-border bg-card p-4 print:break-inside-avoid print:border-0 print:p-0">
          <h2 className="text-lg font-bold text-foreground">Age {age}</h2>
          {KINDS.map((k) => {
            const rows = gaps.filter((g) => g.league_age === age && g.gap === k.key);
            if (!rows.length) return null;
            return (
              <div key={k.key} className="space-y-1.5">
                <h3 className="text-sm font-semibold text-foreground">{k.title} ({rows.length})</h3>
                <p className="text-xs text-muted-foreground print:hidden">{k.text}</p>
                <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                  {rows.map((g) => (
                    <li key={g.player_season_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <span className="w-12 font-mono font-bold text-foreground">{g.evaluation_number ?? "—"}</span>
                      <Link href={`/protected/players/${g.player_season_id}`} className="font-medium text-foreground hover:underline">{g.last_name}, {g.first_name}</Link>
                      {g.missing_scorers && <span className="text-xs text-amber-800 dark:text-amber-300">Missing: {g.missing_scorers.join(", ")}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

export default function EndOfDayPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <EndOfDayContent searchParams={searchParams} />
    </Suspense>
  );
}
