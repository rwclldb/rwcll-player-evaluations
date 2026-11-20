import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FlaskConical, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { modeLabel, TEST_DATE_MODES, testToolsEnabled } from "@/lib/test-tools";
import { restoreTestDates, setTestDates } from "./actions";

type SearchParams = Promise<{ season?: string; message?: string; error?: string }>;
type Status = {
  today: string; moved: boolean; mode: string | null; shifted_days: number | null; saved_at: string | null; saved_by: string | null;
  events: { id: number; league_age: number | null; status: string; event_type: string; event_date: string; start_time: string; real_date: string }[];
};

const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
function fromToday(iso: string, today: string) {
  const n = Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
  return n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : n > 0 ? `in ${n} days` : `${-n} days ago`;
}
const STATUS: Record<string, string> = { setup: "Setup", open: "Open", locked: "Locked" };

async function TestDatesContent({ searchParams }: { searchParams: SearchParams }) {
  if (!testToolsEnabled()) notFound();
  const params = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");
  const { data: seasonData } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
  const seasons = (seasonData ?? []).filter((s) => !s.is_closed);
  const season = seasons.find((s) => String(s.id) === params.season) ?? seasons[0];
  const { data, error } = season ? await supabase.rpc("admin_test_dates_status", { p_season_id: season.id }) : { data: null, error: null };
  const st = data as Status | null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> Roadmap</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <FlaskConical className="h-7 w-7 text-amber-600 dark:text-amber-400" /> Test dates
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          For testing only. Moves every evaluation date of a season by the same number of days, so that today is the day you want to try:
          check-in, calling, &quot;Here&quot;, scoring progress and the roadmap then behave as they would on that day. The real dates are saved
          the first time, every button counts from them, and <strong>Put the real dates back</strong> restores them. Shown only because
          ENABLE_TEST_TOOLS is on.
        </p>
        {seasons.length > 1 && (
          <form action="/protected/test-dates" className="flex items-end gap-2">
            <select name="season" defaultValue={season?.id} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Button type="submit" variant="outline" size="sm">Show</Button>
          </form>
        )}
      </div>
      {params.message && (
        <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          {params.message} <Link href="/protected" className="font-medium underline">Open the Roadmap</Link>
        </div>
      )}
      {(params.error || error) && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{params.error ?? error?.message}</div>}
      {!season && <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">There is no open season.</p>}

      {season && st && (
        <>
          <section className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm ${st.moved ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-card"}`}>
            <p>
              {st.moved
                ? <><strong>{season.name}&apos;s dates are moved</strong>: {modeLabel(st.mode)}, {Math.abs(st.shifted_days ?? 0)} day{Math.abs(st.shifted_days ?? 0) === 1 ? "" : "s"} {(st.shifted_days ?? 0) >= 0 ? "later" : "earlier"} than the real dates{st.saved_by ? ` (real dates saved by ${st.saved_by})` : ""}.</>
                : <><strong>{season.name} has its real dates.</strong> Today is {day(st.today)}.</>}
            </p>
            {st.moved && (
              <form action={restoreTestDates}>
                <input type="hidden" name="seasonId" value={season.id} />
                <Button type="submit" variant="outline"><RotateCcw className="mr-1 h-4 w-4" /> Put the real dates back</Button>
              </form>
            )}
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            {TEST_DATE_MODES.map((m) => (
              <form key={m.mode} action={setTestDates} className={`flex flex-col justify-between gap-3 rounded-xl border bg-card p-4 ${st.mode === m.mode ? "border-amber-500/60" : "border-border"}`}>
                <input type="hidden" name="seasonId" value={season.id} />
                <input type="hidden" name="mode" value={m.mode} />
                <p className="text-sm text-muted-foreground">{m.detail}</p>
                <Button type="submit" variant={st.mode === m.mode ? "outline" : "default"} disabled={st.events.length === 0}>{m.label}</Button>
              </form>
            ))}
          </section>
          <p className="text-xs text-muted-foreground">
            Only dates move. Whether an age group is Setup, Open or Locked doesn&apos;t change (use Sessions), and check-ins and calls stay
            with their event, so a player checked in on the old date counts as here on the new one. The roadmap goes by the age groups first:
            once any is locked it shows After evaluations, and once all are released, Teams and draft, whatever the dates.
          </p>

          <section className="space-y-2">
            <h2 className="text-lg font-bold text-foreground">{season.name} dates</h2>
            {st.events.length === 0 ? (
              <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No evaluation dates yet. Add them on <Link href="/protected/sessions" className="underline">Sessions</Link>.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground"><tr>
                    <th className="px-3 py-2">Age</th><th className="px-3 py-2">Event</th><th className="px-3 py-2">Age group</th><th className="px-3 py-2">Date now</th><th className="px-3 py-2">Real date</th>
                  </tr></thead>
                  <tbody>
                    {st.events.map((e) => (
                      <tr key={e.id} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">{e.league_age ?? "All"}</td>
                        <td className="px-3 py-2">{e.event_type === "primary" ? "Main" : "Makeup"} · {e.start_time.slice(0, 5)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{STATUS[e.status] ?? e.status}</td>
                        <td className="px-3 py-2">{day(e.event_date)} <span className="text-xs text-muted-foreground">({fromToday(e.event_date, st.today)})</span></td>
                        <td className={`px-3 py-2 ${e.real_date !== e.event_date ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>{day(e.real_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default function TestDatesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading test dates…</p>}>
      <TestDatesContent searchParams={searchParams} />
    </Suspense>
  );
}
