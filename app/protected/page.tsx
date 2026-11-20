import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Award, ClipboardList, NotebookPen, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { leagueToday, STAGES, suggestedStage, teamsSummary, type RoadmapData, type StageKey } from "@/lib/roadmap";
import { AdminRoadmap, Seasons } from "./admin-roadmap";
import type { PendingPerson } from "./pending-signins";
import { MySchedule, type ScheduleRow } from "./my-schedule";
import { AnnouncerHub, EvaluationDayHub } from "./evaluation-day-hub";
import { getMyRoles } from "@/lib/my-roles";

type SearchParams = Promise<{ season?: string; stage?: string; message?: string; error?: string }>;

const SHORTCUTS: { href: string; title: string; text: string; icon: LucideIcon }[] = [
  { href: "/protected/evaluations", title: "Score players", text: "Pick an age group, find a bib, and enter ratings.", icon: ClipboardList },
  { href: "/protected/draft-reports", title: "Draft reports", text: "Averages by age group, once an admin releases them.", icon: Award },
  { href: "/protected/my-notes", title: "My notes", text: "Everything you've written about players this season.", icon: NotebookPen },
];

async function HomeContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect("/auth/login");

  const { data: isAdmin } = await supabase.rpc("is_admin");

  if (isAdmin === true) {
    const { data: seasonData } = await supabase.from("seasons").select("id, name, start_date, end_date, is_closed")
      .order("start_date", { ascending: false, nullsFirst: false });
    const seasons = seasonData ?? [];
    const season = seasons.find((s) => String(s.id) === sp.season) ?? seasons.find((s) => !s.is_closed) ?? seasons[0];
    if (!season) {
      return (
        <div className="space-y-4">
          <h1 className="text-2xl font-bold text-foreground">Welcome! Start by creating a season.</h1>
          <Seasons seasons={[]} />
        </div>
      );
    }
    const { data, error } = await supabase.rpc("admin_season_roadmap", { p_season_id: season.id, p_today: leagueToday() });
    if (error || !data) {
      return <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">Could not load the roadmap: {error?.message ?? "no data"}</p>;
    }
    const [{ data: duplicates }, { data: teamSetup }, { data: families }, { data: drafts }, { data: rosters }, { data: chart }, { data: chartMismatches }] = await Promise.all([
      supabase.rpc("admin_possible_duplicate_count"),
      supabase.rpc("team_setup", { p_season_id: season.id }),
      supabase.rpc("family_overview", { p_season_id: season.id }),
      supabase.rpc("drafts_overview", { p_season_id: season.id }),
      supabase.rpc("season_rosters", { p_season_id: season.id }),
      supabase.rpc("season_age_chart", { p_season_id: season.id }),
      supabase.rpc("age_chart_mismatches", { p_season_id: season.id }),
    ]);
    const base = data as RoadmapData;
    const roadmap: RoadmapData = { ...base, stage: suggestedStage(base), duplicates: Number(duplicates ?? 0), teams: teamsSummary(teamSetup, families, drafts, rosters),
      ageChart: { rows: ((chart as { rows?: unknown[] } | null)?.rows ?? []).length, mismatches: (chartMismatches ?? []).length } };
    const viewing = (STAGES.some((s) => s.key === sp.stage) ? sp.stage : roadmap.stage) as StageKey;
    const { data: pending } = await supabase.rpc("admin_people_not_signed_in", { p_season_id: season.id });
    return (
      <>
        {sp.message && <div role="status" className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{sp.message}</div>}
        {sp.error && <div role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{sp.error}</div>}
        <AdminRoadmap data={roadmap} viewing={viewing} seasons={seasons} pending={(pending ?? []) as PendingPerson[]} seasonId={season.id} />
      </>
    );
  }

  const [{ data: schedule }, { data: account }, roles, { data: draftRows }] = await Promise.all([
    supabase.rpc("my_evaluation_schedule"), supabase.rpc("my_account"), getMyRoles(supabase), supabase.rpc("my_drafts"),
  ]);
  const { data: myTeamRows } = await supabase.rpc("my_team_rosters");
  const myTeams = (myTeamRows ?? []) as { team_id: number; team: string; division: string; players: unknown[] }[];
  // Drafts this person watches or runs (managers and coaches of the division; registrars), once set up.
  const drafts = (draftRows ?? []) as { draft_id: number; season_division_id: number; division: string; status: string }[];
  const name = (account as { display_name: string | null } | null)?.display_name || user.email;
  // Registrars get the Evaluation Day hub, announcers the calling card; coaches and evaluators get their schedule
  // and shortcuts (some people are several).
  const scores = roles.scores || (!roles.registrarSeason && !roles.announcerSeason);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">Welcome, <span className="font-medium text-foreground">{name}</span></p>
      {myTeams.length > 0 && (
        <section className="rounded-2xl border border-emerald-500/40 bg-card p-4">
          <h2 className="font-bold text-foreground">Your team{myTeams.length === 1 ? "" : "s"}</h2>
          <ul className="mt-2 space-y-2">
            {myTeams.map((t) => (
              <li key={t.team_id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm"><strong>{t.team}</strong> <span className="text-muted-foreground">· {t.division} · {t.players.length} {t.players.length === 1 ? "player" : "players"}</span></span>
                <Link href="/protected/my-team" className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">See the roster</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {drafts.length > 0 && (
        <section className="rounded-2xl border border-emerald-500/40 bg-card p-4">
          <h2 className="font-bold text-foreground">Draft{drafts.length === 1 ? "" : "s"}</h2>
          <ul className="mt-2 space-y-2">
            {drafts.map((d) => (
              <li key={d.draft_id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm"><strong>{d.division}</strong> <span className="text-muted-foreground">{d.status === "live" ? "· happening now" : d.status === "paused" ? "· paused" : d.status === "done" ? "· finished" : "· not started yet"}</span></span>
                <Link href={`/protected/drafts/${d.season_division_id}/room`} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">{d.status === "live" || d.status === "paused" ? "Watch the draft" : "Draft room"}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {roles.registrarSeason && <EvaluationDayHub season={roles.registrarSeason} />}
      {roles.announcerSeason && !roles.registrarSeason && <AnnouncerHub season={roles.announcerSeason} />}
      {scores && <MySchedule rows={(schedule ?? []) as ScheduleRow[]} />}
      {scores && <div className="grid gap-3 sm:grid-cols-3">
        {SHORTCUTS.map(({ href, title, text, icon: Icon }) => (
          <Link key={href} href={href}
            className="group rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-emerald-500/50 hover:shadow-md">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 transition-colors group-hover:bg-emerald-600 group-hover:text-white dark:text-emerald-400">
              <Icon className="h-5 w-5" />
            </span>
            <h2 className="mt-3 font-semibold text-foreground">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>
          </Link>
        ))}
      </div>}
    </div>
  );
}

export default function ProtectedPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <HomeContent searchParams={searchParams} />
    </Suspense>
  );
}
