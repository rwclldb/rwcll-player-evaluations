import Link from "next/link";
import { CalendarClock, ClipboardCheck, Printer, UserPlus, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { leagueToday } from "@/lib/roadmap";

type Day = { event_date: string; has_primary: boolean; has_makeup: boolean; age_groups: number[] };

const CARDS: { href: string; title: string; text: string; icon: LucideIcon }[] = [
  { href: "/protected/players/new", title: "Add a walk-up", text: "A child who shows up but isn't registered yet.", icon: UserPlus },
  { href: "/protected/roster?age=all", title: "Print rosters", text: "One page per age group, with Check-in and Notes columns.", icon: Printer },
  { href: "/protected/timetable", title: "Who scores when", text: "Each age group's time, place, coaches and evaluators.", icon: CalendarClock },
];

export const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

// Home page for registrars (and a section of it for registrars who also coach or evaluate).
export async function EvaluationDayHub({ season }: { season: { id: number; name: string } }) {
  const supabase = await createClient();
  const today = leagueToday();
  const { data } = await supabase.rpc("checkin_days", { p_season_id: season.id });
  const days = (data ?? []) as Day[];
  const next = days.find((d) => d.event_date >= today);
  let progress: { here: number; total: number } | null = null;
  if (next?.event_date === today) {
    const { data: list } = await supabase.rpc("checkin_list", { p_season_id: season.id, p_date: today });
    const rows = (list ?? []) as { checked_in_at: string | null }[];
    progress = { here: rows.filter((r) => r.checked_in_at).length, total: rows.length };
  }

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">{season.name} · Registrar</p>
        <h1 className="text-2xl font-bold text-foreground">Evaluation Day</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {!next ? "No evaluation days are scheduled yet."
            : next.event_date === today ? `Today: ${next.has_primary ? "evaluations" : "makeups"} for ages ${next.age_groups.join(", ")}.`
            : `Next: ${longDate(next.event_date)} (${next.has_primary ? "evaluations" : "makeups"}, ages ${next.age_groups.join(", ")}).`}
        </p>
      </div>
      <Link href="/protected/check-in"
        className="group flex items-center gap-4 rounded-2xl bg-emerald-600 p-5 text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-emerald-500 hover:shadow-md">
        <ClipboardCheck className="h-10 w-10 shrink-0" />
        <span className="min-w-0">
          <span className="block text-xl font-bold">Check players in</span>
          <span className="block text-sm text-white/85">
            {progress ? `${progress.here} of ${progress.total} here so far` : "Find a player by name or bib and tap to check them in."}
          </span>
        </span>
      </Link>
      <div className="grid gap-3 sm:grid-cols-3">
        {CARDS.map(({ href, title, text, icon: Icon }) => (
          <Link key={href} href={href}
            className="group rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-emerald-500/50 hover:shadow-md">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 transition-colors group-hover:bg-emerald-600 group-hover:text-white dark:text-emerald-400">
              <Icon className="h-5 w-5" />
            </span>
            <h2 className="mt-3 font-semibold text-foreground">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
