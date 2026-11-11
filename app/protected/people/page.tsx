import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, UserCog, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasAdminKey } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { grantRole, resendInvite, revokeRole, setDisabled } from "./actions";
import { InviteForm, SignInLinkButton } from "./link-forms";
import { PeopleImport } from "./people-import";

type SearchParams = Promise<{ season?: string; q?: string; message?: string; error?: string }>;
type RoleRow = { user_id: string; role_name: string; season_id: number | null };

const ROLE_LABEL: Record<string, string> = { administrator: "Admin", coach: "Coach", independent_evaluator: "Evaluator" };
const input = "mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-base text-foreground sm:text-sm";

function status(u: User) {
  if (u.banned_until && new Date(u.banned_until) > new Date()) return { label: "Disabled", tone: "bg-rose-500/15 text-rose-800 dark:text-rose-300", disabled: true };
  if (!u.last_sign_in_at) return { label: "Hasn't signed in yet", tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300", disabled: false };
  return { label: "Active", tone: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300", disabled: false };
}

async function PeopleContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");
  const { data: { user: me } } = await supabase.auth.getUser();

  const { data: seasonData } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
  const seasons = seasonData ?? [];
  const season = seasons.find((s) => String(s.id) === sp.season) ?? seasons.find((s) => !s.is_closed) ?? seasons[0];
  const keyMissing = !hasAdminKey();

  let users: User[] = [];
  let listError: string | null = null;
  if (!keyMissing) {
    try {
      const admin = createAdminClient();
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        users.push(...data.users);
        if (data.users.length < 200) break;
      }
    } catch (e) { listError = (e as Error).message; }
  }
  const [{ data: roleData }, { data: profileData }] = await Promise.all([
    supabase.from("user_roles").select("user_id, role_name, season_id"),
    supabase.from("user_profiles").select("user_id, display_name"),
  ]);
  const roles = (roleData ?? []) as RoleRow[];
  const names = new Map((profileData ?? []).map((p) => [p.user_id as string, (p.display_name as string | null) ?? ""]));
  const rolesFor = (id: string) => roles.filter((r) => r.user_id === id && (r.season_id === null || r.season_id === season?.id));
  const q = (sp.q ?? "").trim().toLowerCase();
  users = users
    .filter((u) => !q || `${u.email} ${names.get(u.id) ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => (names.get(a.id) || a.email || "").localeCompare(names.get(b.id) || b.email || ""));
  const seasonName = season?.name ?? "this season";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> Back to workspace</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <UserCog className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> People
        </h1>
        <p className="text-sm text-muted-foreground">
          Invite coaches and independent evaluators and give them a role for the season. New people get an email with a link to choose
          a password, or you can make the link yourself and send it by email or text (&quot;Sign-in link&quot; also helps with forgotten passwords). One person who is both a coach and an evaluator needs two accounts with different emails. Assign people to age
          groups on the <Link href="/protected/assignments" className="underline">Assignments</Link> page.
        </p>
      </div>

      {sp.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{sp.message}</div>}
      {sp.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{sp.error}</div>}
      {keyMissing && (
        <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          The server has no SUPABASE_SECRET_KEY setting, so accounts can&apos;t be listed or invited here. Add it to the server&apos;s environment
          (never with a NEXT_PUBLIC_ prefix).
        </div>
      )}
      {listError && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">Could not list accounts: {listError}</div>}

      <form action="/protected/people" className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">Season
          <select name="season" defaultValue={season?.id} className="mt-1 block h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_closed ? " (closed)" : ""}</option>)}
          </select>
        </label>
        <label className="min-w-48 flex-1 text-xs text-muted-foreground">Search
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Name or email" className={input} />
        </label>
        <Button type="submit" variant="outline" className="h-10">Show</Button>
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Invite one person</h2>
          <InviteForm seasonId={season?.id ?? null} seasonName={seasonName} disabled={keyMissing} />
        </section>
        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Invite from a list</h2>
          <p className="text-xs text-muted-foreground">
            A CSV with an email column, names, and optionally a role column (from the Sports Connect volunteer report, for example).
            Head coaches, assistants and managers become coaches. You&apos;ll see the list before anything is sent.
          </p>
          {season && !keyMissing && <PeopleImport seasonId={season.id} />}
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Accounts ({users.length})</h2>
        <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
          {users.map((u) => {
            const st = status(u);
            const mine = rolesFor(u.id);
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                <div className="min-w-48 flex-1">
                  <p className="font-medium text-foreground">{names.get(u.id) || "(no name)"}</p>
                  <p className="font-mono text-xs text-muted-foreground">{u.email}</p>
                </div>
                <span className={`rounded px-1.5 py-0.5 text-xs ${st.tone}`}>{st.label}</span>
                <div className="flex flex-wrap items-center gap-1">
                  {mine.length === 0 && <span className="text-xs text-muted-foreground">No role in {seasonName}</span>}
                  {mine.map((r) => (
                    <form key={`${r.role_name}-${r.season_id}`} action={revokeRole} className="inline-flex">
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="role" value={r.role_name} />
                      <input type="hidden" name="roleSeasonId" value={r.season_id ?? ""} />
                      <input type="hidden" name="seasonId" value={season?.id ?? ""} />
                      <button type="submit" title={`Remove ${ROLE_LABEL[r.role_name]} role`}
                        className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:border-rose-500">
                        {ROLE_LABEL[r.role_name]} <X className="h-3 w-3" />
                      </button>
                    </form>
                  ))}
                </div>
                <form action={grantRole} className="flex items-center gap-1">
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="seasonId" value={season?.id ?? ""} />
                  <select name="role" aria-label="Role to add" className="h-8 rounded-md border border-input bg-background px-1 text-xs text-foreground">
                    <option value="coach">Coach</option>
                    <option value="independent_evaluator">Evaluator</option>
                    <option value="administrator">Admin</option>
                  </select>
                  <Button type="submit" variant="outline" size="sm" className="h-8">Add</Button>
                </form>
                {!st.disabled && <SignInLinkButton userId={u.id} seasonId={season?.id ?? null} />}
                {!u.last_sign_in_at && !st.disabled && (
                  <form action={resendInvite}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="seasonId" value={season?.id ?? ""} />
                    <Button type="submit" variant="ghost" size="sm" className="h-8 text-xs">Email invite again</Button>
                  </form>
                )}
                {u.id !== me?.id && (
                  <form action={setDisabled}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="seasonId" value={season?.id ?? ""} />
                    <input type="hidden" name="disable" value={st.disabled ? "false" : "true"} />
                    <Button type="submit" variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground">{st.disabled ? "Enable" : "Disable"}</Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export default function PeoplePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <PeopleContent searchParams={searchParams} />
    </Suspense>
  );
}
