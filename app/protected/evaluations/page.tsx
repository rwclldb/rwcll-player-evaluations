
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { saveEvaluationDraft } from "./actions";
import { RatingInputs } from "./rating-inputs";

const OLDEST_TO_YOUNGEST = [16, 15, 14, 13, 12, 11, 10, 9, 8];

function isEligibleRegistrationStatus(status: string | null) {
  const normalized = status?.trim().toLowerCase();
  return ["completed", "paid", "pending"].includes(normalized ?? "");
}

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

function EvaluatorWorkspaceFallback() {
  return (
    <main className="w-full max-w-4xl space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">
        Evaluator workspace
      </h1>
      <p className="text-sm text-muted-foreground">
        Loading your assigned sessions…
      </p>
    </main>
  );
}

export default function EvaluatorWorkspacePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<EvaluatorWorkspaceFallback />}>
      <EvaluatorWorkspaceContent searchParams={searchParams} />
    </Suspense>
  );
}

async function EvaluatorWorkspaceContent({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await connection();

  const params = await searchParams;
  const supabase = await createClient();

  const { data: claims, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claims?.claims) {
    redirect("/auth/login");
  }

  const userId = String(claims.claims.sub);

  const { data: isAdmin, error: roleError } =
    await supabase.rpc("is_admin");

  if (roleError) {
    return (
      <main className="w-full max-w-4xl space-y-4">
        <h1 className="text-2xl font-bold">Evaluator workspace</h1>
        <p role="alert" className="rounded-md border p-4 text-sm">
          Could not verify your account permissions.
        </p>
      </main>
    );
  }

  if (isAdmin === true) {
    redirect("/protected");
  }

  const [sessionResult, seasonResult, categoryResult] =
    await Promise.all([
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
    seasons.find((season) => season.id === seasonId)?.name ??
    `Season #${seasonId}`;

  const requestedId = params.sessionId
    ? Number(params.sessionId)
    : null;

  const selectedSession =
    requestedId !== null &&
    Number.isSafeInteger(requestedId) &&
    requestedId > 0
      ? sessions.find((session) => session.id === requestedId)
      : undefined;

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
          "id, evaluation_number, registration_payment_status, players(first_name, last_name, date_of_birth)",
        )
        .eq("season_id", selectedSession.season_id)
        .eq("league_age", selectedSession.league_age)
        .not("registration_payment_status", "is", null)
        .order("evaluation_number", { ascending: true, nullsFirst: false });

      if (registrationResult.error) {
        playerLoadError =
          `Could not load eligible registrations: ${registrationResult.error.message}`;
      } else {
        registrations =
          ((registrationResult.data ?? []) as unknown as (EligibleRegistration & { registration_payment_status?: string | null })[])
            .filter((registration) => isEligibleRegistrationStatus(registration.registration_payment_status ?? null));

        const playerSeasonIds = registrations.map((row) => row.id);

        if (playerSeasonIds.length > 0) {
          const evaluationResult = await supabase
            .from("evaluations")
            .select("id, player_season_id, status")
            .eq("evaluation_session_id", selectedSession.id)
            .eq("evaluator_user_id", userId)
            .in("player_season_id", playerSeasonIds);

          if (evaluationResult.error) {
            playerLoadError =
              `Could not load your existing evaluations: ${evaluationResult.error.message}`;
          } else {
            evaluations =
              (evaluationResult.data ?? []) as EvaluationRecord[];

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
                playerLoadError =
                  `Could not load saved ratings: ${ratingResult.error.message}`;
              } else {
                ratings = (ratingResult.data ?? []) as RatingRecord[];
              }

              if (experienceResult.error) {
                playerLoadError =
                  `Could not load saved experience answers: ${experienceResult.error.message}`;
              } else {
                experienceAnswers =
                  (experienceResult.data ?? []) as ExperienceRecord[];
              }
            }
          }
        }
      }
    }
  }

  const evaluationByPlayerSeason = new Map(
    evaluations.map((evaluation) => [
      evaluation.player_season_id,
      evaluation,
    ]),
  );

  const ratingByEvaluationAndCategory = new Map(
    ratings.map((rating) => [
      `${rating.evaluation_id}:${rating.rating_category_id}`,
      rating.score,
    ]),
  );

  const experienceByEvaluationAndQuestion = new Map(
    experienceAnswers.map((answer) => [
      `${answer.evaluation_id}:${answer.question_code}`,
      answer.answer,
    ]),
  );

  return (
    <main className="w-full max-w-4xl space-y-8">
      <header className="space-y-2">
        <Link
          href="/protected"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to workspace
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">
          Evaluator workspace
        </h1>
        <p className="text-sm text-muted-foreground">
          Your assigned sessions, ordered from oldest to youngest.
          Access is limited by your session assignments.
        </p>
      </header>

      {params.message && (
        <p className="rounded-md border p-4 text-sm" role="status">
          {params.message}
        </p>
      )}

      {params.error && (
        <p className="rounded-md border p-4 text-sm" role="alert">
          {params.error}
        </p>
      )}

      {sessionResult.error ? (
        <p role="alert" className="rounded-md border p-4 text-sm">
          Could not load your assigned sessions: {sessionResult.error.message}
        </p>
      ) : (
        <>
          {params.sessionId && !selectedSession && (
            <p role="alert" className="rounded-md border p-4 text-sm">
              That session was not found among the sessions available to
              your account. Ask an administrator to check your assignment.
            </p>
          )}

          {selectedSession && (
            <section className="space-y-4 rounded-lg border p-5">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">
                  {ageLabel(selectedSession.league_age)} session
                </h2>
                <p className="text-sm text-muted-foreground">
                  {seasonName(selectedSession.season_id)} · Session #
                  {selectedSession.id}
                </p>
                <p className="text-sm">
                  Status: <strong>{selectedSession.status}</strong>
                </p>
              </div>

              {selectedSession.status === "setup" ? (
                <p className="text-sm text-muted-foreground">
                  This session is still being prepared. An administrator
                  must open it before evaluation work can begin.
                </p>
              ) : selectedSession.status !== "open" ? (
                <p className="text-sm text-muted-foreground">
                  This session is locked. Evaluation entry is not available.
                </p>
              ) : playerLoadError ? (
                <p role="alert" className="rounded-md border p-4 text-sm">
                  {playerLoadError}
                </p>
              ) : registrations.length === 0 ? (
                <div className="rounded-md border p-4">
                  <p className="font-medium">No eligible players yet</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    No registrations match this season and age with an eligible
                    registration status. Pending registrations remain eligible;
                    unpaid and UNKNOWN registrations are excluded.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  <p className="text-sm text-muted-foreground">
                    {registrations.length} eligible player
                    {registrations.length === 1 ? "" : "s"}. Save each
                    player's evaluation as a draft; saving does not submit it.
                  </p>

                  {registrations.map((registration) => {
                    const player = registration.players;
                    const evaluation =
                      evaluationByPlayerSeason.get(registration.id);
                    const evaluationId = evaluation?.id;

                    return (
                      <form
                        key={registration.id}
                        action={saveEvaluationDraft}
                        className="space-y-5 rounded-lg border p-4"
                      >
                        <input
                          type="hidden"
                          name="sessionId"
                          value={selectedSession.id}
                        />
                        <input
                          type="hidden"
                          name="playerSeasonId"
                          value={registration.id}
                        />

                        <div className="space-y-1">
                          <h3 className="text-lg font-semibold">
                            {player
                              ? `${player.last_name}, ${player.first_name}`
                              : `Player registration #${registration.id}`}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {registration.evaluation_number !== null
                              ? `Evaluation #${registration.evaluation_number}`
                              : "No evaluation number assigned"}
                            {player?.date_of_birth
                              ? ` · DOB ${player.date_of_birth}`
                              : ""}
                          </p>
                          {evaluation && (
                            <p className="text-xs text-muted-foreground">
                              Existing evaluation: {evaluation.status}
                            </p>
                          )}
                        </div>

                        <RatingInputs
                          categories={categories}
                          initialScores={Object.fromEntries(
                            categories.map((category) => {
                              const score =
                                evaluationId === undefined
                                  ? undefined
                                  : ratingByEvaluationAndCategory.get(
                                      `${evaluationId}:${category.id}`,
                                    );
                              return [category.code, score ?? null];
                            }),
                          )}
                        />

                        <fieldset className="space-y-3">
                          <legend className="font-medium">
                            Pitching and catching experience
                          </legend>
                          <div className="grid gap-4 sm:grid-cols-2">
                            {EXPERIENCE_QUESTIONS.map((question) => {
                              const savedAnswer =
                                evaluationId === undefined
                                  ? undefined
                                  : experienceByEvaluationAndQuestion.get(
                                      `${evaluationId}:${question.code}`,
                                    );

                              return (
                                <fieldset key={question.code} className="space-y-2 text-sm">
                                  <legend className="font-medium">
                                    {question.label}
                                  </legend>
                                  <div
                                    className="grid grid-cols-3 gap-2"
                                    role="group"
                                    aria-label={question.label}
                                  >
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
                                        <span className="flex min-h-12 items-center justify-center rounded-md border px-2 text-center font-medium transition-colors hover:bg-accent peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">
                                          {option.label}
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                </fieldset>
                              );
                            })}
                          </div>
                        </fieldset>

                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs text-muted-foreground">
                            Drafts remain editable until the session workflow
                            prevents further changes.
                          </p>
                          <button
                            type="submit"
                            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
                          >
                            Save draft
                          </button>
                        </div>
                      </form>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">My assigned sessions</h2>

            {sessions.length === 0 ? (
              <div className="rounded-lg border p-5">
                <p className="font-medium">No sessions assigned</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Contact your administrator to be assigned to an evaluation
                  session.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {OLDEST_TO_YOUNGEST.map((age) =>
                  sessions
                    .filter((session) => session.league_age === age)
                    .map((session) => (
                      <div
                        key={session.id}
                        className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <h3 className="font-semibold">Age {age}</h3>
                          <p className="text-sm text-muted-foreground">
                            {seasonName(session.season_id)} · Session #
                            {session.id}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="rounded-md border px-2 py-1 text-xs">
                            {session.status}
                          </span>
                          <Link
                            href={`/protected/evaluations?sessionId=${session.id}`}
                            className="inline-flex rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
                          >
                            View session
                          </Link>
                        </div>
                      </div>
                    )),
                )}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
