
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";

import { createClient } from "@/lib/supabase/server";

const OLDEST_TO_YOUNGEST = [16, 15, 14, 13, 12, 11, 10, 9, 8];

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

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function ProtectedPageContent() {
  await connection();

  const supabase = await createClient();

  const { data: claims, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claims?.claims) {
    redirect("/auth/login");
  }

  const { data: isAdmin, error: roleError } =
    await supabase.rpc("is_admin");

  const administrator = !roleError && isAdmin === true;

  const [sessionResult, seasonResult] = await Promise.all([
    supabase
      .from("evaluation_sessions")
      .select("id, season_id, league_age, status")
      .is("season_division_id", null)
      .order("season_id", { ascending: false })
      .order("league_age", { ascending: false }),
    supabase.from("seasons").select("id, name"),
  ]);

  const assignedSessions =
    (sessionResult.data ?? []) as AssignedSession[];
  const seasons = (seasonResult.data ?? []) as Season[];

  const seasonName = (seasonId: number) =>
    seasons.find((season) => season.id === seasonId)?.name ??
    `Season #${seasonId}`;

  return (
    <div className="flex w-full flex-1 flex-col gap-8">
      <header className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          RWCLL · Player Evaluations
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          Player Evaluations
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Manage player evaluations, review registration imports, and
          prepare for the draft. Evaluation access is limited to assigned
          evaluators and authorized administrators.
        </p>
      </header>

      {administrator ? (
        <>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">
              Evaluation workspace
            </h2>

            <div className="rounded-lg border p-5">
              <h3 className="font-semibold">Evaluation sessions</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Manage the nine age-based sessions, ordered from oldest
                to youngest: ages 16 through 8.
              </p>
              <Link
                href="/protected/sessions"
                className="mt-4 inline-flex rounded-md border px-4 py-2 text-sm font-medium"
              >
                Manage evaluation sessions
              </Link>
            </div>

            <div className="rounded-lg border p-5">
              <h3 className="font-semibold">Evaluator assignments</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Grant season-specific evaluator roles and assign
                evaluators to age sessions.
              </p>
              <Link
                href="/protected/assignments"
                className="mt-4 inline-flex rounded-md border px-4 py-2 text-sm font-medium"
              >
                Manage evaluator assignments
              </Link>
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-lg border p-5">
              <h3 className="font-semibold">Administrator evaluation review</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Track evaluation completion by season, age group, and evaluator; review missing players and core ratings.
              </p>
              <Link
                href="/protected/evaluation-review"
                className="mt-4 inline-flex rounded-md border px-4 py-2 text-sm font-medium"
              >
                Review evaluations
              </Link>

              <Link
                href="/protected/reports"
                className="mt-3 inline-flex rounded-md border px-4 py-2 text-sm font-medium"
              >
                Player reports and CSV export
              </Link>
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">
                Registration administration
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Preview and review registration imports before data
                enters the player and season-registration records.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-5">
                <h3 className="font-semibold">Sports Connect import</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Preview a registration CSV, check league-age
                  calculations, and stage rows for review.
                </p>
                <Link
                  href="/protected/import-preview"
                  className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  Open import preview
                </Link>
              </div>

              <div className="rounded-lg border p-5">
                <h3 className="font-semibold">Staged import review</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Inspect staged batches and review row-level flags
                  and administrator decisions.
                </p>
                <Link
                  href="/protected/import-batches"
                  className="mt-4 inline-flex rounded-md border px-4 py-2 text-sm font-medium"
                >
                  Review staged batches
                </Link>
              </div>
            </div>
          </section>
        </>
      ) : (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">
              My evaluation sessions
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Only sessions assigned to your account should appear here.
              Sessions are listed from oldest to youngest.
            </p>
          </div>

          {sessionResult.error ? (
            <p role="alert" className="rounded-lg border p-4 text-sm">
              Could not load your assigned sessions:{" "}
              {sessionResult.error.message}
            </p>
          ) : assignedSessions.length === 0 ? (
            <div className="rounded-lg border p-5">
              <p className="font-medium">
                No evaluation sessions assigned
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Ask your administrator to grant your season role and
                assign you to an evaluation session.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {OLDEST_TO_YOUNGEST.map((age) =>
                assignedSessions
                  .filter((session) => session.league_age === age)
                  .map((session) => (
                    <div
                      key={session.id}
                      className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <h3 className="font-semibold">
                          Age {session.league_age}
                        </h3>
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

          <Link
            href="/protected/evaluations"
            className="inline-flex rounded-md border px-4 py-2 text-sm font-medium"
          >
            Open evaluator workspace
          </Link>
        </section>
      )}

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Development workspace · Registration payment status and
        evaluation eligibility must be verified before players can
        be evaluated.
      </footer>
    </div>
  );
}

export default function ProtectedPage() {
  return (
    <Suspense
      fallback={
        <main className="w-full flex-1 p-4">
          Loading player evaluations…
        </main>
      }
    >
      <ProtectedPageContent />
    </Suspense>
  );
}
