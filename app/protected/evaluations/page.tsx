import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { saveEvaluation } from "./actions";
import { RatingInputs } from "./rating-inputs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ClipboardList, 
  ArrowLeft, 
  ShieldAlert, 
  Calendar, 
  UserCheck, 
  Save,
  Layers,
  MapPin,
  Clock,
} from "lucide-react";

const OLDEST_TO_YOUNGEST = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7];

type SearchParams = Promise<{
  sessionId?: string;
  message?: string;
  error?: string;
}>;

type AssignedSession = {
  id: number;
  season_id: number;
  league_age: number | null;
  status: string;
};

type Season = {
  id: number;
  name: string;
};

type RatingCategory = {
  id: number;
  code: string;
  name: string;
  category_group: string;
  sort_order: number;
};

type EligibleRegistration = {
  id: number;
  evaluation_number: number | null;
  players: {
    first_name: string;
    last_name: string;
    date_of_birth: string | null;
  } | null;
};

type EvaluationRecord = {
  id: number;
  player_season_id: number;
  status: string;
};

type RatingRecord = {
  evaluation_id: number;
  rating_category_id: number;
  score: number;
};

type ExperienceRecord = {
  evaluation_id: number;
  question_code: string;
  answer: string;
};

const EXPERIENCE_QUESTIONS = [
  {
    code: "pitched_before",
    label: "Has pitched before",
  },
  {
    code: "caught_before",
    label: "Has caught before",
  },
  {
    code: "interested_in_pitching",
    label: "Interested in pitching",
  },
  {
    code: "interested_in_catching",
    label: "Interested in catching",
  },
] as const;

function ageLabel(age: number | null) {
  return age === null ? "Age not set" : `Age ${age}`;
}

async function EvaluatorWorkspaceContent({
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

  const userId = user.id;

  // Verify administrator permissions: Admins are redirected back to protected workspace
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");

  if (roleError) {
    return (
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected">
            <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Back to workspace
          </Link>
        </Button>
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
          Could not verify your account permissions.
        </div>
      </div>
    );
  }

  if (isAdmin === true) {
    return redirect("/protected");
  }

  const [sessionResult, seasonResult, categoryResult] = await Promise.all([
    supabase
      .from("evaluation_sessions")
      .select("id, season_id, league_age, status")
      .is("season_division_id", null)
      .order("season_id", { ascending: false })
      .order("league_age", { ascending: false }),
    supabase.from("seasons").select("id, name"),
    supabase
      .from("rating_categories")
      .select("id, code, name, category_group, sort_order")
      .order("sort_order"),
  ]);

  const sessions = (sessionResult.data ?? []) as AssignedSession[];
  const seasons = (seasonResult.data ?? []) as Season[];
  const categories = (categoryResult.data ?? []) as RatingCategory[];

  const seasonName = (seasonId: number) =>
    seasons.find((season) => season.id === seasonId)?.name ?? `Season #${seasonId}`;

  const requestedId = params.sessionId ? Number(params.sessionId) : null;

  const selectedSession =
    requestedId !== null && Number.isSafeInteger(requestedId) && requestedId > 0
      ? sessions.find((session) => session.id === requestedId)
      : undefined;

  const selectedSessionEventsResult = selectedSession
    ? await supabase
        .from("evaluation_session_events")
        .select("id, event_type, event_date, start_time, end_time, location, notes")
        .eq("evaluation_session_id", selectedSession.id)
        .order("event_date", { ascending: true })
        .order("start_time", { ascending: true })
    : { data: [], error: null };
  const selectedSessionEvents = selectedSessionEventsResult.data ?? [];

  let registrations: EligibleRegistration[] = [];
  let evaluations: EvaluationRecord[] = [];
  let ratings: RatingRecord[] = [];
  let experienceAnswers: ExperienceRecord[] = [];
  let playerLoadError: string | null = null;

  if (selectedSession?.status === "open") {
    if (categoryResult.error) {
      playerLoadError = `Could not load rating categories: ${categoryResult.error.message}`;
    } else if (selectedSession.league_age === null) {
      playerLoadError = "This session does not have a Little League age set.";
    } else {
      const registrationResult = await supabase
        .from("player_seasons")
        .select(
          "id, evaluation_number, players(first_name, last_name, date_of_birth)"
        )
        .eq("season_id", selectedSession.season_id)
        .eq("league_age", selectedSession.league_age)
        .order("evaluation_number", { ascending: true, nullsFirst: false });

      if (registrationResult.error) {
        playerLoadError = `Could not load eligible registrations: ${registrationResult.error.message}`;
      } else {
        // Evaluation eligibility is based on season and Little League age, not payment status.
        registrations = (registrationResult.data ?? []) as unknown as EligibleRegistration[];

        const playerSeasonIds = registrations.map((row) => row.id);

        if (playerSeasonIds.length > 0) {
          const evaluationResult = await supabase
            .from("evaluations")
            .select("id, player_season_id, status")
            .eq("evaluation_session_id", selectedSession.id)
            .eq("evaluator_user_id", userId)
            .in("player_season_id", playerSeasonIds);

          if (evaluationResult.error) {
            playerLoadError = `Could not load your existing evaluations: ${evaluationResult.error.message}`;
          } else {
            evaluations = (evaluationResult.data ?? []) as EvaluationRecord[];
            const evaluationIds = evaluations.map((row) => row.id);

            if (evaluationIds.length > 0) {
              const [ratingResult, experienceResult] = await Promise.all([
                supabase
                  .from("ratings")
                  .select("evaluation_id, rating_category_id, score")
                  .in("evaluation_id", evaluationIds),
                supabase
                  .from("experience_answers")
                  .select("evaluation_id, question_code, answer")
                  .in("evaluation_id", evaluationIds),
              ]);

              if (ratingResult.error) {
                playerLoadError = `Could not load saved ratings: ${ratingResult.error.message}`;
              } else {
                ratings = (ratingResult.data ?? []) as RatingRecord[];
              }

              if (experienceResult.error) {
                playerLoadError = `Could not load saved experience answers: ${experienceResult.error.message}`;
              } else {
                experienceAnswers = (experienceResult.data ?? []) as ExperienceRecord[];
              }
            }
          }
        }
      }
    }
  }

  const evaluationByPlayerSeason = new Map(
    evaluations.map((evaluation) => [evaluation.player_season_id, evaluation])
  );

  const ratingByEvaluationAndCategory = new Map(
    ratings.map((rating) => [
      `${rating.evaluation_id}:${rating.rating_category_id}`,
      rating.score,
    ])
  );

  const experienceByEvaluationAndQuestion = new Map(
    experienceAnswers.map((answer) => [
      `${answer.evaluation_id}:${answer.question_code}`,
      answer.answer,
    ])
  );

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
            <ClipboardList className="h-7 w-7 text-emerald-700 dark:text-emerald-400" />
            Evaluator Workspace
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your assigned evaluation sessions, ordered from oldest to youngest.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="border-border bg-card text-xs text-slate-700 dark:text-slate-300 hover:bg-accent">
          <Link href="/protected/coach-reports">View My Players&apos; Historical Ratings &rarr;</Link>
        </Button>
      </div>

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

      {sessionResult.error ? (
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
          Could not load your assigned sessions: {sessionResult.error.message}
        </div>
      ) : (
        <>
          {params.sessionId && !selectedSession && (
            <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-300">
              That session was not found among the sessions available to your account. Ask an administrator to check your assignment.
            </div>
          )}

          {/* Active Session Scoring Interface */}
          {selectedSession && (
            <Card className="border-border bg-card">
              <CardHeader className="py-4 border-b border-border/50">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                      {ageLabel(selectedSession.league_age)} Session
                    </CardTitle>
                    <CardDescription className="text-xs text-muted-foreground font-mono mt-1">
                      {seasonName(selectedSession.season_id)} &bull; Session #{selectedSession.id}
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-xs font-mono w-fit ${
                      selectedSession.status === "open"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : selectedSession.status === "setup"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "border-slate-700 bg-slate-800 text-muted-foreground"
                    }`}
                  >
                    Status: {selectedSession.status}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-6 space-y-6">
                {selectedSessionEvents.length > 0 && (
                  <section className="rounded-lg border border-border bg-background p-4 space-y-3" aria-label="Scheduled evaluation events">
                    <h3 className="text-sm font-semibold text-foreground">Scheduled events</h3>
                    {selectedSessionEvents.map((event) => (
                      <div key={event.id} className="flex flex-col gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-foreground">
                            {event.event_type === "primary" ? "Primary evaluation" : "Makeup evaluation"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {event.event_date} · {event.start_time.slice(0, 5)}–{event.end_time.slice(0, 5)}
                          </p>
                          <p className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5 shrink-0" />{event.location}</p>
                          {event.notes && <p className="text-xs text-muted-foreground">{event.notes}</p>}
                        </div>
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" /> Local league time</span>
                      </div>
                    ))}
                  </section>
                )}
                {selectedSessionEventsResult.error && (
                  <div role="status" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                    Event schedule details are temporarily unavailable.
                  </div>
                )}
                {selectedSession.status === "setup" ? (
                  <p className="text-xs font-mono text-muted-foreground">
                    This session is still being prepared. An administrator must open it before evaluation work can begin.
                  </p>
                ) : selectedSession.status !== "open" ? (
                  <p className="text-xs font-mono text-muted-foreground">
                    This session is locked. Evaluation entry is not available.
                  </p>
                ) : playerLoadError ? (
                  <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
                    {playerLoadError}
                  </div>
                ) : registrations.length === 0 ? (
                  <div className="rounded-lg border border-border bg-background p-6 text-center space-y-2">
                    <ShieldAlert className="h-8 w-8 text-amber-700 dark:text-amber-400 mx-auto" />
                    <p className="text-sm font-semibold text-foreground">No Eligible Players Yet</p>
                    <p className="text-xs text-muted-foreground">
                      No registrations match this season and Little League age. Check that the season registrations have been imported.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <p className="text-xs text-muted-foreground font-mono">
                      {registrations.length} eligible player{registrations.length === 1 ? "" : "s"}. Only <strong>submitted</strong> evaluations count in reports. Drafts are private notes until you submit. You can change a submission until the session is locked.
                    </p>

                    {registrations.map((registration) => {
                      const player = registration.players;
                      const evaluation = evaluationByPlayerSeason.get(registration.id);
                      const evaluationId = evaluation?.id;

                      return (
                        <form
                          key={registration.id}
                          action={saveEvaluation}
                          className="space-y-6 rounded-lg border border-border bg-background p-5"
                        >
                          <input type="hidden" name="sessionId" value={selectedSession.id} />
                          <input type="hidden" name="playerSeasonId" value={registration.id} />

                          <div className="space-y-1 border-b border-border pb-3">
                            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                              <UserCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                              {player
                                ? `${player.last_name}, ${player.first_name}`
                                : `Player registration #${registration.id}`}
                            </h3>
                            <p className="text-xs font-mono text-muted-foreground">
                              {registration.evaluation_number !== null
                                ? `Evaluation #${registration.evaluation_number}`
                                : "No evaluation number assigned"}
                              {player?.date_of_birth ? ` · DOB ${player.date_of_birth}` : ""}
                            </p>
                            <p
                              className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${
                                evaluation?.status === "submitted"
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                  : evaluation?.status === "not_evaluated"
                                  ? "bg-slate-500/15 text-slate-700 dark:text-slate-300"
                                  : evaluation?.status === "draft"
                                  ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {evaluation?.status === "submitted"
                                ? "Submitted"
                                : evaluation?.status === "not_evaluated"
                                ? "Not evaluated"
                                : evaluation?.status === "draft"
                                ? "Draft — not submitted yet"
                                : "Not started"}
                            </p>
                          </div>

                          <RatingInputs
                            categories={categories}
                            initialScores={Object.fromEntries(
                              categories.map((category) => {
                                const score =
                                  evaluationId === undefined
                                    ? undefined
                                    : ratingByEvaluationAndCategory.get(
                                        `${evaluationId}:${category.id}`
                                      );
                                return [category.code, score ?? null];
                              })
                            )}
                          />

                          {/* Pitching & Catching Experience Radio Grid */}
                          <div className="space-y-3 border-t border-border pt-4">
                            <h4 className="text-xs font-bold text-foreground font-mono uppercase tracking-wider">
                              Pitching and Catching Experience
                            </h4>
                            <div className="grid gap-4 sm:grid-cols-2">
                              {EXPERIENCE_QUESTIONS.map((question) => {
                                const savedAnswer =
                                  evaluationId === undefined
                                    ? undefined
                                    : experienceByEvaluationAndQuestion.get(
                                        `${evaluationId}:${question.code}`
                                      );

                                return (
                                  <div key={question.code} className="space-y-2 text-xs">
                                    <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                                      {question.label}
                                    </span>
                                    <div className="grid grid-cols-3 gap-2" role="group" aria-label={question.label}>
                                      {[
                                        { value: "yes", label: "Yes" },
                                        { value: "no", label: "No" },
                                        { value: "unknown", label: "Not sure" },
                                      ].map((option) => (
                                        <label key={option.value} className="cursor-pointer">
                                          <input
                                            type="radio"
                                            name={`experience_${question.code}`}
                                            value={option.value}
                                            defaultChecked={(savedAnswer ?? "unknown") === option.value}
                                            className="peer sr-only"
                                          />
                                          <span className="flex min-h-9 items-center justify-center rounded-md border border-border bg-card px-2 text-center text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors hover:bg-accent peer-checked:border-emerald-500 peer-checked:bg-emerald-600 peer-checked:text-foreground">
                                            {option.label}
                                          </span>
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Submit Action */}
                          <div className="space-y-3 border-t border-border pt-4">
                            <p className="text-xs text-slate-600 dark:text-slate-400">
                              Leave a skill on &quot;Not scored&quot; if you didn&apos;t see it. Blank skills are flagged, never counted as zero. Submit needs at least one core skill.
                            </p>
                            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                              <Button type="submit" name="intent" value="not_evaluated" variant="outline" size="sm" className="text-xs">
                                Not Evaluated (clears ratings)
                              </Button>
                              <Button type="submit" name="intent" value="draft" variant="outline" size="sm" className="text-xs">
                                <Save className="h-3.5 w-3.5 mr-1.5" /> Save Draft
                              </Button>
                              <Button type="submit" name="intent" value="submitted" size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs">
                                {evaluation?.status === "submitted" ? "Update Submission" : "Submit"}
                              </Button>
                            </div>
                          </div>
                        </form>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Assigned Sessions Directory */}
          <Card className="border-border bg-card">
            <CardHeader className="py-4 border-b border-border/50">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <Layers className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                My Assigned Sessions
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {sessions.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">No sessions assigned</p>
                  <p className="mt-1">Contact your administrator to be assigned to an evaluation session.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {OLDEST_TO_YOUNGEST.map((age) =>
                    sessions
                      .filter((session) => session.league_age === age)
                      .map((session) => (
                        <div
                          key={session.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border bg-background p-4"
                        >
                          <div>
                            <h3 className="font-bold text-foreground text-xs font-mono">Age {age}</h3>
                            <p className="text-xs text-muted-foreground font-mono mt-0.5">
                              {seasonName(session.season_id)} &bull; Session #{session.id}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge
                              variant="outline"
                              className={`text-xs font-mono ${
                                session.status === "open"
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                  : session.status === "setup"
                                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                  : "border-slate-700 bg-slate-800 text-muted-foreground"
                              }`}
                            >
                              {session.status}
                            </Badge>
                            <Button asChild variant="outline" size="sm" className="h-7 border-border bg-card text-xs text-slate-700 dark:text-slate-200 hover:bg-accent">
                              <Link href={`/protected/evaluations?sessionId=${session.id}`}>
                                View Session
                              </Link>
                            </Button>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export default function EvaluatorWorkspacePage({
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
      <EvaluatorWorkspaceContent searchParams={searchParams} />
    </Suspense>
  );
}