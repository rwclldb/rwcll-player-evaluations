import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/my-roles";
import { leagueToday } from "@/lib/roadmap";
import { longDate } from "../evaluation-day-hub";
import { CheckInList, type CheckInRow } from "./check-in-list";

type Day = { event_date: string; has_primary: boolean; has_makeup: boolean; age_groups: number[] };
type SearchParams = Promise<{ date?: string; season?: string; message?: string }>;

// Evaluation-day check-in (registrars and admins): pick the day, find a player by name or bib, tap to check in.
async function CheckInContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const roles = await getMyRoles(supabase);
  let season = roles.registrarSeason;
  if (roles.isAdmin) {
    const { data } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
    const all = data ?? [];
    const pick = all.find((s) => String(s.id) === sp.season) ?? all.find((s) => !s.is_closed) ?? all[0];
    season = pick ? { id: pick.id as number, name: pick.name as string } : null;
  }
  if (!season) redirect("/protected");

  const { data: dayData } = await supabase.rpc("checkin_days", { p_season_id: season.id });
  const days = (dayData ?? []) as Day[];
  const today = leagueToday();
  const date = days.find((d) => d.event_date === sp.date)?.event_date
    ?? days.find((d) => d.event_date >= today)?.event_date ?? days.at(-1)?.event_date;
  const day = days.find((d) => d.event_date === date);
  const { data: list } = date ? await supabase.rpc("checkin_list", { p_season_id: season.id, p_date: date }) : { data: [] };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> {roles.isAdmin ? "Roadmap" : "Home"}</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <ClipboardCheck className="h-6 w-6 text-emerald-700 dark:text-emerald-400" /> Check-in
        </h1>
        <p className="text-sm text-muted-foreground">
          {season.name}. Tap a player to check them in; tap again to undo. Players without a bib show &quot;+ Bib&quot;.
          Not on the list? <Link href="/protected/players/new" className="font-medium text-foreground underline">Add a walk-up</Link>.
        </p>
      </div>

      {sp.message && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{sp.message}</p>}

      {days.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">No evaluation days are scheduled for {season.name} yet.</p>
      ) : (
        <nav aria-label="Evaluation day" className="flex flex-wrap gap-2">
          {days.map((d) => (
            <Link key={d.event_date} href={`/protected/check-in?date=${d.event_date}${roles.isAdmin ? `&season=${season.id}` : ""}`}
              aria-current={d.event_date === date ? "page" : undefined}
              className={`rounded-lg border px-3 py-2 text-sm ${d.event_date === date ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-card text-foreground hover:bg-accent"}`}>
              <span className="block font-semibold">{longDate(d.event_date)}{d.event_date === today ? " (today)" : ""}</span>
              <span className="block text-xs opacity-80">{d.has_primary ? "Evaluations" : "Makeups"} · ages {d.age_groups.join(", ")}</span>
            </Link>
          ))}
        </nav>
      )}

      {date && <CheckInList key={date} rows={(list ?? []) as CheckInRow[]} isMakeup={Boolean(day && !day.has_primary)} />}
    </div>
  );
}

export default function CheckInPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <CheckInContent searchParams={searchParams} />
    </Suspense>
  );
}
