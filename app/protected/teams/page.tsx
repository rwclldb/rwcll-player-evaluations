import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, Baby, Plus, Shirt, Trash2, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { addTeam, deleteTeam, saveTeam } from "./actions";
import { TeamsUpload } from "./teams-upload";

type SearchParams = Promise<{ season?: string; message?: string; error?: string }>;

type Staff = { user_id: string; name: string; role: "manager" | "coach" | "assistant_coach" };
type Kid = { player_season_id: number; first_name: string; last_name: string; league_age: number | null; bib: number | null; parent_user_id: string };
type Team = { id: number; name: string; players: number; staff: Staff[]; kids: Kid[] };
type Division = { season_division_id: number; name: string; min_age: number | null; max_age: number | null; teams: Team[] };
type Coach = { user_id: string; name: string; email: string | null; divisions: string[]; teams: { team_id: number; season_division_id: number; role: string }[] };
type Setup = { divisions: Division[]; coaches: Coach[] };

const ROLE_LABEL: Record<Staff["role"], string> = { manager: "Manager", coach: "Coach", assistant_coach: "Assistant" };
const select = "mt-1 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground";

// Coach picker for one team: this division's coaches first; people already on another team in the division can't be chosen.
function CoachOptions({ coaches, division, teamId, teamNames }: { coaches: Coach[]; division: Division; teamId: number; teamNames: Map<number, string> }) {
  const busy = (c: Coach) => c.teams.find((t) => t.season_division_id === division.season_division_id && t.team_id !== teamId);
  const option = (c: Coach) => {
    const other = busy(c);
    return (
      <option key={c.user_id} value={c.user_id} disabled={!!other}>
        {c.name}{c.divisions.length ? ` (${c.divisions.join(", ")})` : ""}{other ? ` — on ${teamNames.get(other.team_id) ?? "another team"}` : ""}
      </option>
    );
  };
  const mine = coaches.filter((c) => c.divisions.includes(division.name));
  const rest = coaches.filter((c) => !c.divisions.includes(division.name));
  return (
    <>
      <option value="">— none —</option>
      {mine.length > 0 && <optgroup label={`${division.name} coaches`}>{mine.map(option)}</optgroup>}
      {rest.length > 0 && <optgroup label={mine.length ? "Other coaches" : "Coaches"}>{rest.map(option)}</optgroup>}
    </>
  );
}

function TeamCard({ team, division, coaches, seasonId, teamNames }: { team: Team; division: Division; coaches: Coach[]; seasonId: number; teamNames: Map<number, string> }) {
  const manager = team.staff.find((s) => s.role === "manager");
  const coach = team.staff.find((s) => s.role === "coach");
  const assistants = team.staff.filter((s) => s.role === "assistant_coach");
  const missing = [!manager && "manager", !coach && "coach"].filter(Boolean) as string[];
  const parentName = new Map(team.staff.map((s) => [s.user_id, s.name]));
  return (
    <li id={`team-${team.id}`} className="scroll-mt-24 rounded-xl border border-border bg-card p-4 shadow-sm">
      <form action={saveTeam} className="space-y-3">
        <input type="hidden" name="seasonId" value={seasonId} />
        <input type="hidden" name="teamId" value={team.id} />
        <input type="hidden" name="oldName" value={team.name} />
        <div className="flex items-center gap-2">
          <Shirt className="h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" />
          <input name="name" defaultValue={team.name} aria-label="Team name" maxLength={80}
            className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-base font-semibold text-foreground hover:border-input focus:border-input" />
          {team.players > 0 && <span className="shrink-0 text-xs text-muted-foreground">{team.players} players</span>}
        </div>
        {missing.length > 0 && (
          <p className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" /> No {missing.join(" or ")} yet
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-medium text-muted-foreground">
            Manager
            <select name="manager" defaultValue={manager?.user_id ?? ""} className={select}>
              <CoachOptions coaches={coaches} division={division} teamId={team.id} teamNames={teamNames} />
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Coach
            <select name="coach" defaultValue={coach?.user_id ?? ""} className={select}>
              <CoachOptions coaches={coaches} division={division} teamId={team.id} teamNames={teamNames} />
            </select>
          </label>
        </div>
        <fieldset className="text-xs text-muted-foreground">
          <legend className="font-medium">Assistant coaches <span className="font-normal">(not in the draft room; no coach&apos;s-kid privilege)</span></legend>
          {assistants.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {assistants.map((a) => (
                <li key={a.user_id}>
                  <label className="flex items-center gap-1.5 text-sm text-foreground">
                    <input type="checkbox" name="assistant" value={a.user_id} defaultChecked className="h-4 w-4" /> {a.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <select name="addAssistant" defaultValue="" aria-label="Add an assistant coach" className={select}>
            <option value="">+ Add an assistant…</option>
            {coaches.filter((c) => !team.staff.some((s) => s.user_id === c.user_id)).map((c) => {
              const other = c.teams.find((t) => t.season_division_id === division.season_division_id && t.team_id !== team.id);
              return <option key={c.user_id} value={c.user_id} disabled={!!other}>{c.name}{other ? ` — on ${teamNames.get(other.team_id) ?? "another team"}` : ""}</option>;
            })}
          </select>
        </fieldset>
        {team.kids.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-sky-500/10 px-2 py-1.5 text-xs text-sky-900 dark:text-sky-200">
            <Baby className="h-3.5 w-3.5" /> Coach&apos;s kids:
            {team.kids.map((k) => (
              <span key={`${k.player_season_id}-${k.parent_user_id}`}>
                {k.first_name} {k.last_name} (age {k.league_age ?? "?"}{k.bib ? `, #${k.bib}` : ""}; {parentName.get(k.parent_user_id)})
              </span>
            ))}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button type="submit" size="sm">Save</Button>
        </div>
      </form>
      {team.players === 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Delete team…</summary>
          <form action={deleteTeam} className="mt-2 flex items-center gap-2">
            <input type="hidden" name="seasonId" value={seasonId} />
            <input type="hidden" name="teamId" value={team.id} />
            <span className="text-muted-foreground">Deletes {team.name} and its staff list.</span>
            <Button type="submit" size="sm" variant="destructive"><Trash2 className="mr-1 h-3.5 w-3.5" /> Delete</Button>
          </form>
        </details>
      )}
    </li>
  );
}

async function TeamsContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_admin_or_registrar");
  if (allowed !== true) redirect("/protected");
  const { data: realAdmin } = await supabase.rpc("is_admin");

  const { data: seasonData } = await supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false });
  const seasons = seasonData ?? [];
  const season = seasons.find((s) => String(s.id) === params.season) ?? seasons.find((s) => !s.is_closed) ?? seasons[0];
  if (!season) redirect("/protected");

  const [{ data, error }, { data: families }] = await Promise.all([
    supabase.rpc("team_setup", { p_season_id: season.id }),
    supabase.rpc("family_overview", { p_season_id: season.id }),
  ]);
  const setup = (data ?? { divisions: [], coaches: [] }) as Setup;
  const fam = (families ?? { suggestions: [], coach_kids: [] }) as { suggestions: unknown[]; coach_kids: { parents: unknown[] }[] };
  const unlinkedKids = fam.coach_kids.filter((k) => k.parents.length === 0).length;
  const teamNames = new Map(setup.divisions.flatMap((d) => d.teams.map((t) => [t.id, t.name] as const)));
  const totalTeams = setup.divisions.reduce((n, d) => n + d.teams.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> {realAdmin === true ? "Roadmap" : "Home"}</Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            <Shirt className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> Teams
          </h1>
          <Button asChild variant="outline" size="sm" className={fam.suggestions.length + unlinkedKids > 0 ? "border-amber-500/60 text-amber-800 dark:text-amber-300" : undefined}>
            <Link href={`/protected/teams/families?season=${season.id}`}>
              <Users className="mr-1 h-4 w-4" /> Coach&apos;s kids and siblings{fam.suggestions.length + unlinkedKids > 0 ? ` (${fam.suggestions.length + unlinkedKids} to check)` : ""}
            </Link>
          </Button>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Each team has one <strong>Manager</strong> and one <strong>Coach</strong>: the two who sit in the draft room and whose kids get the
          coach&apos;s-kid rules. Assistant coaches are listed on the team only. A person can be on teams in several divisions, but on only one team
          per division. Everyone needs the coach role for the season first (People page).
        </p>
      </div>

      {params.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{params.message}</div>}
      {params.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{params.error}</div>}
      {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">Could not load teams: {error.message}</div>}

      <div className="flex flex-wrap items-end justify-between gap-3">
        {seasons.length > 1 && (
          <form action="/protected/teams" className="flex items-end gap-2">
            <label className="text-xs text-muted-foreground">
              Season
              <select name="season" defaultValue={season.id} className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_closed ? " (closed)" : ""}</option>)}
              </select>
            </label>
            <Button type="submit" variant="outline" size="sm" className="h-9">Show</Button>
          </form>
        )}
        <p className="text-sm text-muted-foreground">{totalTeams} {totalTeams === 1 ? "team" : "teams"} · {setup.coaches.length} coaches this season</p>
      </div>

      <TeamsUpload seasonId={season.id} />

      <nav aria-label="Divisions" className="flex flex-wrap gap-2">
        {setup.divisions.map((d) => (
          <a key={d.season_division_id} href={`#div-${d.season_division_id}`} className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-accent">
            {d.name} <span className="opacity-70">({d.teams.length})</span>
          </a>
        ))}
      </nav>

      {setup.divisions.map((d) => {
        const incomplete = d.teams.filter((t) => !t.staff.some((s) => s.role === "manager") || !t.staff.some((s) => s.role === "coach")).length;
        return (
          <section key={d.season_division_id} id={`div-${d.season_division_id}`} className="scroll-mt-24 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
              <h2 className="text-xl font-bold text-foreground">
                {d.name} <span className="text-sm font-normal text-muted-foreground">
                  {d.min_age !== null ? `ages ${d.min_age}–${d.max_age} · ` : ""}{d.teams.length} {d.teams.length === 1 ? "team" : "teams"}
                </span>
              </h2>
              {incomplete > 0 && <span className="text-xs font-medium text-amber-700 dark:text-amber-300">{incomplete} without a manager or coach</span>}
            </div>
            {d.teams.length === 0 && <p className="text-sm text-muted-foreground">No teams yet.</p>}
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {d.teams.map((t) => <TeamCard key={t.id} team={t} division={d} coaches={setup.coaches} seasonId={season.id} teamNames={teamNames} />)}
            </ul>
            <form action={addTeam} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="seasonId" value={season.id} />
              <input type="hidden" name="seasonDivisionId" value={d.season_division_id} />
              <input type="hidden" name="anchor" value={`div-${d.season_division_id}`} />
              <input name="name" placeholder={`Team ${d.teams.length + 1}`} aria-label={`New ${d.name} team name`} maxLength={80}
                className="h-9 w-48 rounded-md border border-input bg-background px-2 text-sm text-foreground" />
              <Button type="submit" size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" /> Add {d.name} team</Button>
            </form>
          </section>
        );
      })}
    </div>
  );
}

export default function TeamsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading teams…</p>}>
      <TeamsContent searchParams={searchParams} />
    </Suspense>
  );
}
