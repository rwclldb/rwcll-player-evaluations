
import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  assignEvaluatorToSession,
  grantEvaluatorRole,
  removeEvaluatorFromSession,
  revokeEvaluatorRole,
} from "./actions";

type SearchParams = Promise<{
  message?: string;
  error?: string;
}>;

type Candidate = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  email_confirmed: boolean;
};

type EvaluatorRole = {
  id: number;
  user_id: string;
  role_name: string;
  season_id: number | null;
};

type EvaluationSession = {
  id: number;
  season_id: number;
  league_age: number | null;
  season_division_id: number | null;
  status: string;
};

type Assignment = {
  id: number;
  evaluation_session_id: number;
  evaluator_user_id: string;
  evaluator_type: string;
};

type Season = {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  is_closed: boolean;
};

const EVALUATOR_TYPES = [
  { value: "coach", label: "Coach" },
  { value: "independent_evaluator", label: "Independent evaluator" },
] as const;

const LEAGUE_AGES = [16, 15, 14, 13, 12, 11, 10, 9, 8];

function accountLabel(candidate: Candidate) {
  return (
    candidate.display_name?.trim() ||
    candidate.email ||
    candidate.user_id
  );
}

async function AssignmentsPageContent({
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
    redirect("/protected");
  }

  const [
    candidateResult,
    seasonResult,
    roleResult,
    sessionResult,
    assignmentResult,
  ] = await Promise.all([
    supabase.rpc("admin_list_evaluator_candidates"),
    supabase
      .from("seasons")
      .select("id, name, start_date, end_date, is_closed")
      .order("start_date", { ascending: false }),
    supabase
      .from("user_roles")
      .select("id, user_id, role_name, season_id"),
    supabase
      .from("evaluation_sessions")
      .select("id, season_id, league_age, season_division_id, status")
      .is("season_division_id", null)
      .order("season_id", { ascending: false })
      .order("league_age", { ascending: false }),
    supabase
      .from("evaluator_assignments")
      .select(
        "id, evaluation_session_id, evaluator_user_id, evaluator_type",
      ),
  ]);

  const candidates = (candidateResult.data ?? []) as Candidate[];
  const seasons = (seasonResult.data ?? []) as Season[];
  const roles = (roleResult.data ?? []) as EvaluatorRole[];
  const sessions = (sessionResult.data ?? []) as EvaluationSession[];
  const assignments = (assignmentResult.data ?? []) as Assignment[];

  const loadError =
    candidateResult.error?.message ??
    seasonResult.error?.message ??
    roleResult.error?.message ??
    sessionResult.error?.message ??
    assignmentResult.error?.message;

  return (
    <main className="w-full max-w-6xl space-y-8">
      <header className="space-y-2">
        <Link
          href="/protected"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to workspace
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">
          Evaluator assignments
        </h1>
        <p className="text-sm text-muted-foreground">
          Grant season-specific evaluator roles and assign evaluators to
          age-based sessions. Ages are listed from oldest to youngest.
          Assignments can only be changed while a session is in setup.
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

      {loadError ? (
        <p role="alert" className="rounded-md border p-4 text-sm">
          Could not load assignment data: {loadError}
        </p>
      ) : (
        <>
          <section className="space-y-3 rounded-lg border p-5">
            <h2 className="text-xl font-semibold">Registered accounts</h2>
            <p className="text-sm text-muted-foreground">
              {candidates.length} account(s) found. This page lists
              existing accounts; it does not create accounts or send
              invitations.
            </p>

            {candidates.length === 0 ? (
              <p className="text-sm">No registered accounts found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2 pr-4">Email</th>
                      <th className="py-2">Email confirmed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((candidate) => (
                      <tr
                        key={candidate.user_id}
                        className="border-b last:border-0"
                      >
                        <td className="py-3 pr-4">
                          {accountLabel(candidate)}
                        </td>
                        <td className="py-3 pr-4">
                          {candidate.email ?? "—"}
                        </td>
                        <td className="py-3">
                          {candidate.email_confirmed ? "Yes" : "No"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {seasons.length === 0 && (
            <p className="rounded-md border p-4 text-sm">
              No seasons found. Create a season before assigning evaluators.
            </p>
          )}

          {seasons.map((season) => {
            const seasonRoles = roles.filter(
              (role) =>
                role.season_id === season.id &&
                EVALUATOR_TYPES.some(
                  (type) => type.value === role.role_name,
                ),
            );

            const seasonSessions = sessions.filter(
              (session) =>
                session.season_id === season.id &&
                session.league_age !== null &&
                LEAGUE_AGES.includes(session.league_age),
            );

            return (
              <section
                key={season.id}
                className="space-y-5 rounded-lg border p-5"
              >
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold">{season.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {season.start_date} to {season.end_date}
                  </p>
                  <p className="text-sm">
                    Season status: {season.is_closed ? "Closed" : "Open"}
                  </p>
                </div>

                <section className="space-y-3">
                  <h3 className="font-semibold">Grant evaluator role</h3>

                  {season.is_closed ? (
                    <p className="text-sm text-muted-foreground">
                      This season is closed. Role changes are disabled.
                    </p>
                  ) : (
                    <form
                      action={grantEvaluatorRole}
                      className="flex flex-col gap-3 sm:flex-row sm:items-end"
                    >
                      <input
                        type="hidden"
                        name="seasonId"
                        value={season.id}
                      />

                      <label className="flex-1 space-y-1 text-sm">
                        <span className="block">Account</span>
                        <select
                          name="evaluatorUserId"
                          required
                          defaultValue=""
                          className="w-full rounded-md border bg-background px-3 py-2"
                        >
                          <option value="" disabled>
                            Select an account
                          </option>
                          {candidates.map((candidate) => (
                            <option
                              key={candidate.user_id}
                              value={candidate.user_id}
                            >
                              {accountLabel(candidate)}
                              {candidate.email
                                ? ` — ${candidate.email}`
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1 text-sm">
                        <span className="block">Role</span>
                        <select
                          name="roleName"
                          defaultValue="independent_evaluator"
                          className="w-full rounded-md border bg-background px-3 py-2"
                        >
                          {EVALUATOR_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <button
                        type="submit"
                        disabled={candidates.length === 0}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                      >
                        Grant role
                      </button>
                    </form>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="py-2 pr-3">Evaluator</th>
                          <th className="py-2 pr-3">Season role</th>
                          <th className="py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {seasonRoles.map((role) => {
                          const candidate = candidates.find(
                            (item) => item.user_id === role.user_id,
                          );
                          const type = EVALUATOR_TYPES.find(
                            (item) => item.value === role.role_name,
                          );

                          if (!type) return null;

                          return (
                            <tr
                              key={role.id}
                              className="border-b last:border-0"
                            >
                              <td className="py-3 pr-3">
                                {candidate
                                  ? accountLabel(candidate)
                                  : role.user_id}
                                {candidate?.email && (
                                  <div className="text-xs text-muted-foreground">
                                    {candidate.email}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 pr-3">{type.label}</td>
                              <td className="py-3">
                                {!season.is_closed ? (
                                  <form action={revokeEvaluatorRole}>
                                    <input
                                      type="hidden"
                                      name="seasonId"
                                      value={season.id}
                                    />
                                    <input
                                      type="hidden"
                                      name="evaluatorUserId"
                                      value={role.user_id}
                                    />
                                    <input
                                      type="hidden"
                                      name="roleName"
                                      value={role.role_name}
                                    />
                                    <button
                                      type="submit"
                                      className="rounded-md border px-3 py-1.5 hover:bg-accent"
                                    >
                                      Revoke role
                                    </button>
                                  </form>
                                ) : (
                                  "Season closed"
                                )}
                              </td>
                            </tr>
                          );
                        })}

                        {seasonRoles.length === 0 && (
                          <tr>
                            <td
                              colSpan={3}
                              className="py-3 text-muted-foreground"
                            >
                              No evaluator roles granted for this season yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="font-semibold">Age-session assignments</h3>
                  <p className="text-sm text-muted-foreground">
                    Assignments require the matching season role and can
                    only be changed while the session is in setup.
                  </p>

                  {LEAGUE_AGES.map((age) => {
                    const session = seasonSessions.find(
                      (item) => item.league_age === age,
                    );

                    if (!session) {
                      return (
                        <div
                          key={age}
                          className="rounded-md border p-3 text-sm"
                        >
                          <strong>Age {age}:</strong> No session found.
                        </div>
                      );
                    }

                    const sessionAssignments = assignments.filter(
                      (assignment) =>
                        assignment.evaluation_session_id === session.id,
                    );

                    const assignedIds = new Set(
                      sessionAssignments.map(
                        (assignment) => assignment.evaluator_user_id,
                      ),
                    );

                    const eligibleRoles = seasonRoles.filter(
                      (role) =>
                        role.role_name === "coach" ||
                        role.role_name === "independent_evaluator",
                    );

                    return (
                      <div
                        key={session.id}
                        className="space-y-3 rounded-md border p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="font-medium">
                            Age {age} · Session #{session.id}
                          </h4>
                          <span className="rounded-md border px-2 py-1 text-xs">
                            {session.status}
                          </span>
                        </div>

                        {sessionAssignments.length > 0 ? (
                          <ul className="space-y-2">
                            {sessionAssignments.map((assignment) => {
                              const candidate = candidates.find(
                                (item) =>
                                  item.user_id ===
                                  assignment.evaluator_user_id,
                              );

                              const typeLabel =
                                EVALUATOR_TYPES.find(
                                  (type) =>
                                    type.value === assignment.evaluator_type,
                                )?.label ?? assignment.evaluator_type;

                              return (
                                <li
                                  key={assignment.id}
                                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                                >
                                  <span>
                                    {candidate
                                      ? accountLabel(candidate)
                                      : assignment.evaluator_user_id}
                                    {" — "}
                                    {typeLabel}
                                  </span>

                                  {session.status === "setup" &&
                                  !season.is_closed ? (
                                    <form action={removeEvaluatorFromSession}>
                                      <input
                                        type="hidden"
                                        name="assignmentId"
                                        value={assignment.id}
                                      />
                                      <button
                                        type="submit"
                                        className="rounded-md border px-3 py-1.5 hover:bg-accent"
                                      >
                                        Remove
                                      </button>
                                    </form>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No evaluators assigned.
                          </p>
                        )}

                        {session.status === "setup" && !season.is_closed ? (
                          <form
                            action={assignEvaluatorToSession}
                            className="flex flex-col gap-3 sm:flex-row sm:items-end"
                          >
                            <input
                              type="hidden"
                              name="sessionId"
                              value={session.id}
                            />

                            <label className="flex-1 space-y-1 text-sm">
                              <span className="block">Evaluator</span>
                              <select
                                name="evaluatorUserId"
                                required
                                defaultValue=""
                                className="w-full rounded-md border bg-background px-3 py-2"
                              >
                                <option value="" disabled>
                                  Select an eligible evaluator
                                </option>
                                {eligibleRoles
                                  .filter(
                                    (role) =>
                                      !assignedIds.has(role.user_id),
                                  )
                                  .map((role) => {
                                    const candidate = candidates.find(
                                      (item) =>
                                        item.user_id === role.user_id,
                                    );

                                    return (
                                      <option
                                        key={`${role.user_id}-${role.role_name}`}
                                        value={role.user_id}
                                      >
                                        {candidate
                                          ? accountLabel(candidate)
                                          : role.user_id}
                                        {" — "}
                                        {role.role_name === "coach"
                                          ? "Coach"
                                          : "Independent evaluator"}
                                      </option>
                                    );
                                  })}
                              </select>
                            </label>

                            <label className="space-y-1 text-sm">
                              <span className="block">Assignment type</span>
                              <select
                                name="evaluatorType"
                                defaultValue="independent_evaluator"
                                className="w-full rounded-md border bg-background px-3 py-2"
                              >
                                {EVALUATOR_TYPES.map((type) => (
                                  <option key={type.value} value={type.value}>
                                    {type.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <button
                              type="submit"
                              disabled={
                                eligibleRoles.filter(
                                  (role) =>
                                    !assignedIds.has(role.user_id),
                                ).length === 0
                              }
                              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                            >
                              Assign
                            </button>
                          </form>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Assignments are locked because the session is
                            not in setup or the season is closed.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </section>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}

export default function AssignmentsPage(props: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense
      fallback={
        <main className="w-full max-w-6xl p-4">
          Loading evaluator assignments…
        </main>
      }
    >
      <AssignmentsPageContent {...props} />
    </Suspense>
  );
}
