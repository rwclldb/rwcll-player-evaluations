import Link from "next/link";
import { ArrowLeft, Award } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { DraftReportTable, type DraftReportRow, type ReportNote } from "./draft-report-table";

type ReportSession = {
  session_id: number;
  season_id: number;
  season_name: string;
  league_age: number;
  status: string;
  released: boolean;
};

export default async function DraftReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string; message?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  const administrator = isAdmin === true;

  // The database decides which age groups this person may open (admins: all; coaches: released only).
  const { data: sessionData, error: sessionError } = await supabase.rpc("draft_report_sessions");
  const sessions = (sessionData ?? []) as ReportSession[];
  const seasonId = sessions.find((s) => String(s.session_id) === params.sessionId)?.season_id ?? sessions[0]?.season_id;
  const seasonSessions = sessions.filter((s) => s.season_id === seasonId);
  const selected = seasonSessions.find((s) => String(s.session_id) === params.sessionId) ?? seasonSessions[0];

  let rows: DraftReportRow[] = [];
  let notes: ReportNote[] = [];
  let reportError: string | null = null;
  if (selected) {
    const [report, noteResult] = await Promise.all([
      supabase.rpc("draft_report", { p_session_id: selected.session_id }),
      supabase.rpc("player_notes", { p_session_id: selected.session_id }),
    ]);
    if (report.error) reportError = report.error.message;
    rows = (report.data ?? []) as DraftReportRow[];
    notes = (noteResult.data ?? []) as ReportNote[];
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5 print:hidden">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> Back to workspace</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <Award className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> Draft Reports
        </h1>
        <p className="text-sm text-muted-foreground">
          Coach and independent-evaluator averages are kept separate. Each overall is the average of the 5 core skills that were rated; blanks are never counted as zero. Only submitted evaluations count.
        </p>
      </div>

      {sessionError && (
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">
          Could not load age groups: {sessionError.message}
        </div>
      )}

      {params.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300 print:hidden">{params.message}</div>}
      {params.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300 print:hidden">{params.error}</div>}

      {!sessionError && sessions.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {administrator
            ? "No age-group sessions exist yet. Create them on the Sessions page."
            : "No draft reports have been released yet. An administrator releases each age group after evaluations are locked."}
        </div>
      )}

      {selected && (
        <>
          <nav aria-label="Age groups" className="flex flex-wrap gap-2 print:hidden">
            {seasonSessions.map((s) => (
              <Link
                key={s.session_id}
                href={`/protected/draft-reports?sessionId=${s.session_id}`}
                aria-current={s.session_id === selected.session_id ? "page" : undefined}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                  s.session_id === selected.session_id
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-border bg-card text-foreground hover:bg-accent"
                }`}
              >
                Age {s.league_age}
                {administrator && !s.released && <span className="ml-1 text-[10px] opacity-75">(not released)</span>}
              </Link>
            ))}
          </nav>

          {administrator && !selected.released && (
            <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200 print:hidden">
              Coaches cannot see this age group yet ({selected.status === "locked" ? "locked, not released" : `session is ${selected.status}`}). Release it on the{" "}
              <Link href="/protected/sessions" className="underline">Sessions page</Link> when you are ready.
            </div>
          )}

          {reportError ? (
            <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">{reportError}</div>
          ) : (
            <DraftReportTable
              rows={rows}
              title={`${selected.season_name} — Age ${selected.league_age} Draft Report`}
              fileName={`draft-report-${selected.season_name.replace(/\s+/g, "-").toLowerCase()}-age-${selected.league_age}.csv`}
              administrator={administrator}
              notes={notes}
              canWritePrivate={!administrator}
              returnTo={`/protected/draft-reports?sessionId=${selected.session_id}`}
            />
          )}
        </>
      )}
    </div>
  );
}
