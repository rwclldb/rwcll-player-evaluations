
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  advanceEvaluationSessionStatus,
  createMissingAgeSessions,
} from "./actions";

const LEAGUE_AGES = [16, 15, 14, 13, 12, 11, 10, 9, 8];

type SearchParams = Promise<{
  message?: string;
  error?: string;
}>;

async function EvaluationSessionsPageContent({
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

  const { data: isAdmin, error: roleError } =
    await supabase.rpc("is_admin");

  if (roleError || isAdmin !== true) {
    return (
      <main className="w-full max-w-4xl space-y-4">
        <h1 className="text-2xl font-bold">Evaluation sessions</h1>
        <p className="rounded-md border p-4 text-sm">
          Administrator access is required to manage evaluation sessions.
        </p>
        <Link className="underline" href="/protected">
          Return to workspace
        </Link>
      </main>
    );
  }

  const { data: seasons, error: seasonsError } = await supabase
    .from("seasons")
    .select("id, name, start_date, end_date, is_closed")
    .order("start_date", { ascending: false });

  const { data: sessions, error: sessionsError } = await supabase
    .from("evaluation_sessions")
    .select("id, season_id, league_age, season_division_id, status, created_at")
    .is("season_division_id", null)
    .order("season_id", { ascending: false })
    .order("league_age", { ascending: false });

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
          Evaluation sessions
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage one session per Little League age. Sessions start in setup
          and can be opened or locked when appropriate.
        </p>
      </header>

      {params.message && (
        <p role="status" className="rounded-md border p-3 text-sm">
          {params.message}
        </p>
      )}

      {params.error && (
        <p
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm"
        >
          {params.error}
        </p>
      )}

      {(seasonsError || sessionsError) && (
        <p
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm"
        >
          Could not load session data:{" "}
          {seasonsError?.message ?? sessionsError?.message}
        </p>
      )}

      {!seasonsError && !sessionsError && (seasons ?? []).length === 0 && (
        <p className="rounded-md border p-4 text-sm">
          No seasons were found. Create a season before setting up evaluation
          sessions.
        </p>
      )}

      {!seasonsError &&
        !sessionsError &&
        (seasons ?? []).map((season) => {
          const seasonSessions = (sessions ?? []).filter(
            (session) => session.season_id === season.id,
          );

          const ageSessions = new Map(
            seasonSessions
              .filter(
                (session) =>
                  session.league_age !== null &&
                  LEAGUE_AGES.includes(session.league_age),
              )
              .map((session) => [session.league_age, session]),
          );

          const missingCount = LEAGUE_AGES.filter(
            (age) => !ageSessions.has(age),
          ).length;

          return (
            <section
              key={season.id}
              className="space-y-4 rounded-lg border p-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold">{season.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {season.start_date} to {season.end_date}
                  </p>
                  <p className="text-sm">
                    Season status:{" "}
                    <span className="font-medium">
                      {season.is_closed ? "Closed" : "Open"}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {9 - missingCount} of 9 age sessions present
                  </p>
                </div>

                <form action={createMissingAgeSessions}>
                  <input
                    type="hidden"
                    name="seasonId"
                    value={season.id}
                  />
                  <button
                    type="submit"
                    disabled={season.is_closed || missingCount === 0}
                    className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {missingCount === 0
                      ? "All age sessions exist"
                      : `Create ${missingCount} missing session${missingCount === 1 ? "" : "s"}`}
                  </button>
                </form>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 pr-3 font-medium">League age</th>
                      <th className="py-2 pr-3 font-medium">Session ID</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LEAGUE_AGES.map((age) => {
                      const session = ageSessions.get(age);

                      return (
                        <tr key={age} className="border-b last:border-0">
                          <td className="py-3 pr-3">{age}</td>
                          <td className="py-3 pr-3">
                            {session ? session.id : "—"}
                          </td>
                          <td className="py-3 pr-3">
                            {session ? session.status : "Not created"}
                          </td>
                          <td className="py-3">
                            {session &&
                              !season.is_closed &&
                              session.status !== "locked" && (
                                <form action={advanceEvaluationSessionStatus}>
                                  <input
                                    type="hidden"
                                    name="sessionId"
                                    value={session.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="status"
                                    value={
                                      session.status === "setup"
                                        ? "open"
                                        : "locked"
                                    }
                                  />
                                  <button
                                    type="submit"
                                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                                  >
                                    {session.status === "setup"
                                      ? "Open session"
                                      : "Lock session"}
                                  </button>
                                </form>
                              )}
                            {session?.status === "locked" && (
                              <span className="text-muted-foreground">
                                Locked permanently
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

      <p className="text-xs text-muted-foreground">
        Creating sessions does not add players or assign evaluators. A locked
        session cannot be reopened. Only open a session when its setup and
        evaluator access are ready.
      </p>
    </main>
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
        <main className="w-full max-w-4xl p-4">
          Loading evaluation sessions…
        </main>
      }
    >
      <EvaluationSessionsPageContent searchParams={searchParams} />
    </Suspense>
  );
}
