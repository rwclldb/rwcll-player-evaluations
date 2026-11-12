import { Fragment, Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createMissingAgeSessions, setDivisionAges, setPriorYearVisibility } from "./actions";
import { SessionActions } from "./SessionActions";
import { SessionEventManager } from "./SessionEventManager";
import { GlobalPrimarySchedule } from "./GlobalPrimarySchedule";
import { GlobalMakeupSchedule } from "./GlobalMakeupSchedule";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Calendar, 
  Plus, 
  ShieldAlert, 
  CheckCircle2, 
  Lock, 
  Layers,
  ArrowLeft
} from "lucide-react";

type DivisionAge = { season_id: number; division_id: number; min_age: number | null; max_age: number | null; name: string; sort_order: number };
const ageRange = (d: DivisionAge) => (d.min_age === null ? "not set" : d.min_age === d.max_age ? `${d.min_age}` : `${d.min_age}–${d.max_age}`);

const LEAGUE_AGES = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7];

type SearchParams = Promise<{
  message?: string;
  error?: string;
}>;

async function SessionsContent({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/auth/login");
  }

  // Verify admin permissions via Supabase RPC function
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
  const administrator = !roleError && isAdmin === true;

  if (!administrator) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
            <Link href="/protected">
              <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Return to workspace
            </Link>
          </Button>
        </div>
        <h1 className="text-2xl font-bold text-foreground">Evaluation Sessions</h1>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-700 dark:text-amber-400 shrink-0" />
          <span>Administrator access is required to manage evaluation sessions.</span>
        </div>
      </div>
    );
  }

  // Fetch all seasons
  const { data: seasons, error: seasonsError } = await supabase
    .from("seasons")
    .select("id, name, start_date, end_date, is_closed, show_prior_year_during_evaluations")
    .order("start_date", { ascending: false });

  // Fetch evaluation sessions matching actual schema
  const { data: sessions, error: sessionsError } = await supabase
    .from("evaluation_sessions")
    .select("id, season_id, league_age, season_division_id, status, published_at, created_at")
    .is("season_division_id", null)
    .order("season_id", { ascending: false })
    .order("league_age", { ascending: false });

  const { data: sessionEvents, error: eventsError } = await supabase
    .from("evaluation_session_events")
    .select("id, evaluation_session_id, event_type, event_date, start_time, end_time, location, notes")
    .order("event_date", { ascending: true })
    .order("start_time", { ascending: true });

  const { data: divisionAgeData } = await supabase
    .from("season_divisions")
    .select("season_id, division_id, min_age, max_age, divisions(name, sort_order)");
  const divisionAges: DivisionAge[] = (divisionAgeData ?? []).map((r) => {
    const d = (Array.isArray(r.divisions) ? r.divisions[0] : r.divisions) as { name: string; sort_order: number } | null;
    return { season_id: r.season_id, division_id: r.division_id, min_age: r.min_age, max_age: r.max_age, name: d?.name ?? "?", sort_order: d?.sort_order ?? 99 };
  }).sort((a, b) => a.sort_order - b.sort_order);

  const { data: evaluatorAssignments, error: assignmentsError } = await supabase
    .from("evaluator_assignments")
    .select("evaluation_session_id");

  // Submitted / draft counts per session, shown in the Lock confirmation. Paged past the API row cap.
  const evaluationCounts = new Map<number, { submitted: number; draft: number }>();
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await supabase
      .from("evaluations")
      .select("evaluation_session_id, status")
      .order("id")
      .range(from, from + 999);
    if (error || !page) break;
    for (const row of page) {
      const c = evaluationCounts.get(row.evaluation_session_id) ?? { submitted: 0, draft: 0 };
      if (row.status === "submitted") c.submitted++;
      if (row.status === "draft") c.draft++;
      evaluationCounts.set(row.evaluation_session_id, c);
    }
    if (page.length < 1000) break;
  }

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
              <Link href="/protected">
                <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Back to workspace
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Calendar className="h-7 w-7 text-emerald-700 dark:text-emerald-400" />
            Evaluation Sessions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage one session per Little League age group (ages 7–16). Sessions start in setup and can be opened or locked.
          </p>
        </div>
      </div>

      {/* Action Messages */}
      {params.message && (
        <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300 font-mono">
          {params.message}
        </div>
      )}

      {params.error && (
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300 font-mono">
          {params.error}
        </div>
      )}

      {(seasonsError || sessionsError || eventsError || assignmentsError) && (
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
          Could not load session data: {seasonsError?.message ?? sessionsError?.message ?? eventsError?.message ?? assignmentsError?.message}
        </div>
      )}

      {!seasonsError && !sessionsError && (seasons ?? []).length === 0 && (
        <Card className="border-border bg-card p-6 text-center text-xs text-muted-foreground">
          No seasons were found. Create a season before setting up evaluation sessions.
        </Card>
      )}

      {/* Seasons Grid */}
      {!seasonsError &&
        !sessionsError &&
        (seasons ?? []).map((season) => {
          const seasonSessions = (sessions ?? []).filter(
            (session) => session.season_id === season.id
          );

          const ageSessions = new Map(
            seasonSessions
              .filter(
                (session) =>
                  session.league_age !== null &&
                  LEAGUE_AGES.includes(session.league_age)
              )
              .map((session) => [session.league_age, session])
          );

          const missingCount = LEAGUE_AGES.filter(
            (age) => !ageSessions.has(age)
          ).length;

          return (
            <Card key={season.id} className="border-border bg-card">
              <CardHeader className="border-b border-border/50 py-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                      <Layers className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                      {season.name}
                    </CardTitle>
                    <CardDescription className="text-xs text-muted-foreground font-mono mt-1">
                      {season.start_date || "No start date"} to {season.end_date || "No end date"} &bull;{" "}
                      <span className={season.is_closed ? "text-muted-foreground" : "text-emerald-700 dark:text-emerald-400 font-semibold"}>
                        {season.is_closed ? "Closed" : "Open Workspace"}
                      </span>
                    </CardDescription>
                    <p className="text-xs text-muted-foreground mt-1 font-mono">
                      {10 - missingCount} of 10 age sessions present
                    </p>
                  </div>

                  {missingCount === 0 ? (
                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-mono py-1.5 px-3 gap-1.5 w-fit">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" /> All Age Sessions Exist
                    </Badge>
                  ) : (
                    <form action={createMissingAgeSessions}>
                      <input type="hidden" name="seasonId" value={season.id} />
                      <Button
                        type="submit"
                        disabled={season.is_closed}
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-500 text-foreground text-xs"
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        Create {missingCount} missing session{missingCount === 1 ? "" : "s"}
                      </Button>
                    </form>
                  )}
                </div>
              </CardHeader>

              {/* Closed seasons start collapsed; open seasons start expanded. */}
              <details open={!season.is_closed} className="group/season">
              <summary className="cursor-pointer list-none border-b border-border/50 px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground marker:hidden">
                <span className="group-open/season:hidden">▸ Show age groups and settings{season.is_closed ? " (closed season)" : ""}</span>
                <span className="hidden group-open/season:inline">▾ Hide age groups and settings</span>
              </summary>
              <CardContent className="p-4">
                {(() => {
                  const ageList = seasonSessions.filter((session) => session.league_age !== null && LEAGUE_AGES.includes(session.league_age));
                  const seasonDivisions = divisionAges.filter((d) => d.season_id === season.id);
                  const primaryCount = ageList.filter((session) => (sessionEvents ?? []).some((event) => event.evaluation_session_id === session.id && event.event_type === "primary")).length;
                  return (
                <details className="mb-4 rounded-lg border border-border bg-background">
                  <summary className="cursor-pointer px-3 py-2 text-xs">
                    <span className="font-semibold text-foreground">Season-wide settings</span>
                    <span className="ml-2 text-muted-foreground">
                      Prior-year ratings while scoring: {season.show_prior_year_during_evaluations ? "Shown" : "Hidden"} · Division ages: {seasonDivisions.map((d) => `${d.name} ${ageRange(d)}`).join(", ") || "none"} · Primary event scheduled for {primaryCount} of {ageList.length} age groups
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-border p-3">
                <form action={setPriorYearVisibility} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <input type="hidden" name="seasonId" value={season.id} />
                  <input type="hidden" name="visible" value={season.show_prior_year_during_evaluations ? "false" : "true"} />
                  <div>
                    <p className="font-semibold text-foreground">
                      Prior-year ratings while scoring:{" "}
                      <span className={season.show_prior_year_during_evaluations ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>
                        {season.show_prior_year_during_evaluations ? "Shown" : "Hidden"}
                      </span>
                    </p>
                    <p className="text-muted-foreground">
                      League board decision. When shown, coaches and evaluators see last season&apos;s coach ratings next to each player while they score. Draft reports always include them.
                    </p>
                  </div>
                  <Button type="submit" size="sm" variant="outline" disabled={season.is_closed} className="shrink-0 text-xs">
                    {season.show_prior_year_during_evaluations ? "Hide while scoring" : "Show while scoring"}
                  </Button>
                </form>
                <form action={setDivisionAges} className="space-y-2 rounded-lg border border-border bg-background p-3 text-xs">
                  <input type="hidden" name="seasonId" value={season.id} />
                  <div>
                    <p className="font-semibold text-foreground">Division ages</p>
                    <p className="text-muted-foreground">
                      Which league ages each division covers. Ranges may overlap. Used to suggest age-group assignments for coaches from their divisions (Assignments page). New seasons copy these.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {seasonDivisions.map((d) => (
                      <fieldset key={d.division_id} className="flex items-center gap-1 rounded-md border border-border px-2 py-1">
                        <legend className="sr-only">{d.name} ages</legend>
                        <span className="w-14 font-semibold text-foreground">{d.name}</span>
                        <input type="number" min={4} max={18} name={`min_${d.division_id}`} defaultValue={d.min_age ?? ""} aria-label={`${d.name} youngest age`} disabled={season.is_closed}
                          className="h-8 w-14 rounded border border-input bg-background px-1 text-center text-sm text-foreground" />
                        <span className="text-muted-foreground">to</span>
                        <input type="number" min={4} max={18} name={`max_${d.division_id}`} defaultValue={d.max_age ?? ""} aria-label={`${d.name} oldest age`} disabled={season.is_closed}
                          className="h-8 w-14 rounded border border-input bg-background px-1 text-center text-sm text-foreground" />
                      </fieldset>
                    ))}
                  </div>
                  <Button type="submit" size="sm" variant="outline" disabled={season.is_closed} className="text-xs">Save division ages</Button>
                </form>
                <GlobalPrimarySchedule
                  seasonId={season.id}
                  seasonName={season.name}
                  seasonClosed={season.is_closed}
                  sessions={seasonSessions.filter((session) => session.league_age !== null && LEAGUE_AGES.includes(session.league_age))}
                  events={(sessionEvents ?? []).filter((event) => seasonSessions.some((session) => session.id === event.evaluation_session_id)).map((event) => ({ evaluation_session_id: event.evaluation_session_id, event_type: event.event_type }))}
                />
                <GlobalMakeupSchedule
                  seasonId={season.id}
                  seasonName={season.name}
                  seasonClosed={season.is_closed}
                  sessions={seasonSessions.filter((session) => session.league_age !== null && LEAGUE_AGES.includes(session.league_age))}
                  events={(sessionEvents ?? []).filter((event) => seasonSessions.some((session) => session.id === event.evaluation_session_id)).map((event) => ({ evaluation_session_id: event.evaluation_session_id, event_type: event.event_type }))}
                />
                  </div>
                </details>
                  );
                })()}
                <details className="rounded-lg border border-border bg-background p-3 text-xs">
                  <summary className="cursor-pointer font-semibold text-foreground">How each age group moves through evaluations</summary>
                  <ol className="mt-2 grid gap-2 sm:grid-cols-4">
                    <li className="rounded border border-border p-2"><strong className="text-amber-700 dark:text-amber-400">1. Setup</strong><br />Schedule events and assign evaluators. Nobody can score yet.</li>
                    <li className="rounded border border-border p-2"><strong className="text-emerald-700 dark:text-emerald-400">2. Open</strong><br />Coaches and evaluators score. Each person sees only their own scores.</li>
                    <li className="rounded border border-border p-2"><strong className="text-slate-700 dark:text-slate-300">3. Locked</strong><br />Scoring stops. Only submitted scores count. Coaches still can&apos;t see reports.</li>
                    <li className="rounded border border-border p-2"><strong className="text-sky-700 dark:text-sky-300">4. Released</strong><br />Coaches can see this age group&apos;s draft report.</li>
                  </ol>
                  <p className="mt-2 text-muted-foreground">Every step can be undone: Unrelease (back to Locked), Unlock (back to Open), or Return to Setup (only before any scoring). Undoing a lock or a release needs a reason and is recorded in the audit log.</p>
                </details>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-background text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
                      <tr>
                        <th className="px-4 py-3">League Age</th>
                        <th className="px-4 py-3">Session ID</th>
                        <th className="px-4 py-3 text-center">Status</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {LEAGUE_AGES.map((age) => {
                        const session = ageSessions.get(age);
                        const ageEvents = sessionEvents?.filter((event) => event.evaluation_session_id === session?.id) ?? [];
                        const hasPrimaryEvent = ageEvents.some((event) => event.event_type === "primary");
                        const hasEvaluator = (evaluatorAssignments ?? []).some((assignment) => assignment.evaluation_session_id === session?.id);

                        return (
                          <Fragment key={age}>
                          <tr className="hover:bg-accent/50 transition-colors">
                            <td className="px-4 py-3 font-semibold text-foreground text-xs font-mono">
                              Age {age}
                            </td>
                            <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                              {session ? session.id : "—"}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {!session ? (
                                <Badge variant="outline" className="border-border bg-muted text-muted-foreground text-xs font-mono">
                                  Not Created
                                </Badge>
                              ) : session.status === "setup" ? (
                                <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-mono">
                                  Setup
                                </Badge>
                              ) : session.status === "open" ? (
                                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-mono gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> Open
                                </Badge>
                              ) : session.published_at ? (
                                <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 text-xs font-mono gap-1">
                                  <Lock className="h-3 w-3" /> Released
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300 text-xs font-mono gap-1">
                                  <Lock className="h-3 w-3" /> Locked
                                </Badge>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {session ? (
                                <SessionActions
                                  session={session}
                                  released={Boolean(session.published_at)}
                                  seasonClosed={season.is_closed}
                                  age={age}
                                  hasPrimaryEvent={hasPrimaryEvent}
                                  hasEvaluator={hasEvaluator}
                                  submittedCount={evaluationCounts.get(session.id)?.submitted ?? 0}
                                  draftCount={evaluationCounts.get(session.id)?.draft ?? 0}
                                />
                              ) : (
                                <span className="text-xs font-mono text-slate-600 dark:text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                          {session && (
                            <tr>
                              <td colSpan={4} className="px-3 pb-4 pt-1">
                                <details className="group rounded-lg border border-border/70 bg-card/60">
                                  <summary className="cursor-pointer list-none px-3 py-3 text-sm font-semibold text-foreground marker:hidden">
                                    <span className="inline-flex items-center gap-2">
                                      <Calendar className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                                      Manage event schedule
                                      <span className="text-xs font-normal text-muted-foreground">
                                        {hasPrimaryEvent ? "Primary scheduled" : "Primary required"} · {ageEvents.filter((event) => event.event_type === "makeup").length} makeup
                                      </span>
                                    </span>
                                  </summary>
                                  <div className="border-t border-border/70 p-3">
                                    <SessionEventManager
                                      sessionId={session.id}
                                      events={ageEvents}
                                      disabled={season.is_closed || session.status !== "setup"}
                                    />
                                  </div>
                                </details>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
              </details>
            </Card>
          );
        })}

      <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
        Note: Sessions cover ages 7–16. Configure a primary event and assign at least one evaluator before opening. Makeup events are optional and can be added as needed. Locking and releasing can be undone (see &quot;How each age group moves through evaluations&quot; above).
      </p>
    </div>
  );
}

export default function EvaluationSessionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense
      fallback={
        <div className="h-96 w-full rounded-lg border border-border bg-card animate-pulse" />
      }
    >
      <SessionsContent searchParams={searchParams} />
    </Suspense>
  );
}