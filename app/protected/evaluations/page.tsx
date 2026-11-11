import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { saveEvaluation } from "./actions";
import { RatingInputs } from "./rating-inputs";
import { DirtyTracker, GuardedLink } from "./unsaved-guard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClipboardList, ArrowLeft, ShieldAlert, Calendar, Layers, MapPin, Search, ChevronLeft, ChevronRight, History } from "lucide-react";

const OLDEST_TO_YOUNGEST = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7];

type SearchParams = Promise<{
  sessionId?: string;
  player?: string;
  bib?: string;
  message?: string;
  error?: string;
}>;

type AssignedSession = { id: number; season_id: number; league_age: number | null; status: string };
type Season = { id: number; name: string };
type RatingCategory = { id: number; code: string; name: string; category_group: string; sort_order: number };
type EligibleRegistration = {
  id: number;
  evaluation_number: number | null;
  league_age: number;
  players: { first_name: string; last_name: string; date_of_birth: string | null } | null;
};
type EvaluationRecord = { id: number; player_season_id: number; status: string };
type PriorYear = { player_season_id: number; prior_overall: number | null; prior_skills_rated: number; prior_ratings: number; prior_skills: Record<string, number> };

const EXPERIENCE_QUESTIONS = [
  { code: "pitched_before", label: "Has pitched before" },
  { code: "caught_before", label: "Has caught before" },
  { code: "interested_in_pitching", label: "Interested in pitching" },
  { code: "interested_in_catching", label: "Interested in catching" },
] as const;

const PRIOR_SKILLS: [string, string][] = [
  ["hitting", "Hitting"], ["throwing", "Throwing"], ["grounders", "Grounders"], ["fly_balls", "Fly Balls"],
  ["running_awareness", "Running"], ["pitching", "Pitching"], ["catching", "Catching"],
];

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  submitted: { label: "Saved", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  draft: { label: "Draft (not counted)", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  not_evaluated: { label: "Not evaluated", className: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  none: { label: "Not started", className: "bg-muted text-muted-foreground" },
};

const playerName = (r: EligibleRegistration) => (r.players ? `${r.players.last_name}, ${r.players.first_name}` : `Registration #${r.id}`);
const bibLabel = (r: EligibleRegistration) => (r.evaluation_number === null ? "No bib" : `#${r.evaluation_number}`);

function StatusChip({ status }: { status?: string }) {
  const s = STATUS_STYLE[status ?? "none"] ?? STATUS_STYLE.none;
  return <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-semibold ${s.className}`}>{s.label}</span>;
}

async function EvaluatorWorkspaceContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect("/auth/login");
  const userId = user.id;

  // Administrators do not score; they are sent back to the workspace.
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
  if (roleError) {
    return (
      <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
        Could not verify your account permissions.
      </div>
    );
  }
  if (isAdmin === true) return redirect("/protected");

  const [sessionResult, seasonResult, categoryResult] = await Promise.all([
    supabase.from("evaluation_sessions").select("id, season_id, league_age, status").is("season_division_id", null)
      .order("season_id", { ascending: false }).order("league_age", { ascending: false }),
    supabase.from("seasons").select("id, name"),
    supabase.from("rating_categories").select("id, code, name, category_group, sort_order").order("sort_order"),
  ]);
  const sessions = (sessionResult.data ?? []) as AssignedSession[];
  const seasons = (seasonResult.data ?? []) as Season[];
  const categories = (categoryResult.data ?? []) as RatingCategory[];
  const seasonName = (id: number) => seasons.find((s) => s.id === id)?.name ?? `Season #${id}`;

  const requestedId = Number(params.sessionId);
  const selectedSession = Number.isSafeInteger(requestedId) && requestedId > 0 ? sessions.find((s) => s.id === requestedId) : undefined;

  const eventsResult = selectedSession
    ? await supabase.from("evaluation_session_events").select("id, event_type, event_date, start_time, end_time, location, notes")
        .eq("evaluation_session_id", selectedSession.id).order("event_date").order("start_time")
    : { data: [], error: null };
  const events = eventsResult.data ?? [];

  let registrations: EligibleRegistration[] = [];
  let evaluations: EvaluationRecord[] = [];
  let priorYear: PriorYear[] = [];
  let loadError: string | null = null;

  if (selectedSession?.status === "open" && selectedSession.league_age !== null) {
    // Evaluation eligibility is based on season and Little League age, not payment status.
    const regResult = await supabase.from("player_seasons")
      .select("id, evaluation_number, league_age, players(first_name, last_name, date_of_birth)")
      .eq("season_id", selectedSession.season_id).eq("league_age", selectedSession.league_age);
    if (regResult.error) loadError = `Could not load players: ${regResult.error.message}`;
    registrations = ((regResult.data ?? []) as unknown as EligibleRegistration[]).sort(
      (a, b) => (a.evaluation_number ?? Infinity) - (b.evaluation_number ?? Infinity) || playerName(a).localeCompare(playerName(b)),
    );

    const [evalResult, priorResult] = await Promise.all([
      supabase.from("evaluations").select("id, player_season_id, status")
        .eq("evaluation_session_id", selectedSession.id).eq("evaluator_user_id", userId),
      // Empty unless the season's prior-year switch is on.
      supabase.rpc("prior_year_for_session", { p_session_id: selectedSession.id }),
    ]);
    if (evalResult.error) loadError = `Could not load your evaluations: ${evalResult.error.message}`;
    evaluations = (evalResult.data ?? []) as EvaluationRecord[];
    priorYear = (priorResult.data ?? []) as PriorYear[];
  }

  const evaluationFor = new Map(evaluations.map((e) => [e.player_season_id, e]));
  const priorFor = new Map(priorYear.map((p) => [p.player_season_id, p]));
  const sessionUrl = selectedSession ? `/protected/evaluations?sessionId=${selectedSession.id}` : "/protected/evaluations";

  // Bib search jumps straight to the player.
  if (selectedSession && params.bib !== undefined) {
    const wanted = Number(String(params.bib).replace(/^#/, "").trim());
    const hit = registrations.find((r) => r.evaluation_number === wanted);
    if (hit) redirect(`${sessionUrl}&player=${hit.id}`);
    redirect(`${sessionUrl}&error=${encodeURIComponent(`No player with bib ${params.bib} in this age group.`)}`);
  }

  const playerIndex = registrations.findIndex((r) => String(r.id) === params.player);
  const player = playerIndex >= 0 ? registrations[playerIndex] : undefined;
  const previous = playerIndex > 0 ? registrations[playerIndex - 1] : undefined;
  const next = playerIndex >= 0 && playerIndex < registrations.length - 1 ? registrations[playerIndex + 1] : undefined;
  const myEvaluation = player ? evaluationFor.get(player.id) : undefined;

  let savedScores: Record<string, number | null> = {};
  let savedAnswers: Record<string, string> = {};
  if (myEvaluation) {
    const [ratingResult, answerResult] = await Promise.all([
      supabase.from("ratings").select("rating_category_id, score").eq("evaluation_id", myEvaluation.id),
      supabase.from("experience_answers").select("question_code, answer").eq("evaluation_id", myEvaluation.id),
    ]);
    savedScores = Object.fromEntries((ratingResult.data ?? []).map((r) => [categories.find((c) => c.id === r.rating_category_id)?.code ?? "", r.score]));
    savedAnswers = Object.fromEntries((answerResult.data ?? []).map((a) => [a.question_code, a.answer]));
  }
  const prior = player ? priorFor.get(player.id) : undefined;
  const submittedCount = evaluations.filter((e) => e.status === "submitted" || e.status === "not_evaluated").length;

  const navBar = (position: string) => player && (
    <div className="grid grid-cols-3 items-center gap-2" aria-label={`Player navigation ${position}`}>
      {previous ? (
        <GuardedLink href={`${sessionUrl}&player=${previous.id}`} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-border bg-card px-2 text-sm font-medium hover:bg-accent">
          <ChevronLeft className="h-4 w-4" /> {bibLabel(previous)}
        </GuardedLink>
      ) : <span />}
      <GuardedLink href={sessionUrl} className="inline-flex min-h-11 items-center justify-center rounded-md px-2 text-sm text-muted-foreground hover:text-foreground">
        All players
      </GuardedLink>
      {next ? (
        <GuardedLink href={`${sessionUrl}&player=${next.id}`} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md border border-emerald-600 bg-emerald-600 px-2 text-sm font-semibold text-white hover:bg-emerald-500">
          Next {bibLabel(next)} <ChevronRight className="h-4 w-4" />
        </GuardedLink>
      ) : <span className="text-center text-xs text-muted-foreground">Last player</span>}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
            <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4 text-emerald-700 dark:text-emerald-400" /> Back to workspace</Link>
          </Button>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            <ClipboardList className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> Evaluator Workspace
          </h1>
        </div>
        <Button asChild variant="outline" size="sm" className="text-xs">
          <Link href="/protected/draft-reports">Draft Reports &rarr;</Link>
        </Button>
      </div>

      {params.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{params.message}</div>}
      {params.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{params.error}</div>}
      {sessionResult.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">Could not load your sessions: {sessionResult.error.message}</div>}
      {params.sessionId && !selectedSession && !sessionResult.error && (
        <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
          That session is not one of yours. Ask an administrator to check your assignment.
        </div>
      )}

      {/* ===== One player ===== */}
      {selectedSession && player && (
        <Card className="border-border bg-card">
          <CardContent className="space-y-5 p-4 sm:p-6">
            {navBar("top")}
            <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
              <div>
                <p className="font-mono text-3xl font-bold text-foreground">{bibLabel(player)}</p>
                <h2 className="text-lg font-semibold text-foreground">{playerName(player)}</h2>
                <p className="text-xs text-muted-foreground">
                  LL age {player.league_age}{player.players?.date_of_birth ? ` · born ${player.players.date_of_birth}` : ""} · player {playerIndex + 1} of {registrations.length}
                </p>
              </div>
              <StatusChip status={myEvaluation?.status} />
            </div>

            {prior && (
              <section className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs" aria-label="Prior-year ratings">
                <p className="mb-1 flex items-center gap-1 font-semibold text-sky-800 dark:text-sky-300">
                  <History className="h-3.5 w-3.5" /> Prior-year coach rating: {prior.prior_overall === null ? "—" : Number(prior.prior_overall).toFixed(2)}
                  <span className="font-normal text-muted-foreground">({prior.prior_ratings} rating{prior.prior_ratings === 1 ? "" : "s"})</span>
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  {PRIOR_SKILLS.filter(([c]) => prior.prior_skills?.[c] !== undefined).map(([c, l]) => (
                    <span key={c}>{l} <strong className="font-mono text-foreground">{Number(prior.prior_skills[c]).toFixed(1)}</strong></span>
                  ))}
                </div>
              </section>
            )}

            {/* key: rebuild the form for each player and each saved version. Without it, moving between players
                reuses the previous form, so it shows stale scores (blank after "Previous", or another player's). */}
            <form
              key={`${player.id}|${myEvaluation?.status ?? "none"}|${JSON.stringify(savedScores)}|${JSON.stringify(savedAnswers)}`}
              id="evaluation-form"
              action={saveEvaluation}
              className="space-y-6"
            >
              <DirtyTracker formId="evaluation-form" />
              <input type="hidden" name="sessionId" value={selectedSession.id} />
              <input type="hidden" name="playerSeasonId" value={player.id} />
              {next && <input type="hidden" name="nextPlayerSeasonId" value={next.id} />}

              <RatingInputs categories={categories} initialScores={Object.fromEntries(categories.map((c) => [c.code, savedScores[c.code] ?? null]))} />

              <div className="space-y-3 border-t border-border pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Pitching and catching experience</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {EXPERIENCE_QUESTIONS.map((q) => (
                    <div key={q.code} className="space-y-2 text-xs">
                      <span className="block font-semibold text-slate-700 dark:text-slate-300">{q.label}</span>
                      <div className="grid grid-cols-3 gap-2" role="group" aria-label={q.label}>
                        {[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unknown", label: "Not sure" }].map((o) => (
                          <label key={o.value} className="cursor-pointer">
                            <input type="radio" name={`experience_${q.code}`} value={o.value} defaultChecked={(savedAnswers[q.code] ?? "unknown") === o.value} className="peer sr-only" />
                            <span className="flex min-h-10 items-center justify-center rounded-md border border-border bg-card px-2 text-xs font-medium text-slate-700 hover:bg-accent peer-checked:border-emerald-500 peer-checked:bg-emerald-600 peer-checked:text-white dark:text-slate-300">
                              {o.label}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Leave a skill on &quot;Not scored&quot; if you didn&apos;t see it. Blank skills are flagged, never counted as zero. Saving needs at least one core skill. Your ratings count in reports as soon as you save, and you can change them until the session is locked.
                </p>
                <div className="grid gap-2 sm:flex sm:flex-row-reverse sm:flex-wrap">
                  {next && (
                    <Button type="submit" name="intent" value="submitted_next" className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-500">
                      Save &amp; Next ({bibLabel(next)})
                    </Button>
                  )}
                  <Button type="submit" name="intent" value="submitted" variant={next ? "outline" : "default"} className={`min-h-11 ${next ? "" : "bg-emerald-600 text-white hover:bg-emerald-500"}`}>
                    Save
                  </Button>
                  <Button type="submit" name="intent" value="not_evaluated" variant="outline" className="min-h-11 text-muted-foreground">
                    Not Evaluated (clears ratings)
                  </Button>
                </div>
              </div>
            </form>
            {navBar("bottom")}
          </CardContent>
        </Card>
      )}

      {/* ===== Player list for a session ===== */}
      {selectedSession && !player && (
        <Card className="border-border bg-card">
          <CardHeader className="border-b border-border/50 py-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg font-bold text-foreground">
                  <Calendar className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                  Age {selectedSession.league_age} Session
                </CardTitle>
                <CardDescription className="mt-1 text-xs text-muted-foreground">{seasonName(selectedSession.season_id)}</CardDescription>
              </div>
              <Badge variant="outline" className="text-xs">{selectedSession.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-4 sm:p-6">
            {events.length > 0 && (
              <section className="space-y-2 rounded-lg border border-border bg-background p-3" aria-label="Scheduled evaluation events">
                <h3 className="text-sm font-semibold text-foreground">Scheduled events</h3>
                {events.map((e) => (
                  <p key={e.id} className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <strong className="text-foreground">{e.event_type === "primary" ? "Primary" : "Makeup"}</strong>
                    {e.event_date} · {e.start_time.slice(0, 5)}–{e.end_time.slice(0, 5)}
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{e.location}</span>
                    {e.notes && <span>· {e.notes}</span>}
                  </p>
                ))}
              </section>
            )}

            {selectedSession.status === "setup" ? (
              <p className="text-sm text-muted-foreground">This session is still being prepared. An administrator must open it before scoring can begin.</p>
            ) : selectedSession.status !== "open" ? (
              <p className="text-sm text-muted-foreground">Scoring for this age group is locked. You can no longer change scores.</p>
            ) : loadError ? (
              <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">{loadError}</div>
            ) : registrations.length === 0 ? (
              <div className="space-y-2 rounded-lg border border-border bg-background p-6 text-center">
                <ShieldAlert className="mx-auto h-8 w-8 text-amber-700 dark:text-amber-400" />
                <p className="text-sm font-semibold text-foreground">No players in this age group yet</p>
              </div>
            ) : (
              <>
                <form className="flex gap-2" action="/protected/evaluations" method="get" role="search">
                  <input type="hidden" name="sessionId" value={selectedSession.id} />
                  <label htmlFor="bib-search" className="sr-only">Bib number</label>
                  <input id="bib-search" name="bib" inputMode="numeric" placeholder="Go to bib #" required
                    className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-base" />
                  <Button type="submit" className="min-h-11"><Search className="mr-1 h-4 w-4" /> Go</Button>
                </form>
                <p className="text-xs text-muted-foreground">
                  {submittedCount} of {registrations.length} players done (saved or not evaluated). A player marked &quot;Draft (not counted)&quot; stays out of reports until you open it and save.
                  {priorYear.length > 0 && " Prior-year ratings are shown on each player's page."}
                </p>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {registrations.map((r) => (
                    <li key={r.id}>
                      <Link href={`${sessionUrl}&player=${r.id}`} className="flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-accent">
                        <span className="w-14 shrink-0 font-mono text-base font-bold text-foreground">{r.evaluation_number ?? "—"}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{playerName(r)}</span>
                        <span className="hidden text-xs text-muted-foreground sm:inline">Age {r.league_age}</span>
                        <StatusChip status={evaluationFor.get(r.id)?.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ===== My sessions ===== */}
      {!player && (
        <Card className="border-border bg-card">
          <CardHeader className="border-b border-border/50 py-4">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Layers className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> My Age Groups
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4">
            {sessions.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">You are not assigned to any age group yet. Contact your administrator.</p>
            ) : (
              OLDEST_TO_YOUNGEST.flatMap((age) => sessions.filter((s) => s.league_age === age)).map((s) => (
                <Link key={s.id} href={`/protected/evaluations?sessionId=${s.id}`}
                  className={`flex min-h-12 items-center justify-between gap-3 rounded-lg border p-3 hover:bg-accent ${s.id === selectedSession?.id ? "border-emerald-600" : "border-border"}`}>
                  <span>
                    <span className="block text-sm font-bold text-foreground">Age {s.league_age}</span>
                    <span className="block text-xs text-muted-foreground">{seasonName(s.season_id)}</span>
                  </span>
                  <Badge variant="outline" className={`text-xs ${s.status === "open" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : ""}`}>
                    {s.status === "open" ? "Scoring open" : s.status === "setup" ? "Not open yet" : "Locked"}
                  </Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function EvaluatorWorkspacePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <EvaluatorWorkspaceContent searchParams={searchParams} />
    </Suspense>
  );
}
