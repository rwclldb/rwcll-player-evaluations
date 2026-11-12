import Link from "next/link";
import {
  Activity, AlertTriangle, Archive, ArrowRight, CalendarClock, CalendarDays, CheckCircle2, Circle, ClipboardList, Clock,
  DoorOpen, Download, Eye, FileSearch, FileWarning, Flag, Hash, History, Info, KeyRound, Layers, LifeBuoy, Lock,
  PartyPopper, PlusCircle, Printer, Search, Send, Shirt, ShieldCheck, Star, Trophy, UploadCloud, UserPlus, Users,
  type LucideIcon,
} from "lucide-react";
import { createSeason } from "@/app/actions";
import {
  STAGES, buildSteps, daysBetween, formatDate, formatTime, readinessProblems, stageIndex, stepProgress,
  type RoadmapData, type RoadmapSession, type StageKey, type Step, type StepStatus,
} from "@/lib/roadmap";

type SeasonItem = { id: number; name: string; start_date: string | null; end_date: string | null; is_closed: boolean };

const STAGE_ICON: Record<StageKey, LucideIcon> = { before: ClipboardList, week: CalendarClock, day: Flag, after: Lock, end: Trophy };
const STEP_ICON: Record<string, LucideIcon> = {
  "age-groups": Layers, registrations: UploadCloud, bibs: Hash, "prior-year": History, people: UserPlus, assignments: Users,
  schedule: CalendarDays, "prior-switch": Eye, readiness: ShieldCheck, open: DoorOpen, signin: KeyRound, rosters: Printer,
  progress: Activity, walkups: UserPlus, help: LifeBuoy, find: Search, drafts: FileWarning, lock: Lock, check: FileSearch,
  release: Send, export: Download, teams: Shirt, rerate: Star, close: Archive, next: PlusCircle,
};

const STATUS: Record<StepStatus, { icon: LucideIcon; badge: string; card: string; dot: string; label: string }> = {
  done: { icon: CheckCircle2, label: "Done", badge: "bg-emerald-500 text-white", dot: "text-emerald-600 dark:text-emerald-400",
    card: "border-emerald-500/30 bg-emerald-500/[0.04]" },
  attention: { icon: AlertTriangle, label: "Needs attention", badge: "bg-amber-500 text-white", dot: "text-amber-600 dark:text-amber-400",
    card: "border-amber-500/50 bg-amber-500/[0.06] shadow-sm shadow-amber-500/10" },
  todo: { icon: Circle, label: "To do", badge: "bg-slate-500/15 text-slate-700 dark:text-slate-300", dot: "text-slate-400",
    card: "border-border bg-card" },
  info: { icon: Info, label: "Tool", badge: "bg-sky-500/15 text-sky-800 dark:text-sky-300", dot: "text-sky-600 dark:text-sky-400",
    card: "border-border bg-card" },
  later: { icon: Clock, label: "Coming later", badge: "bg-slate-500/10 text-muted-foreground", dot: "text-slate-400",
    card: "border-dashed border-border bg-muted/30 opacity-80" },
};

const SESSION_BADGE = (s: RoadmapSession) =>
  s.released ? { label: "Released", cls: "bg-sky-500/15 text-sky-800 dark:text-sky-300" }
  : s.status === "locked" ? { label: "Locked", cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300" }
  : s.status === "open" ? { label: "Open", cls: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" }
  : { label: "Setup", cls: "bg-slate-500/15 text-slate-700 dark:text-slate-300" };

function Countdown({ d }: { d: RoadmapData }) {
  if (!d.first_primary_date) {
    return <div className="text-right text-sm text-white/80">No evaluation day scheduled yet</div>;
  }
  const days = daysBetween(d.today, d.first_primary_date);
  const date = formatDate(d.first_primary_date, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  if (days > 0) {
    return (
      <div className="text-right">
        <div className="text-5xl font-black leading-none tabular-nums">{days}</div>
        <div className="mt-1 text-sm font-medium text-white/90">{days === 1 ? "day" : "days"} until evaluation day</div>
        <div className="text-xs text-white/75">{date}</div>
      </div>
    );
  }
  if (d.last_event_date && d.today <= d.last_event_date) {
    return (
      <div className="text-right">
        <div className="text-3xl font-black">{days === 0 ? "Today's the day!" : "Evaluations under way"}</div>
        <div className="text-xs text-white/75">{date}</div>
      </div>
    );
  }
  return (
    <div className="text-right">
      <div className="text-2xl font-bold">Evaluations complete</div>
      <div className="text-xs text-white/75">Held {date}</div>
    </div>
  );
}

function Stepper({ d, viewing }: { d: RoadmapData; viewing: StageKey }) {
  const current = stageIndex(d.stage);
  return (
    <nav aria-label="Season stages" className="relative">
      <div aria-hidden className="absolute left-[10%] right-[10%] top-8 h-1.5 rounded-full bg-border" />
      <div aria-hidden className="absolute left-[10%] top-8 h-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
        style={{ width: `${(80 * current) / (STAGES.length - 1)}%` }} />
      <ol className="relative grid grid-cols-5 gap-2">
        {STAGES.map((st, i) => {
          const Icon = STAGE_ICON[st.key];
          const state = i < current ? "past" : i === current ? "current" : "future";
          const selected = st.key === viewing;
          const open = state === "past" ? buildSteps(d, st.key).filter((s) => s.status === "attention" || s.status === "todo").length : 0;
          return (
            <li key={st.key} className="flex flex-col items-center text-center">
              <Link href={`/protected?season=${d.season.id}&stage=${st.key}`} aria-current={selected ? "step" : undefined}
                className="group flex flex-col items-center gap-2 rounded-xl px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                <span className="relative flex h-16 w-16 items-center justify-center">
                  {state === "current" && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-emerald-400/30" />}
                  <span className={[
                    "relative flex h-16 w-16 items-center justify-center rounded-full border-4 transition-all group-hover:scale-110",
                    state === "past" ? "border-emerald-500 bg-emerald-500 text-white"
                      : state === "current" ? "border-emerald-500 bg-white text-emerald-600 shadow-lg shadow-emerald-500/30 dark:bg-slate-900 dark:text-emerald-400"
                      : "border-border bg-card text-muted-foreground",
                    selected ? "ring-4 ring-sky-400/60 ring-offset-2 ring-offset-background" : "",
                  ].join(" ")}>
                    {state === "past" ? <CheckCircle2 className="h-8 w-8" /> : <Icon className="h-7 w-7" />}
                  </span>
                  {open > 0 && (
                    <span title={`${open} step${open === 1 ? "" : "s"} still open`}
                      className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-background bg-amber-500 px-1 text-xs font-bold text-white">
                      {open}
                    </span>
                  )}
                </span>
                <span className={`text-sm font-semibold ${selected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}>
                  <span className="mr-1 text-xs font-mono opacity-60">{i + 1}</span>{st.title}
                </span>
                {state === "current" && (
                  <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">You are here</span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepCard({ step, n }: { step: Step; n: number }) {
  const st = STATUS[step.status];
  const StatusIcon = st.icon;
  const Icon = STEP_ICON[step.key] ?? Circle;
  return (
    <li className={`group relative flex items-start gap-4 rounded-xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-md ${st.card}`}>
      <div className="flex flex-col items-center gap-1">
        <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${step.status === "done" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : step.status === "attention" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted text-foreground/70"}`}>
          <Icon className="h-5 w-5" />
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{n}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.badge}`}>
            <StatusIcon className="h-3 w-3" /> {st.label}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
        {step.links.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {step.links.map((l) => (
              <Link key={l.href + l.label} href={l.href}
                className={l.primary
                  ? "inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500"
                  : "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 text-sm font-medium text-foreground transition-colors hover:border-emerald-500/60 hover:bg-accent"}>
                {l.label} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ))}
          </div>
        )}
      </div>
      <StatusIcon aria-hidden className={`hidden h-7 w-7 shrink-0 sm:block ${st.dot} ${step.status === "done" ? "fill-emerald-500/15" : ""}`} />
    </li>
  );
}

function AgeGroups({ d, viewing }: { d: RoadmapData; viewing: StageKey }) {
  const scoring = viewing === "day" || viewing === "after" || viewing === "end";
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <Layers className="h-4 w-4" /> Age groups
        </h2>
        <Link href="/protected/sessions" className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">Sessions →</Link>
      </div>
      {d.sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No age groups yet.</p>
      ) : (
        <ul className="space-y-2">
          {d.sessions.map((s) => {
            const b = SESSION_BADGE(s);
            const problems = readinessProblems(s);
            const pct = s.players > 0 ? Math.round((100 * s.players_scored_by_evaluator) / s.players) : 0;
            return (
              <li key={s.id} className="rounded-lg border border-border bg-background px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white">{s.league_age}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${b.cls}`}>{b.label}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {s.players} players · {s.evaluators} eval · {s.coaches} coach{s.coaches === 1 ? "" : "es"}
                      </span>
                    </div>
                    {scoring ? (
                      <div className="mt-1.5 flex items-center gap-2" title={`${s.players_scored_by_evaluator} of ${s.players} players have an evaluator score`}>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className={`h-full rounded-full ${pct === 100 ? "bg-emerald-500" : "bg-sky-500"}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-9 text-right font-mono text-[11px] text-muted-foreground">{pct}%</span>
                      </div>
                    ) : problems.length > 0 ? (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3 shrink-0" /> {problems.join(", ")}
                      </p>
                    ) : (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> Ready{s.primary_date ? ` · ${formatDate(s.primary_date)} ${formatTime(s.primary_start)}` : ""}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Seasons({ seasons }: { seasons: SeasonItem[] }) {
  return (
    <section id="seasons" className="grid gap-4 rounded-2xl border border-border bg-card p-5 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <Archive className="h-4 w-4" /> Seasons
        </h2>
        <ul className="divide-y divide-border">
          {seasons.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2">
              <Link href={`/protected?season=${s.id}`} className="text-sm font-semibold text-foreground hover:underline">{s.name}</Link>
              <span className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">{s.start_date || "—"} – {s.end_date || "—"}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.is_closed ? "bg-muted text-muted-foreground" : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"}`}>
                  {s.is_closed ? "Closed" : "Active"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <form action={createSeason} className="space-y-2 rounded-xl border border-dashed border-border p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><PlusCircle className="h-4 w-4 text-emerald-600" /> Create a season</h3>
        <input name="name" required placeholder="e.g., Spring 2028" className="block h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">Start<input name="start_date" type="date" className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" /></label>
          <label className="text-xs text-muted-foreground">End<input name="end_date" type="date" className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" /></label>
        </div>
        <button type="submit" className="h-9 w-full rounded-md bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500">Create season</button>
      </form>
    </section>
  );
}

export function AdminRoadmap({ data, viewing, seasons }: { data: RoadmapData; viewing: StageKey; seasons: SeasonItem[] }) {
  const stage = STAGES[stageIndex(viewing)];
  const steps = buildSteps(data, viewing);
  const { done, total } = stepProgress(steps);
  const attention = steps.filter((s) => s.status === "attention").length;
  const pct = total > 0 ? Math.round((100 * done) / total) : 0;
  const StageIcon = STAGE_ICON[viewing];
  const isCurrent = viewing === data.stage;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-sky-800 p-6 text-white shadow-lg">
        <div aria-hidden className="absolute -right-16 -top-16 h-56 w-56 rounded-full border-[18px] border-white/10" />
        <div aria-hidden className="absolute -bottom-20 right-40 h-40 w-40 rounded-full border-[14px] border-white/5" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/70">Admin roadmap</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">{data.season.name}</h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-white/90">
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 font-semibold">Stage {stageIndex(data.stage) + 1} of 5</span>
              {STAGES[stageIndex(data.stage)].title}
            </p>
            {seasons.length > 1 && (
              <form action="/protected" className="mt-3 flex items-center gap-2">
                <select name="season" defaultValue={data.season.id} aria-label="Season"
                  className="h-8 rounded-md border border-white/30 bg-white/10 px-2 text-xs text-white [&>option]:text-slate-900">
                  {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_closed ? " (closed)" : ""}</option>)}
                </select>
                <button type="submit" className="h-8 rounded-md bg-white/20 px-3 text-xs font-semibold hover:bg-white/30">Switch</button>
              </form>
            )}
          </div>
          <Countdown d={data} />
        </div>
      </section>

      <Stepper d={data} viewing={viewing} />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-sky-600 text-white shadow-md">
                <StageIcon className="h-7 w-7" />
              </span>
              <div>
                <h2 className="text-xl font-bold text-foreground">
                  {stage.title}
                  {!isCurrent && <span className="ml-2 align-middle text-xs font-medium text-muted-foreground">(viewing · <Link className="underline" href={`/protected?season=${data.season.id}`}>back to current stage</Link>)</span>}
                </h2>
                <p className="max-w-xl text-sm text-muted-foreground">{stage.blurb}</p>
              </div>
            </div>
            {total > 0 && (
              <div className="w-48">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-semibold text-foreground">{done} of {total} done</span>
                  {attention > 0 && <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{attention} need{attention === 1 ? "s" : ""} attention</span>}
                </div>
                <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
          </div>

          {total > 0 && done === total && (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-800 dark:text-emerald-200">
              <PartyPopper className="h-7 w-7 shrink-0" />
              <p className="text-sm font-semibold">Everything in this stage is done. Nice work!</p>
            </div>
          )}

          <ol className="space-y-3">
            {steps.map((s, i) => <StepCard key={s.key} step={s} n={i + 1} />)}
          </ol>
        </section>

        <aside className="space-y-4">
          <AgeGroups d={data} viewing={viewing} />
          <p className="px-1 text-xs text-muted-foreground">
            Off the map? Every page is in the top menu. The stage is worked out from your data and the evaluation dates; click any stage to look ahead or back.
          </p>
        </aside>
      </div>

      <Seasons seasons={seasons} />
    </div>
  );
}
