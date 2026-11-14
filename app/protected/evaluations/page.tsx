import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles, onlyRegistrar } from "@/lib/my-roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClipboardList, ArrowLeft, Layers, MapPin } from "lucide-react";
import { ScoringSession, type MyScores, type PriorYear, type ScoringCategory, type ScoringPlayer } from "./scoring-session";
import { HideWhileScoring } from "./hide-while-scoring";

const OLDEST_TO_YOUNGEST = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7];

type SearchParams = Promise<{ sessionId?: string; player?: string; message?: string; error?: string }>;
type AssignedSession = { id: number; season_id: number; league_age: number | null; status: string };
type Season = { id: number; name: string };
type EligibleRegistration = {
  id: number; evaluation_number: number | null; league_age: number; is_coach_kid: boolean;
  players: { first_name: string; last_name: string; date_of_birth: string | null } | null;
};
type MyEvaluation = {
  player_season_id: number; status: string;
  ratings: { score: number; rating_categories: { code: string } | null }[];
  experience_answers: { question_code: string; answer: string }[];
};
type PlayerNote = { player_season_id: number; kind: "private" | "shared"; note_text: string; is_mine: boolean };
type PriorRow = PriorYear & { player_season_id: number };

const playerName = (r: EligibleRegistration) => (r.players ? `${r.players.last_name}, ${r.players.first_name}` : `Registration #${r.id}`);

async function EvaluatorWorkspaceContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect("/auth/login");
  if (onlyRegistrar(await getMyRoles(supabase))) return redirect("/protected");
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
  const categories = (categoryResult.data ?? []) as ScoringCategory[];
  const seasonName = (id: number) => seasons.find((s) => s.id === id)?.name ?? `Season #${id}`;

  const requestedId = Number(params.sessionId);
  const selectedSession = Number.isSafeInteger(requestedId) && requestedId > 0 ? sessions.find((s) => s.id === requestedId) : undefined;

  const eventsResult = selectedSession
    ? await supabase.from("evaluation_session_events").select("id, event_type, event_date, start_time, end_time, location, notes")
        .eq("evaluation_session_id", selectedSession.id).order("event_date").order("start_time")
    : { data: [], error: null };
  const events = eventsResult.data ?? [];

  // An open age group is loaded in one go, so scoring keeps working with no signal (see scoring-session.tsx).
  let scoring: {
    players: ScoringPlayer[]; mine: Record<number, MyScores>; notes: Record<number, string>; prior: Record<number, PriorYear>;
    noteKind: "private" | "shared" | null;
  } | null = null;
  let loadError: string | null = null;

  if (selectedSession?.status === "open" && selectedSession.league_age !== null) {
    // Evaluation eligibility is based on season and Little League age, not payment status.
    const [regResult, evalResult, priorResult, assignmentResult, notesResult, hereResult] = await Promise.all([
      supabase.from("player_seasons")
        .select("id, evaluation_number, league_age, is_coach_kid, players(first_name, last_name, date_of_birth)")
        .eq("season_id", selectedSession.season_id).eq("league_age", selectedSession.league_age),
      supabase.from("evaluations")
        .select("player_season_id, status, ratings(score, rating_categories(code)), experience_answers(question_code, answer)")
        .eq("evaluation_session_id", selectedSession.id).eq("evaluator_user_id", userId),
      // Empty unless the season's prior-year switch is on.
      supabase.rpc("prior_year_for_session", { p_session_id: selectedSession.id }),
      supabase.from("evaluator_assignments").select("evaluator_type")
        .eq("evaluation_session_id", selectedSession.id).eq("evaluator_user_id", userId).maybeSingle(),
      // Only the viewer's own notes are used on this screen.
      supabase.rpc("player_notes", { p_session_id: selectedSession.id }),
      // Players the registrar checked in today (the "Here" marker).
      supabase.rpc("session_checked_in_today", { p_session_id: selectedSession.id }),
    ]);
    if (regResult.error) loadError = `Could not load players: ${regResult.error.message}`;
    if (evalResult.error) loadError = `Could not load your evaluations: ${evalResult.error.message}`;
    if (notesResult.error) loadError = `Could not load your notes: ${notesResult.error.message}`;

    const evaluatorType = (assignmentResult.data?.evaluator_type as string | undefined) ?? null;
    // Coaches keep private notes; independent evaluators write shared ones.
    const noteKind = evaluatorType === "coach" ? "private" : evaluatorType === "independent_evaluator" ? "shared" : null;
    const here = new Set(((hereResult.data ?? []) as number[]).map(Number));
    const registrations = ((regResult.data ?? []) as unknown as EligibleRegistration[]).sort(
      (a, b) => (a.evaluation_number ?? Infinity) - (b.evaluation_number ?? Infinity) || playerName(a).localeCompare(playerName(b)),
    );
    scoring = {
      noteKind,
      players: registrations.map((r) => ({
        id: r.id, bib: r.evaluation_number, name: playerName(r), leagueAge: r.league_age,
        birthDate: r.players?.date_of_birth ?? null, coachKid: r.is_coach_kid, here: here.has(r.id),
      })),
      mine: Object.fromEntries(((evalResult.data ?? []) as unknown as MyEvaluation[]).map((e) => [e.player_season_id, {
        status: e.status,
        scores: Object.fromEntries(e.ratings.filter((r) => r.rating_categories).map((r) => [r.rating_categories!.code, r.score])),
        answers: Object.fromEntries(e.experience_answers.map((a) => [a.question_code, a.answer])),
      }])),
      notes: Object.fromEntries(((notesResult.data ?? []) as PlayerNote[]).filter((n) => n.is_mine && n.kind === noteKind).map((n) => [n.player_season_id, n.note_text])),
      prior: Object.fromEntries(((priorResult.data ?? []) as PriorRow[]).map((p) => [p.player_season_id, p])),
    };
  }
  const requestedPlayer = Number(params.player);
  const initialPlayerId = scoring && scoring.players.some((p) => p.id === requestedPlayer) ? requestedPlayer : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
            <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4 text-emerald-700 dark:text-emerald-400" /> Home</Link>
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

      {selectedSession && (() => {
        const schedule = events.length > 0 && (
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
        );
        const ageLabel = `Age ${selectedSession.league_age} · ${seasonName(selectedSession.season_id)}`;
        if (scoring && !loadError) {
          return (
            <ScoringSession userId={userId} sessionId={selectedSession.id} ageLabel={ageLabel} categories={categories}
              players={scoring.players} mine={scoring.mine} notes={scoring.notes} prior={scoring.prior} noteKind={scoring.noteKind}
              initialPlayerId={initialPlayerId}>
              {schedule}
            </ScoringSession>
          );
        }
        return (
          <Card className="border-border bg-card">
            <CardHeader className="border-b border-border/50 py-4">
              <CardTitle className="text-lg font-bold text-foreground">{ageLabel}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4 sm:p-6">
              {schedule}
              {loadError ? (
                <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">{loadError}</div>
              ) : selectedSession.status === "setup" ? (
                <p className="text-sm text-muted-foreground">This session is still being prepared. An administrator must open it before scoring can begin.</p>
              ) : (
                <p className="text-sm text-muted-foreground">Scoring for this age group is locked. You can no longer change scores.</p>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* ===== My sessions (hidden while a player is open) ===== */}
      <HideWhileScoring>
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
      </HideWhileScoring>
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
