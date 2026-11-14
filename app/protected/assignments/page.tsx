import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { applyDivisionAssignments, assignEvaluatorToSession, removeEvaluatorFromSession, setPersonAgeGroups } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, ArrowLeft, X } from "lucide-react";

// Age-group assignments only. Accounts and season roles live on the People page.
type SearchParams = Promise<{ season?: string; view?: string; person?: string; message?: string; error?: string }>;

type Candidate = { user_id: string; email: string | null; display_name: string | null; email_confirmed: boolean };
type RoleRow = { id: number; user_id: string; role_name: string; season_id: number | null };
type Session = { id: number; season_id: number; league_age: number | null; status: string };
type Assignment = { id: number; evaluation_session_id: number; evaluator_user_id: string; evaluator_type: string };
type Season = { id: number; name: string; start_date: string | null; is_closed: boolean };
type PreviewRow = { user_id: string; coach_name: string | null; email: string; league_age: number; divisions: string; session_id: number | null; session_status: string | null; already_assigned: boolean };
type DivisionRef = { name: string; sort_order: number };

const AGES = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const ROLE_LABEL: Record<string, string> = { coach: "Coach", independent_evaluator: "Evaluator" };
const STATUS_LABEL: Record<string, string> = { setup: "Setup", open: "Open", locked: "Locked" };
const select = "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground";

const label = (c: Candidate | undefined, id: string) => c?.display_name?.trim() || c?.email || id;

async function AssignmentsContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");

  const [candidateResult, seasonResult, roleResult, sessionResult, assignmentResult] = await Promise.all([
    supabase.rpc("admin_list_evaluator_candidates"),
    supabase.from("seasons").select("id, name, start_date, is_closed").order("start_date", { ascending: false }),
    supabase.from("user_roles").select("id, user_id, role_name, season_id").in("role_name", ["coach", "independent_evaluator"]),
    supabase.from("evaluation_sessions").select("id, season_id, league_age, status").is("season_division_id", null),
    supabase.from("evaluator_assignments").select("id, evaluation_session_id, evaluator_user_id, evaluator_type"),
  ]);
  const loadError = [candidateResult, seasonResult, roleResult, sessionResult, assignmentResult].find((r) => r.error)?.error?.message;

  const candidates = (candidateResult.data ?? []) as Candidate[];
  const seasons = (seasonResult.data ?? []) as Season[];
  const season = seasons.find((s) => String(s.id) === params.season) ?? seasons.find((s) => !s.is_closed) ?? seasons[0];
  const view = params.view === "person" ? "person" : params.view === "divisions" ? "divisions" : "age";

  // Coaches' divisions and the assignments they suggest.
  const [coachDivisionResult, previewResult] = season
    ? await Promise.all([
        supabase.from("coach_divisions").select("user_id, divisions(name, sort_order)").eq("season_id", season.id),
        supabase.rpc("division_assignment_preview", { p_season_id: season.id }),
      ])
    : [null, null];
  const divisionNames = new Map<string, string[]>();
  for (const r of (coachDivisionResult?.data ?? []) as { user_id: string; divisions: DivisionRef | DivisionRef[] | null }[]) {
    const d = Array.isArray(r.divisions) ? r.divisions[0] : r.divisions;
    if (d) divisionNames.set(r.user_id, [...(divisionNames.get(r.user_id) ?? []), d.name]);
  }
  const preview = (previewResult?.data ?? []) as PreviewRow[];
  const previewError = previewResult?.error?.message;
  const candidateById = new Map(candidates.map((c) => [c.user_id, c]));

  const seasonRoles = ((roleResult.data ?? []) as RoleRow[])
    .filter((r) => r.season_id === season?.id)
    .sort((a, b) => label(candidateById.get(a.user_id), a.user_id).localeCompare(label(candidateById.get(b.user_id), b.user_id)));
  const sessionByAge = new Map(
    ((sessionResult.data ?? []) as Session[]).filter((s) => s.season_id === season?.id && s.league_age !== null).map((s) => [s.league_age as number, s]),
  );
  const assignments = (assignmentResult.data ?? []) as Assignment[];
  const assignedTo = (sessionId: number | undefined) => assignments.filter((a) => a.evaluation_session_id === sessionId);
  const agesFor = (userId: string) => AGES.filter((age) => assignedTo(sessionByAge.get(age)?.id).some((a) => a.evaluator_user_id === userId));

  const closed = Boolean(season?.is_closed);
  const href = (next: Record<string, string | undefined>) => {
    const q = new URLSearchParams({ season: String(season?.id ?? ""), view, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as Record<string, string> });
    return `/protected/assignments?${q.toString()}`;
  };
  const tab = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-sm font-medium ${active ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-card text-foreground hover:bg-accent"}`;
  const person = seasonRoles.find((r) => r.user_id === params.person);
  // "Avery Smith (AA, Juniors)" for coaches with divisions.
  const who = (userId: string) => {
    const d = divisionNames.get(userId);
    return `${label(candidateById.get(userId), userId)}${d?.length ? ` (${d.join(", ")})` : ""}`;
  };
  const willAdd = (p: PreviewRow) => p.session_id !== null && p.session_status === "setup" && !p.already_assigned;
  const toAdd = preview.filter(willAdd);
  const previewCoaches = [...new Set(preview.map((p) => p.user_id))];
  const coachesWithoutDivisions = seasonRoles.filter((r) => r.role_name === "coach" && !divisionNames.has(r.user_id));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> Roadmap</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <Users className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> Age Group Assignments
        </h1>
        <p className="text-sm text-muted-foreground">
          Choose which age groups each coach and evaluator scores. People need a coach or evaluator role for the season first: add
          accounts and roles on the <Link href="/protected/people" className="underline">People</Link> page. Assignments can change only
          while an age group is in Setup.
        </p>
      </div>

      {params.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{params.message}</div>}
      {params.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{params.error}</div>}
      {loadError && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">Could not load assignments: {loadError}</div>}

      {!season ? (
        <p className="text-sm text-muted-foreground">No seasons yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <form action="/protected/assignments" className="flex items-end gap-2">
              <input type="hidden" name="view" value={view} />
              <label className="text-xs text-muted-foreground">Season
                <select name="season" defaultValue={season.id} className={`${select} mt-1 block`}>
                  {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_closed ? " (closed)" : ""}</option>)}
                </select>
              </label>
              <Button type="submit" variant="outline" className="h-9">Show</Button>
            </form>
            <nav className="flex gap-2" aria-label="View">
              <Link href={href({ view: "age", person: undefined })} className={tab(view === "age")}>By age group</Link>
              <Link href={href({ view: "person" })} className={tab(view === "person")}>By person</Link>
              <Link href={href({ view: "divisions", person: undefined })} className={tab(view === "divisions")}>
                From divisions
                {toAdd.length > 0 && !closed && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-xs text-white">{toAdd.length}</span>}
              </Link>
            </nav>
          </div>

          {closed && <p className="text-sm text-muted-foreground">{season.name} is closed. Assignments are shown read-only.</p>}
          {seasonRoles.length === 0 && (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              Nobody has a coach or evaluator role in {season.name} yet. Add roles on the <Link href="/protected/people" className="underline">People</Link> page.
            </p>
          )}

          {/* ===== By age group ===== */}
          {view === "age" && (
            <div className="grid gap-3 md:grid-cols-2">
              {AGES.map((age) => {
                const session = sessionByAge.get(age);
                if (!session) {
                  return (
                    <section key={age} className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
                      <strong className="text-foreground">Age {age}</strong>: no session yet. Create it on the <Link href="/protected/sessions" className="underline">Sessions</Link> page.
                    </section>
                  );
                }
                const here = assignedTo(session.id);
                const editable = session.status === "setup" && !closed;
                const available = seasonRoles.filter((r) => !here.some((a) => a.evaluator_user_id === r.user_id));
                return (
                  <section key={age} className="space-y-2 rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-bold text-foreground">Age {age}</h2>
                      <Badge variant="outline" className="text-xs">{STATUS_LABEL[session.status] ?? session.status}</Badge>
                    </div>
                    {here.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nobody assigned yet.</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1">
                        {here.map((a) => (
                          <li key={a.id}>
                            {editable ? (
                              <form action={removeEvaluatorFromSession} className="inline-flex">
                                <input type="hidden" name="assignmentId" value={a.id} />
                                <button type="submit" title="Remove from this age group"
                                  className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:border-rose-500">
                                  {who(a.evaluator_user_id)}
                                  <span className="text-muted-foreground">· {ROLE_LABEL[a.evaluator_type]}</span>
                                  <X className="h-3 w-3" />
                                </button>
                              </form>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground">
                                {who(a.evaluator_user_id)}
                                <span className="text-muted-foreground">· {ROLE_LABEL[a.evaluator_type]}</span>
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {editable && available.length > 0 && (
                      <form action={assignEvaluatorToSession} className="flex gap-2 border-t border-border pt-2">
                        <input type="hidden" name="sessionId" value={session.id} />
                        <select name="evaluator" required defaultValue="" aria-label={`Add someone to age ${age}`} className={`${select} min-w-0 flex-1 border-dashed text-xs`}>
                          <option value="" disabled>+ Add a coach or evaluator…</option>
                          {available.map((r) => (
                            <option key={r.user_id} value={`${r.user_id}|${r.role_name}`}>
                              {who(r.user_id)} · {ROLE_LABEL[r.role_name]}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" variant="outline" size="sm" className="h-9">Add</Button>
                      </form>
                    )}
                    {!editable && !closed && <p className="text-[11px] text-muted-foreground">Locked for changes: this age group is past Setup.</p>}
                  </section>
                );
              })}
            </div>
          )}

          {/* ===== From divisions ===== */}
          {view === "divisions" && (
            <div className="space-y-4">
              <section className="rounded-lg border border-border bg-card p-4 text-sm">
                <p className="text-muted-foreground">
                  Each coach is suggested for every age group their divisions cover. Division ages are set on the{" "}
                  <Link href="/protected/sessions" className="underline">Sessions</Link> page (Season-wide settings). A coach&apos;s divisions come
                  from the people import or the <Link href="/protected/people" className="underline">People</Link> page. This only adds:
                  nothing is removed, age groups past Setup are skipped, and running it again changes nothing.
                </p>
                {previewError && <p role="alert" className="mt-2 text-rose-700 dark:text-rose-300">Could not build the preview: {previewError}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <form action={applyDivisionAssignments}>
                    <input type="hidden" name="seasonId" value={season.id} />
                    <Button type="submit" disabled={closed || toAdd.length === 0} className="bg-emerald-600 text-white hover:bg-emerald-500">
                      Add {toAdd.length} assignment{toAdd.length === 1 ? "" : "s"}
                    </Button>
                  </form>
                  <span className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-800 dark:text-emerald-300">+ will be added</span>
                    <span className="rounded bg-muted px-1.5 py-0.5">already assigned</span>
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-800 dark:text-amber-300">skipped (past Setup or no session)</span>
                  </span>
                </div>
              </section>

              {previewCoaches.length === 0 ? (
                <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                  No coach has a division in {season.name} yet. Import coaches with a Division Name column, or set divisions on the People page.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
                  {previewCoaches.map((userId) => (
                    <li key={userId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="min-w-56 flex-1 font-medium text-foreground">{who(userId)}</span>
                      <span className="flex flex-wrap gap-1">
                        {preview.filter((p) => p.user_id === userId).map((p) => {
                          const add = willAdd(p);
                          const cls = add ? "bg-emerald-500/15 font-semibold text-emerald-800 dark:text-emerald-300"
                            : p.already_assigned ? "bg-muted text-muted-foreground"
                            : "bg-amber-500/15 text-amber-800 dark:text-amber-300";
                          const why = add ? "Will be added" : p.already_assigned ? "Already assigned" : p.session_id === null ? "No session for this age" : "Age group is past Setup";
                          return (
                            <span key={p.league_age} title={`Age ${p.league_age}: ${why} (${p.divisions})`} className={`rounded px-1.5 py-0.5 text-xs ${cls}`}>
                              {add ? "+" : ""}Age {p.league_age}
                            </span>
                          );
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {coachesWithoutDivisions.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Coaches with no division yet: {coachesWithoutDivisions.map((r) => label(candidateById.get(r.user_id), r.user_id)).join(", ")}.
                </p>
              )}
            </div>
          )}

          {/* ===== By person ===== */}
          {view === "person" && seasonRoles.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-foreground">Who scores which age groups</h2>
                <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
                  {seasonRoles.map((r) => {
                    const ages = agesFor(r.user_id);
                    const selected = r.user_id === person?.user_id;
                    return (
                      <li key={r.user_id}>
                        <Link href={href({ view: "person", person: r.user_id })}
                          className={`flex flex-wrap items-center gap-2 px-3 py-2 hover:bg-accent ${selected ? "bg-emerald-500/10" : ""}`}>
                          <span className="min-w-40 flex-1 font-medium text-foreground">{who(r.user_id)}</span>
                          <span className="text-xs text-muted-foreground">{ROLE_LABEL[r.role_name]}</span>
                          <span className="text-xs text-foreground">{ages.length ? `Ages ${ages.join(", ")}` : <em className="text-muted-foreground">no age groups</em>}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="space-y-3 rounded-lg border border-border bg-card p-4">
                {!person ? (
                  <p className="text-sm text-muted-foreground">Pick a person on the left to choose several age groups at once.</p>
                ) : (
                  <form action={setPersonAgeGroups} className="space-y-3">
                    <input type="hidden" name="seasonId" value={season.id} />
                    <input type="hidden" name="personId" value={person.user_id} />
                    <h2 className="text-sm font-semibold text-foreground">
                      {who(person.user_id)}{" "}
                      <span className="font-normal text-muted-foreground">({ROLE_LABEL[person.role_name]}, {season.name})</span>
                    </h2>
                    <p className="text-xs text-muted-foreground">Tick every age group this person scores, then save. Age groups past Setup can&apos;t change and are greyed out.</p>
                    {preview.some((p) => p.user_id === person.user_id) && (
                      <p className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs text-emerald-800 dark:text-emerald-300">
                        Their divisions cover ages {[...new Set(preview.filter((p) => p.user_id === person.user_id).map((p) => p.league_age))].join(", ")}.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {AGES.map((age) => {
                        const session = sessionByAge.get(age);
                        const on = agesFor(person.user_id).includes(age);
                        const locked = !session || session.status !== "setup" || closed;
                        return (
                          <label key={age} className={`flex min-h-11 items-center gap-2 rounded-md border px-2 text-sm ${locked ? "border-border opacity-60" : "cursor-pointer border-border hover:bg-accent"}`}>
                            <input type="checkbox" name="age" value={age} defaultChecked={on} disabled={locked} className="h-4 w-4" />
                            <span>
                              Age {age}
                              <span className="block text-[10px] text-muted-foreground">{!session ? "no session" : STATUS_LABEL[session.status]}</span>
                            </span>
                            {/* Keep locked ticks in the submission so saving never removes them. */}
                            {locked && on && <input type="hidden" name="age" value={age} />}
                          </label>
                        );
                      })}
                    </div>
                    <Button type="submit" disabled={closed} className="bg-emerald-600 text-white hover:bg-emerald-500">Save age groups</Button>
                  </form>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AssignmentsPage(props: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <AssignmentsContent {...props} />
    </Suspense>
  );
}
