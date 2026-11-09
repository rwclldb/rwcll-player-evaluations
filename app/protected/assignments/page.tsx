import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  assignEvaluatorToSession,
  grantEvaluatorRole,
  removeEvaluatorFromSession,
  revokeEvaluatorRole,
} from "./actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Users, 
  ShieldAlert, 
  UserCheck, 
  ArrowLeft,
  UserPlus,
  Trash2,
  CheckCircle2,
  Layers,
  Award
} from "lucide-react";

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
  return candidate.display_name?.trim() || candidate.email || candidate.user_id;
}

async function AssignmentsContent({
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
    return redirect("/protected");
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
    supabase.from("user_roles").select("id, user_id, role_name, season_id"),
    supabase
      .from("evaluation_sessions")
      .select("id, season_id, league_age, season_division_id, status")
      .is("season_division_id", null)
      .order("season_id", { ascending: false })
      .order("league_age", { ascending: false }),
    supabase
      .from("evaluator_assignments")
      .select("id, evaluation_session_id, evaluator_user_id, evaluator_type"),
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
    <div className="space-y-8">
      {/* Header */}
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
            <Users className="h-7 w-7 text-emerald-700 dark:text-emerald-400" />
            Evaluator Assignments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Grant season-specific evaluator roles and assign evaluators to age-based sessions.
          </p>
        </div>
      </div>

      {/* Action Notifications */}
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

      {loadError ? (
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
          Could not load assignment data: {loadError}
        </div>
      ) : (
        <>
          {/* Registered Accounts Card */}
          <Card className="border-border bg-card">
            <CardHeader className="py-4 border-b border-border/50">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                Registered Accounts ({candidates.length})
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Accounts available for evaluator roles.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {candidates.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-600 dark:text-slate-400 italic">
                  No registered accounts found.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-background text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
                      <tr>
                        <th className="px-4 py-3">Name / User ID</th>
                        <th className="px-4 py-3">Email</th>
                        <th className="px-4 py-3 text-center">Email Confirmed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {candidates.map((candidate) => (
                        <tr key={candidate.user_id} className="hover:bg-accent/50 transition-colors">
                          <td className="px-4 py-3 font-medium text-foreground text-xs font-mono">
                            {accountLabel(candidate)}
                          </td>
                          <td className="px-4 py-3 text-xs font-mono text-slate-700 dark:text-slate-300">
                            {candidate.email ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {candidate.email_confirmed ? (
                              <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-mono">
                                Confirmed
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-slate-700 bg-slate-800/50 text-muted-foreground text-xs font-mono">
                                Pending
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {seasons.length === 0 && (
            <Card className="border-border bg-card p-6 text-center text-xs text-muted-foreground">
              No seasons found. Create a season before assigning evaluators.
            </Card>
          )}

          {/* Seasons Management Blocks */}
          {seasons.map((season) => {
            const seasonRoles = roles.filter(
              (role) =>
                role.season_id === season.id &&
                EVALUATOR_TYPES.some((type) => type.value === role.role_name)
            );

            const seasonSessions = sessions.filter(
              (session) =>
                session.season_id === season.id &&
                session.league_age !== null &&
                LEAGUE_AGES.includes(session.league_age)
            );

            return (
              <Card key={season.id} className="border-border bg-card">
                <CardHeader className="border-b border-border/50 py-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                        <Layers className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                        {season.name}
                      </CardTitle>
                      <CardDescription className="text-xs text-muted-foreground font-mono mt-1">
                        {season.start_date} to {season.end_date} &bull;{" "}
                        <span className={season.is_closed ? "text-muted-foreground" : "text-emerald-700 dark:text-emerald-400 font-semibold"}>
                          {season.is_closed ? "Closed" : "Open"}
                        </span>
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-6 pt-6">
                  {/* Grant Evaluator Role Section */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                      <Award className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> Grant Season Evaluator Role
                    </h3>

                    {season.is_closed ? (
                      <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
                        This season is closed. Role changes are disabled.
                      </p>
                    ) : (
                      <form action={grantEvaluatorRole} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end bg-background p-4 rounded-lg border border-border">
                        <input type="hidden" name="seasonId" value={season.id} />

                        <div className="space-y-1">
                          <label className="text-xs font-mono text-muted-foreground block">Select Account</label>
                          <select
                            name="evaluatorUserId"
                            required
                            defaultValue=""
                            className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:outline-none focus:border-emerald-500"
                          >
                            <option value="" disabled>
                              Select an account
                            </option>
                            {candidates.map((candidate) => (
                              <option key={candidate.user_id} value={candidate.user_id}>
                                {accountLabel(candidate)}
                                {candidate.email ? ` — ${candidate.email}` : ""}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-mono text-muted-foreground block">Role</label>
                          <select
                            name="roleName"
                            defaultValue="independent_evaluator"
                            className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:outline-none focus:border-emerald-500"
                          >
                            {EVALUATOR_TYPES.map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <Button
                          type="submit"
                          disabled={candidates.length === 0}
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-500 text-foreground text-xs h-9"
                        >
                          <UserPlus className="h-3.5 w-3.5 mr-1" /> Grant Role
                        </Button>
                      </form>
                    )}

                    {/* Roles Table */}
                    <div className="overflow-x-auto rounded-md border border-border">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-background text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
                          <tr>
                            <th className="px-4 py-3">Evaluator</th>
                            <th className="px-4 py-3">Season Role</th>
                            <th className="px-4 py-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {seasonRoles.map((role) => {
                            const candidate = candidates.find(
                              (item) => item.user_id === role.user_id
                            );
                            const type = EVALUATOR_TYPES.find(
                              (item) => item.value === role.role_name
                            );

                            if (!type) return null;

                            return (
                              <tr key={role.id} className="hover:bg-accent/50 transition-colors">
                                <td className="px-4 py-3 font-medium text-foreground text-xs">
                                  {candidate ? accountLabel(candidate) : role.user_id}
                                  {candidate?.email && (
                                    <div className="text-[11px] text-muted-foreground font-mono">
                                      {candidate.email}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-xs font-mono">
                                  <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                                    {type.label}
                                  </Badge>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  {!season.is_closed ? (
                                    <form action={revokeEvaluatorRole} className="inline-block">
                                      <input type="hidden" name="seasonId" value={season.id} />
                                      <input type="hidden" name="evaluatorUserId" value={role.user_id} />
                                      <input type="hidden" name="roleName" value={role.role_name} />
                                      <Button
                                        type="submit"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 text-xs border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300"
                                      >
                                        <Trash2 className="h-3 w-3 mr-1" /> Revoke Role
                                      </Button>
                                    </form>
                                  ) : (
                                    <span className="text-xs font-mono text-slate-600 dark:text-slate-400">Season closed</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}

                          {seasonRoles.length === 0 && (
                            <tr>
                              <td colSpan={3} className="px-4 py-4 text-center text-xs text-slate-600 dark:text-slate-400 italic">
                                No evaluator roles granted for this season yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Age-Session Assignments Section */}
                  <div className="space-y-4 pt-4 border-t border-border">
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                      <Users className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> Age-Session Assignments
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Assignments require matching season role and can only be updated while the session is in setup.
                    </p>

                    <div className="space-y-3">
                      {LEAGUE_AGES.map((age) => {
                        const session = seasonSessions.find(
                          (item) => item.league_age === age
                        );

                        if (!session) {
                          return (
                            <div key={age} className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground font-mono">
                              <strong>Age {age}:</strong> No session found.
                            </div>
                          );
                        }

                        const sessionAssignments = assignments.filter(
                          (assignment) => assignment.evaluation_session_id === session.id
                        );

                        const assignedIds = new Set(
                          sessionAssignments.map((assignment) => assignment.evaluator_user_id)
                        );

                        const eligibleRoles = seasonRoles.filter(
                          (role) =>
                            role.role_name === "coach" ||
                            role.role_name === "independent_evaluator"
                        );

                        return (
                          <div key={session.id} className="rounded-lg border border-border bg-background p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-bold text-foreground font-mono">
                                Age {age} &bull; Session #{session.id}
                              </h4>
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
                            </div>

                            {sessionAssignments.length > 0 ? (
                              <ul className="space-y-2">
                                {sessionAssignments.map((assignment) => {
                                  const candidate = candidates.find(
                                    (item) => item.user_id === assignment.evaluator_user_id
                                  );

                                  const typeLabel =
                                    EVALUATOR_TYPES.find(
                                      (type) => type.value === assignment.evaluator_type
                                    )?.label ?? assignment.evaluator_type;

                                  return (
                                    <li
                                      key={assignment.id}
                                      className="flex items-center justify-between text-xs bg-card p-2.5 rounded border border-border"
                                    >
                                      <span className="text-foreground font-mono">
                                        {candidate ? accountLabel(candidate) : assignment.evaluator_user_id}
                                        {" — "}
                                        <span className="text-emerald-700 dark:text-emerald-400">{typeLabel}</span>
                                      </span>

                                      {session.status === "setup" && !season.is_closed ? (
                                        <form action={removeEvaluatorFromSession}>
                                          <input type="hidden" name="assignmentId" value={assignment.id} />
                                          <Button
                                            type="submit"
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-2 text-xs text-rose-700 dark:text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                                          >
                                            Remove
                                          </Button>
                                        </form>
                                      ) : null}
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <p className="text-xs text-slate-600 dark:text-slate-400 italic">No evaluators assigned.</p>
                            )}

                            {session.status === "setup" && !season.is_closed ? (
                              <form action={assignEvaluatorToSession} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end pt-2">
                                <input type="hidden" name="sessionId" value={session.id} />

                                <div className="space-y-1">
                                  <label className="text-[11px] font-mono text-muted-foreground block">Evaluator</label>
                                  <select
                                    name="evaluatorUserId"
                                    required
                                    defaultValue=""
                                    className="w-full rounded border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-emerald-500"
                                  >
                                    <option value="" disabled>
                                      Select an eligible evaluator
                                    </option>
                                    {eligibleRoles
                                      .filter((role) => !assignedIds.has(role.user_id))
                                      .map((role) => {
                                        const candidate = candidates.find(
                                          (item) => item.user_id === role.user_id
                                        );

                                        return (
                                          <option key={`${role.user_id}-${role.role_name}`} value={role.user_id}>
                                            {candidate ? accountLabel(candidate) : role.user_id}
                                            {" — "}
                                            {role.role_name === "coach" ? "Coach" : "Independent evaluator"}
                                          </option>
                                        );
                                      })}
                                  </select>
                                </div>

                                <div className="space-y-1">
                                  <label className="text-[11px] font-mono text-muted-foreground block">Assignment Type</label>
                                  <select
                                    name="evaluatorType"
                                    defaultValue="independent_evaluator"
                                    className="w-full rounded border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-emerald-500"
                                  >
                                    {EVALUATOR_TYPES.map((type) => (
                                      <option key={type.value} value={type.value}>
                                        {type.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <Button
                                  type="submit"
                                  disabled={
                                    eligibleRoles.filter((role) => !assignedIds.has(role.user_id)).length === 0
                                  }
                                  size="sm"
                                  className="bg-emerald-600 hover:bg-emerald-500 text-foreground text-xs h-8"
                                >
                                  Assign
                                </Button>
                              </form>
                            ) : (
                              <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
                                Assignments are locked because the session is not in setup or the season is closed.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

export default function AssignmentsPage(props: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense
      fallback={
        <div className="h-96 w-full rounded-lg border border-border bg-card animate-pulse" />
      }
    >
      <AssignmentsContent {...props} />
    </Suspense>
  );
}