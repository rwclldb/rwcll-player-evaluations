import Link from "next/link";
import { ArrowRight, CalendarDays, Clock, MapPin } from "lucide-react";
import { daysBetween, formatDate, formatTime, leagueToday } from "@/lib/roadmap";

export type ScheduleRow = {
  season_id: number;
  season_name: string;
  role_name: "coach" | "independent_evaluator";
  session_id: number;
  league_age: number;
  assigned: boolean;
  session_status: "setup" | "open" | "locked";
  released: boolean;
  events: { type: "primary" | "makeup"; date: string; start: string | null; end: string | null; location: string | null }[];
};

const timeRange = (e: ScheduleRow["events"][number]) =>
  [formatTime(e.start), formatTime(e.end)].filter(Boolean).join(" – ");

function stageOf(r: ScheduleRow) {
  if (r.released) return { label: "Report released", cls: "bg-sky-500/15 text-sky-800 dark:text-sky-300", href: `/protected/draft-reports?sessionId=${r.session_id}`, action: "Draft report" };
  if (r.session_status === "locked") return { label: "Scoring closed", cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300" };
  if (r.session_status === "open") return { label: "Scoring open", cls: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300", href: `/protected/evaluations?sessionId=${r.session_id}`, action: "Score" };
  return { label: "Not open yet", cls: "bg-slate-500/15 text-slate-700 dark:text-slate-300" };
}

export function MySchedule({ rows }: { rows: ScheduleRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-lg font-bold text-foreground">Your evaluations</h2>
        <p className="mt-1 text-sm text-muted-foreground">You don&apos;t have a role this season yet. A league admin will add you.</p>
      </section>
    );
  }

  const season = rows[0].season_name;
  const seasonRows = rows.filter((r) => r.season_id === rows[0].season_id);
  const role = seasonRows[0].role_name;
  const mine = seasonRows.filter((r) => r.assigned);
  const shown = mine.length > 0 ? mine : role === "coach" ? [] : seasonRows;
  const primaryDates = [...new Set(seasonRows.flatMap((r) => r.events.filter((e) => e.type === "primary").map((e) => e.date)))].sort();
  const today = leagueToday();
  const days = primaryDates[0] ? daysBetween(today, primaryDates[0]) : null;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="bg-gradient-to-br from-emerald-600 to-sky-700 p-5 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/75">{season} · {role === "coach" ? "Coach" : "Independent evaluator"}</p>
        {primaryDates.length > 0 ? (
          <>
            <h2 className="mt-1 flex items-center gap-2 text-2xl font-black">
              <CalendarDays className="h-6 w-6" />
              {primaryDates.map((d) => formatDate(d, { weekday: "long", month: "long", day: "numeric" })).join(" & ")}
            </h2>
            {days !== null && days > 0 && <p className="mt-1 text-sm text-white/90">Evaluation day is in {days} day{days === 1 ? "" : "s"}.</p>}
            {days === 0 && <p className="mt-1 text-sm font-semibold">Evaluation day is today!</p>}
          </>
        ) : (
          <h2 className="mt-1 text-2xl font-black">Evaluation day not scheduled yet</h2>
        )}
      </div>

      <div className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-foreground">
          {mine.length > 0 ? "Your age groups" : role === "coach" ? "You haven't been assigned an age group yet" : "Age groups"}
        </h3>
        {shown.length > 0 && (
          <ul className="space-y-2">
            {shown.map((r) => {
              const st = stageOf(r);
              const primary = r.events.filter((e) => e.type === "primary");
              const makeups = r.events.filter((e) => e.type === "makeup");
              return (
                <li key={r.session_id} className="flex items-start gap-3 rounded-xl border border-border bg-background p-3">
                  <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-emerald-600 text-white">
                    <span className="text-[9px] font-bold uppercase leading-none opacity-80">Age</span>
                    <span className="text-lg font-black leading-none">{r.league_age}</span>
                  </span>
                  <div className="min-w-0 flex-1 text-sm">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                    {primary.map((e, i) => (
                      <p key={i} className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-foreground">
                        <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-muted-foreground" />{primaryDates.length > 1 ? `${formatDate(e.date)} ` : ""}{timeRange(e)}</span>
                        {e.location && <span className="flex items-center gap-1 text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{e.location}</span>}
                      </p>
                    ))}
                    {primary.length === 0 && <p className="mt-1 text-muted-foreground">Time not set yet</p>}
                    {makeups.length > 0 && (
                      <p className="mt-0.5 text-xs text-muted-foreground">Makeup: {makeups.map((e) => `${formatDate(e.date)} ${timeRange(e)}`).join(", ")}</p>
                    )}
                  </div>
                  {st.href && (
                    <Link href={st.href} className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-500">
                      {st.action} <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {role === "coach" && (
          <p className="text-xs text-muted-foreground">As a coach you can score players in any age group, not just the ones listed here.</p>
        )}
      </div>
    </section>
  );
}
