import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/my-roles";
import { PrintButton } from "../roster/print-button";

type Event = { type: "primary" | "makeup"; date: string; start: string; end: string; location: string; notes: string | null };
type Group = { session_id: number; league_age: number; status: string; events: Event[]; coaches: string[]; evaluators: string[] };
type SearchParams = Promise<{ view?: string; season?: string }>;

const time = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? " AM" : " PM"}`;
};
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const when = (e: Event) => `${day(e.date)}, ${time(e.start)}–${time(e.end)}`;

// Who scores which age group, and when. For registrars (to hand out) and admins. Names only; no scores.
async function TimetableContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const roles = await getMyRoles(supabase);
  let season = roles.registrarSeason;
  if (roles.isAdmin) {
    const { data } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
    const pick = (data ?? []).find((s) => String(s.id) === sp.season) ?? (data ?? []).find((s) => !s.is_closed) ?? data?.[0];
    season = pick ? { id: pick.id as number, name: pick.name as string } : null;
  }
  if (!season) redirect("/protected");
  const view = sp.view === "people" ? "people" : "ages";

  const { data } = await supabase.rpc("registrar_timetable", { p_season_id: season.id });
  const groups = (data ?? []) as Group[];

  // By person: each coach or evaluator with the age groups they score.
  const people = new Map<string, { role: "Coach" | "Evaluator"; groups: Group[] }>();
  for (const g of groups) {
    for (const [names, role] of [[g.coaches, "Coach"], [g.evaluators, "Evaluator"]] as const) {
      for (const n of names) {
        const key = `${n}|${role}`;
        people.set(key, { role, groups: [...(people.get(key)?.groups ?? []), g] });
      }
    }
  }
  const byPerson = [...people.entries()].sort(([a], [b]) => a.localeCompare(b));
  const pill = (active: boolean) => `rounded-md border px-3 py-1.5 text-sm ${active ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-card text-foreground hover:bg-accent"}`;
  const link = (v: string) => `/protected/timetable?view=${v}${roles.isAdmin ? `&season=${season.id}` : ""}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-b border-border pb-5 print:hidden">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> {roles.isAdmin ? "Roadmap" : "Home"}</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <CalendarClock className="h-6 w-6 text-emerald-700 dark:text-emerald-400" /> Who scores when
        </h1>
        <p className="text-sm text-muted-foreground">
          {season.name}: each age group&apos;s time and place, and the coaches and independent evaluators scoring it. Coaches may also score other age groups.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={link("ages")} className={pill(view === "ages")}>By age group</Link>
          <Link href={link("people")} className={pill(view === "people")}>By person</Link>
          <PrintButton />
        </div>
      </div>
      <h2 className="hidden text-lg font-semibold print:block print:text-black">{season.name}: who scores when</h2>

      {groups.length === 0 && <p className="text-sm text-muted-foreground">No age groups are set up yet.</p>}

      {view === "ages" ? (
        <table className="w-full border-collapse text-sm print:text-[11px] print:text-black">
          <thead>
            <tr className="border-b-2 border-border text-left print:border-black">
              <th className="px-2 py-1.5">Age</th>
              <th className="px-2 py-1.5">When and where</th>
              <th className="px-2 py-1.5">Coaches</th>
              <th className="px-2 py-1.5">Independent evaluators</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.session_id} className="border-b border-border align-top print:break-inside-avoid print:border-gray-400">
                <td className="px-2 py-2 text-lg font-bold">{g.league_age}</td>
                <td className="px-2 py-2">
                  {g.events.length === 0 ? <span className="text-muted-foreground">Not scheduled</span> : g.events.map((e, i) => (
                    <span key={i} className="block">
                      <span className="font-medium">{e.type === "primary" ? "" : "Makeup: "}{when(e)}</span>
                      <span className="text-muted-foreground print:text-black"> · {e.location}</span>
                    </span>
                  ))}
                </td>
                <td className="px-2 py-2">{g.coaches.length ? g.coaches.join(", ") : <span className="text-muted-foreground">None assigned</span>}</td>
                <td className="px-2 py-2">{g.evaluators.length ? g.evaluators.join(", ") : <span className="text-muted-foreground">None assigned</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 print:grid-cols-2 print:gap-2">
          {byPerson.map(([key, p]) => (
            <li key={key} className="rounded-lg border border-border bg-card p-3 print:break-inside-avoid print:border-gray-400 print:bg-white print:text-black">
              <p className="font-semibold text-foreground print:text-black">{key.split("|")[0]} <span className="text-xs font-normal text-muted-foreground">{p.role}</span></p>
              <ul className="mt-1 space-y-0.5 text-sm">
                {p.groups.map((g) => {
                  const main = g.events.find((e) => e.type === "primary");
                  return <li key={g.session_id}>Age {g.league_age}: {main ? `${when(main)} · ${main.location}` : "not scheduled"}</li>;
                })}
              </ul>
            </li>
          ))}
          {byPerson.length === 0 && <li className="text-sm text-muted-foreground">No one is assigned yet.</li>}
        </ul>
      )}
    </div>
  );
}

export default function TimetablePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <TimetableContent searchParams={searchParams} />
    </Suspense>
  );
}
