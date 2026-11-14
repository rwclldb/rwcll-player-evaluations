import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Award, ClipboardList, NotebookPen, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { leagueToday, STAGES, type RoadmapData, type StageKey } from "@/lib/roadmap";
import { AdminRoadmap, Seasons } from "./admin-roadmap";
import { MySchedule, type ScheduleRow } from "./my-schedule";

type SearchParams = Promise<{ season?: string; stage?: string }>;

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
    const roadmap = data as RoadmapData;
    const viewing = (STAGES.some((s) => s.key === sp.stage) ? sp.stage : roadmap.stage) as StageKey;
    return <AdminRoadmap data={roadmap} viewing={viewing} seasons={seasons} />;
  }

  const [{ data: schedule }, { data: account }] = await Promise.all([supabase.rpc("my_evaluation_schedule"), supabase.rpc("my_account")]);
  const name = (account as { display_name: string | null } | null)?.display_name || user.email;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">Welcome, <span className="font-medium text-foreground">{name}</span></p>
      <MySchedule rows={(schedule ?? []) as ScheduleRow[]} />
      <div className="grid gap-3 sm:grid-cols-3">
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
      </div>
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
