import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles, runsEvaluationDay } from "@/lib/my-roles";
import { appOrigin } from "@/lib/app-origin";
import { qrSvg } from "@/lib/qr";
import { PrintButton } from "../roster/print-button";

type Group = { session_id: number; league_age: number; events: { type: string; date: string; start: string; location: string }[] };
type SearchParams = Promise<{ season?: string }>;

const time = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

function Code({ svg, title, caption, url, big = false }: { svg: string; title: string; caption?: string; url: string; big?: boolean }) {
  return (
    <figure className={`flex flex-col items-center gap-2 rounded-xl border border-border bg-white p-4 text-center text-black print:break-inside-avoid print:border-black ${big ? "sm:col-span-2 lg:col-span-3" : ""}`}>
      <figcaption className={`font-bold ${big ? "text-2xl" : "text-xl"}`}>{title}</figcaption>
      {/* The SVG is made on the server from the app's own address (lib/qr.ts). */}
      <div className={big ? "w-64 sm:w-72" : "w-44"} dangerouslySetInnerHTML={{ __html: svg }} />
      {caption && <p className="text-sm">{caption}</p>}
      <p className="break-all font-mono text-[10px] text-slate-600">{url}</p>
    </figure>
  );
}

// Printable QR codes: one to open the app, one per age group's scoring list, and the coach quick start.
// Admins and registrars. Scanning while signed out goes to the sign-in page and then on to the scanned page.
async function QrContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const roles = await getMyRoles(supabase);
  if (!runsEvaluationDay(roles)) redirect("/protected");
  let season = roles.registrarSeason;
  if (roles.isAdmin) {
    const { data } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
    const pick = (data ?? []).find((s) => String(s.id) === sp.season) ?? (data ?? []).find((s) => !s.is_closed) ?? data?.[0];
    season = pick ? { id: pick.id as number, name: pick.name as string } : null;
  }
  if (!season) redirect("/protected");

  const origin = await appOrigin();
  const { data } = await supabase.rpc("registrar_timetable", { p_season_id: season.id });
  const groups = (data ?? []) as Group[];
  const appUrl = `${origin}/protected`;
  const guideUrl = `${origin}/protected/help/coach`;
  const [appSvg, guideSvg, groupSvgs] = await Promise.all([
    qrSvg(appUrl), qrSvg(guideUrl),
    Promise.all(groups.map((g) => qrSvg(`${origin}/protected/evaluations?sessionId=${g.session_id}`))),
  ]);
  const local = /\/\/(localhost|127\.)/.test(origin);

  return (
    <div className="space-y-5">
      <style>{"@media print { @page { size: portrait; margin: 0.5in; } }"}</style>
      <div className="flex flex-col gap-3 border-b border-border pb-5 print:hidden">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> {roles.isAdmin ? "Roadmap" : "Home"}</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground sm:text-3xl">
          <QrCode className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> QR Codes
        </h1>
        <p className="text-sm text-muted-foreground">
          Print these for coaches and evaluators. A phone camera opens the link; anyone not signed in signs in first and then lands on
          that page. The age-group codes open that age group&apos;s scoring list (only people assigned to it can score).
        </p>
        {local && (
          <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
            These codes point at this computer ({origin}), so phones can&apos;t open them. Print them from the hosted site instead.
          </p>
        )}
        <div className="flex items-center gap-2"><span className="text-sm text-muted-foreground">{season.name}</span><PrintButton /></div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2">
        <Code big svg={appSvg} title="Scan to open RWCLL Evaluations" caption="Sign in with the email the league invited." url={appUrl} />
        <Code svg={guideSvg} title="Coach quick start" caption="How to score, notes, no signal, draft reports." url={guideUrl} />
        {groups.map((g, i) => {
          const main = g.events.find((e) => e.type === "primary");
          return (
            <Code key={g.session_id} svg={groupSvgs[i]} title={`Age ${g.league_age} scoring`}
              caption={main ? `${day(main.date)}, ${time(main.start)} · ${main.location}` : undefined}
              url={`${origin}/protected/evaluations?sessionId=${g.session_id}`} />
          );
        })}
      </div>
    </div>
  );
}

export default function QrPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <QrContent searchParams={searchParams} />
    </Suspense>
  );
}
