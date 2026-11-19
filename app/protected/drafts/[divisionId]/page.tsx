import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, Baby, CheckCircle2, Dices, Info, ListOrdered, Plus, Settings2, Users, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  KID_RULE_LABEL, REASON_LABEL, STATUS_LABEL, defaultKidRound, setupChecks, type DraftSetup, type PoolPlayer,
} from "@/lib/drafts";
import { createDraft, deleteDraft, drawOrder, poolOverride, saveSettings, setKidRound, setOrder, setRosterSize } from "../actions";

type Params = Promise<{ divisionId: string }>;
type SearchParams = Promise<{ show?: string; age?: string; message?: string; error?: string }>;

const input = "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground";
const card = "rounded-xl border border-border bg-card p-4 shadow-sm";
const fmt = (n: number | null) => (n === null || n === undefined ? "—" : Number(n).toFixed(2));
const who = (p: { first_name: string; last_name: string }) => `${p.last_name}, ${p.first_name}`;
const FILTERS = [
  { key: "all", label: "Everyone", test: () => true },
  { key: "must", label: "Must draft", test: (p: PoolPlayer) => p.must_draft },
  { key: "requested", label: "Asked for this division", test: (p: PoolPlayer) => p.reason === "requested" },
  { key: "also", label: "Also in another pool", test: (p: PoolPlayer) => !!p.also_in?.length },
  { key: "added", label: "Added by admin", test: (p: PoolPlayer) => p.reason === "override_in" },
  { key: "unrated", label: "No ratings", test: (p: PoolPlayer) => p.evaluations === 0 },
] as const;
const REASON_STYLE: Record<PoolPlayer["reason"], string> = {
  coach_kid: "bg-sky-500/15 text-sky-800 dark:text-sky-300", must_draft_age: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  override_in: "bg-violet-500/15 text-violet-800 dark:text-violet-300", requested: "bg-muted text-foreground",
  by_age: "bg-muted text-foreground", from_above: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
};

function Section({ id, icon: Icon, title, children, aside }: { id: string; icon: typeof Info; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground"><Icon className="h-5 w-5 text-emerald-700 dark:text-emerald-400" /> {title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

async function SetupContent({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { divisionId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_admin_or_registrar");
  if (allowed !== true) redirect("/protected");
  const { data, error } = await supabase.rpc("draft_setup", { p_season_division_id: Number(divisionId) });
  if (error || !data) {
    return <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">Could not load this draft: {error?.message ?? "not found"}</p>;
  }
  const s = data as DraftSetup;
  const d = s.draft;
  const editable = !!d && d.status === "setup" && !s.division.season_closed;
  const hidden = (<><input type="hidden" name="divisionId" value={s.division.season_division_id} />{d && <input type="hidden" name="draftId" value={d.id} />}</>);
  const checks = setupChecks(s);
  const blocks = checks.filter((c) => c.level === "block").length;
  const ages = Array.from({ length: s.division.max_age - s.division.min_age + 1 }, (_, i) => s.division.min_age + i);
  const filter = FILTERS.find((f) => f.key === sp.show) ?? FILTERS[0];
  const pool = s.pool.filter((p) => filter.test(p) && (!sp.age || String(p.league_age) === sp.age));
  const spots = s.teams.reduce((n, t) => n + (t.roster_size ?? d?.roster_size ?? 12), 0);
  const link = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { show: filter.key === "all" ? undefined : filter.key, age: sp.age, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `/protected/drafts/${divisionId}${q.size ? `?${q}` : ""}#pool`;
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href={`/protected/drafts?season=${s.division.season_id}`}><ArrowLeft className="mr-1 h-4 w-4" /> Drafts</Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            <ListOrdered className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> {s.division.name} draft
            <span className="text-base font-normal text-muted-foreground">ages {s.division.min_age}–{s.division.max_age} · {s.division.season}</span>
          </h1>
          {d && <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-semibold text-emerald-800 dark:text-emerald-300">{STATUS_LABEL[d.status]}</span>}
        </div>
        {d?.copied_from && <p className="text-sm text-muted-foreground">Rules copied from the {s.division.name} draft in {d.copied_from}. Change anything that&apos;s different this year.</p>}
      </div>

      {sp.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{sp.message}</div>}
      {sp.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{sp.error}</div>}

      {!d && (
        <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
          <p className="text-sm text-muted-foreground">
            No {s.division.name} draft yet. The pool below is who would be in it.
            {s.previous ? ` Setting it up copies the rules from ${s.previous.season}.` : ` It starts with the usual rules: ${s.division.name === "Juniors" ? "every age" : `every ${s.division.max_age}-year-old`} must be drafted, 12 per team, snake order.`}
          </p>
          <form action={createDraft}>{hidden}<Button type="submit"><Plus className="mr-1 h-4 w-4" /> Set up the {s.division.name} draft</Button></form>
        </div>
      )}

      {d && (
        <section className={`${card} space-y-2`} aria-label="Ready to start?">
          <h2 className="flex items-center gap-2 font-bold text-foreground">
            {blocks ? <XCircle className="h-5 w-5 text-rose-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
            {blocks ? `${blocks} ${blocks === 1 ? "thing" : "things"} to do before the draft can start` : "Ready to start once the draft room is built (next step)"}
          </h2>
          <ul className="space-y-1 text-sm">
            {checks.map((c, i) => (
              <li key={i} className="flex items-start gap-2">
                {c.level === "block" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /> : c.level === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />}
                <span>{c.text} {c.href && <Link href={c.href} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">Fix →</Link>}</span>
              </li>
            ))}
            {checks.length === 0 && <li className="text-muted-foreground">Nothing to fix.</li>}
          </ul>
        </section>
      )}

      {d && (
        <Section id="rules" icon={Settings2} title="Rules">
          <form action={saveSettings} className="space-y-4">
            {hidden}
            <fieldset disabled={!editable} className="grid gap-4 lg:grid-cols-2">
              <div className={`${card} space-y-3`}>
                <h3 className="font-semibold text-foreground">Who&apos;s in the pool</h3>
                <div>
                  <p className="text-sm font-medium text-foreground">Must-draft ages</p>
                  <p className="text-xs text-muted-foreground">Every player of these ages is in the pool, whatever division they asked for, and must be drafted. Coach&apos;s kids of this division&apos;s managers and coaches are always must-draft.</p>
                  <div className="mt-1 flex flex-wrap gap-3">
                    {ages.map((a) => (
                      <label key={a} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="mustDraftAge" value={a} defaultChecked={d.must_draft_ages.includes(a)} className="h-4 w-4" /> {a}</label>
                    ))}
                  </div>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="poolByAgeOnly" defaultChecked={d.pool_by_age_only} className="mt-0.5 h-4 w-4" />
                  <span><span className="font-medium">Pool by age only.</span> <span className="text-muted-foreground">Everyone in ages {s.division.min_age}–{s.division.max_age} is in the pool, whatever division they asked for in Sports Connect.</span></span>
                </label>
                <label className="block text-sm font-medium">Roster size <input type="number" name="rosterSize" min={1} max={40} defaultValue={d.roster_size} className={`${input} ml-2 w-20`} />
                  <span className="ml-2 text-xs font-normal text-muted-foreground">per team (change one team below)</span></label>
              </div>

              <div className={`${card} space-y-3`}>
                <h3 className="font-semibold text-foreground">Pick order and ages</h3>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-1.5"><input type="radio" name="orderType" value="snake" defaultChecked={d.order_type === "snake"} /> Snake <span className="text-xs text-muted-foreground">(1→8, then 8→1)</span></label>
                  <label className="flex items-center gap-1.5"><input type="radio" name="orderType" value="straight" defaultChecked={d.order_type === "straight"} /> Straight <span className="text-xs text-muted-foreground">(same order every round)</span></label>
                </div>
                <div className="space-y-1 text-sm">
                  <label className="flex items-start gap-1.5"><input type="radio" name="ageOrder" value="open" defaultChecked={d.age_order === "open"} className="mt-1" />
                    <span><span className="font-medium">Open.</span> <span className="text-muted-foreground">Any age at any time. The board marks the last picks &quot;must draft&quot; so every must-draft player is taken.</span></span></label>
                  <label className="flex items-start gap-1.5"><input type="radio" name="ageOrder" value="oldest_first" defaultChecked={d.age_order === "oldest_first"} className="mt-1" />
                    <span><span className="font-medium">Oldest first.</span> <span className="text-muted-foreground">All {s.division.max_age}s, then all {s.division.max_age - 1}s, and so on.</span></span></label>
                </div>
                <label className="block text-sm font-medium">Pick timer
                  <select name="pickTimer" defaultValue={d.pick_timer_seconds ?? ""} className={`${input} ml-2`}>
                    <option value="">Off</option>
                    {[60, 90, 120, 180, 300].map((t) => <option key={t} value={t}>{t < 120 ? `${t} seconds` : `${t / 60} minutes`}</option>)}
                  </select>
                  <span className="ml-2 text-xs font-normal text-muted-foreground">a countdown only; nothing is picked automatically</span></label>
              </div>

              <div className={`${card} space-y-2`}>
                <h3 className="font-semibold text-foreground">Coach&apos;s kids</h3>
                <p className="text-xs text-muted-foreground">Kids of each team&apos;s Manager and Coach go to that team. In an oldest-first draft, these rules apply within the kid&apos;s own age.</p>
                <label className="flex items-start gap-1.5 text-sm"><input type="radio" name="coachKidRule" value="fixed_rounds" defaultChecked={d.coach_kid_rule === "fixed_rounds"} className="mt-1" />
                  <span><span className="font-medium">Fixed rounds:</span> the team&apos;s kids fill its picks in rounds
                    <input name="coachKidRounds" defaultValue={d.coach_kid_rounds.join(", ")} className={`${input} mx-1 w-20`} aria-label="Rounds for coach's kids" />
                    <span className="text-xs text-muted-foreground">(manager&apos;s kid first)</span></span></label>
                <label className="flex items-start gap-1.5 text-sm"><input type="radio" name="coachKidRule" value="round_per_kid" defaultChecked={d.coach_kid_rule === "round_per_kid"} className="mt-1" />
                  <span><span className="font-medium">A round for each kid,</span> set below (suggested from the kid&apos;s ranking). The app makes the pick when that round comes.</span></label>
                <label className="flex items-start gap-1.5 text-sm"><input type="radio" name="coachKidRule" value="by_round" defaultChecked={d.coach_kid_rule === "by_round"} className="mt-1" />
                  <span><span className="font-medium">Picked by a round:</span> the team picks its kids any time up to round
                    <input type="number" name="coachKidByRound" min={1} max={40} defaultValue={d.coach_kid_by_round} className={`${input} mx-1 w-16`} aria-label="Latest round" />;
                    then the app picks them.</span></label>
                <label className="flex items-start gap-1.5 text-sm"><input type="radio" name="coachKidRule" value="before_draft" defaultChecked={d.coach_kid_rule === "before_draft"} className="mt-1" />
                  <span><span className="font-medium">Placed before the draft:</span> each kid is on the board from the start, in the round set below.</span></label>
              </div>

              <div className={`${card} space-y-2`}>
                <h3 className="font-semibold text-foreground">Siblings</h3>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="siblingsTogether" defaultChecked={d.siblings_together} className="mt-0.5 h-4 w-4" />
                  <span><span className="font-medium">Siblings play together.</span> <span className="text-muted-foreground">When one is drafted, the other goes to the same team with that team&apos;s next pick.</span></span></label>
                <label className="block text-sm">When the other sibling doesn&apos;t have to be in this draft (a 10-year-old with a 12-year-old):
                  <select name="siblingOptional" defaultValue={d.sibling_optional} className={`${input} mt-1 block`}>
                    <option value="ask">Ask at the pick: take with the next pick, or send down</option>
                    <option value="always_take">Always take them with the next pick</option>
                    <option value="send_down">Always send them down to the next division</option>
                  </select></label>
              </div>
            </fieldset>
            {editable ? <Button type="submit">Save rules</Button> : <p className="text-sm text-muted-foreground">The rules can&apos;t change once the draft has started.</p>}
          </form>
        </Section>
      )}

      {d && (
        <Section id="order" icon={Dices} title="Teams and first-round order"
          aside={<span className="text-sm text-muted-foreground">{s.teams.length} teams · {spots} roster spots{d.order_set_at ? ` · ${d.order_source === "draw" ? "drawn" : "set by hand"} ${new Date(d.order_set_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}</span>}>
          {s.teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">No teams yet. <Link href={`/protected/teams?season=${s.division.season_id}#div-${s.division.season_division_id}`} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">Add them on the Teams page</Link>.</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr><th className="px-3 py-2">Pick</th><th className="px-3 py-2">Team</th><th className="px-3 py-2">Manager</th><th className="px-3 py-2">Coach</th><th className="px-3 py-2">Roster size</th></tr>
                  </thead>
                  <tbody>
                    {s.teams.map((t) => (
                      <tr key={t.team_id} className="border-t border-border">
                        <td className="px-3 py-2 text-lg font-bold">{t.position ?? <span className="text-sm font-normal text-amber-700 dark:text-amber-300">—</span>}</td>
                        <td className="px-3 py-2 font-medium">{t.name}</td>
                        <td className="px-3 py-2">{t.manager ?? <span className="text-amber-700 dark:text-amber-300">none</span>}</td>
                        <td className="px-3 py-2">{t.coach ?? <span className="text-amber-700 dark:text-amber-300">none</span>}</td>
                        <td className="px-3 py-2">
                          <form action={setRosterSize} className="flex items-center gap-2">{hidden}<input type="hidden" name="teamId" value={t.team_id} />
                            <input type="number" name="rosterSize" min={1} max={40} defaultValue={t.roster_size ?? ""} placeholder={String(d.roster_size)} aria-label={`Roster size for ${t.name}`} disabled={!editable} className={`${input} w-20`} />
                            {editable && <Button type="submit" size="sm" variant="outline">Save</Button>}
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {editable && (
                <div className="grid gap-3 lg:grid-cols-2">
                  <form action={drawOrder} className={`${card} space-y-2`}>{hidden}
                    <h3 className="font-semibold text-foreground">Random draw</h3>
                    <p className="text-sm text-muted-foreground">The app draws the first-round order. {d.order_set_at ? "Drawing again replaces the current order (both are logged)." : "The result is logged."}</p>
                    <Button type="submit"><Dices className="mr-1 h-4 w-4" /> {d.order_set_at ? "Draw again" : "Draw the order"}</Button>
                  </form>
                  <form action={setOrder} className={`${card} space-y-2`}>{hidden}
                    <h3 className="font-semibold text-foreground">Set by hand</h3>
                    <p className="text-sm text-muted-foreground">For a draw held outside the app. Choose the team for each first-round pick.</p>
                    <ol className="space-y-1">
                      {s.teams.map((t, i) => {
                        const current = [...s.teams].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))[i];
                        return (
                          <li key={i} className="flex items-center gap-2 text-sm"><span className="w-6 text-right font-semibold">{i + 1}</span>
                            <select name="position" defaultValue={current?.team_id} aria-label={`Pick ${i + 1}`} className={`${input} flex-1`}>
                              {s.teams.map((o) => <option key={o.team_id} value={o.team_id}>{o.name}</option>)}
                            </select></li>
                        );
                      })}
                    </ol>
                    <Button type="submit" variant="outline">Save this order</Button>
                  </form>
                </div>
              )}
            </>
          )}
        </Section>
      )}

      {d && (
        <Section id="kids" icon={Baby} title="Coach's kids" aside={<span className="text-sm text-muted-foreground">{KID_RULE_LABEL[d.coach_kid_rule]}</span>}>
          {s.kids.length === 0 ? (
            <p className="text-sm text-muted-foreground">No coach&apos;s kids linked to this division&apos;s managers and coaches. <Link href={`/protected/teams/families?season=${s.division.season_id}`} className="font-medium text-emerald-700 hover:underline dark:text-emerald-400">Coach&apos;s kids and siblings</Link></p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr><th className="px-3 py-2">Player</th><th className="px-3 py-2">Team</th><th className="px-3 py-2">Parent</th><th className="px-3 py-2">Round</th></tr>
                </thead>
                <tbody>
                  {s.kids.map((k) => {
                    const def = defaultKidRound(d, k);
                    return (
                      <tr key={`${k.player_season_id}-${k.team_id}`} className="border-t border-border">
                        <td className="px-3 py-2"><span className="font-medium">{who(k)}</span> <span className="text-xs text-muted-foreground">age {k.league_age ?? "?"}{k.bib ? ` · #${k.bib}` : ""}{k.suggested_round ? ` · ranks for round ${k.suggested_round}` : ""}</span>
                          {!k.in_pool && <div className="text-xs font-medium text-amber-700 dark:text-amber-300">Not in this pool</div>}</td>
                        <td className="px-3 py-2">{k.team}</td>
                        <td className="px-3 py-2">{k.parent} <span className="text-xs text-muted-foreground">({k.parent_role === "manager" ? "Manager" : "Coach"})</span></td>
                        <td className="px-3 py-2">
                          {d.coach_kid_rule === "by_round" ? (
                            <span className="text-muted-foreground">Picked by the team, by round {d.coach_kid_by_round}</span>
                          ) : (
                            <form action={setKidRound} className="flex flex-wrap items-center gap-2">{hidden}<input type="hidden" name="playerSeasonId" value={k.player_season_id} />
                              <input type="number" name="round" min={1} max={40} defaultValue={k.round ?? ""} placeholder={def ? String(def) : "?"} aria-label={`Round for ${who(k)}`} disabled={!editable} className={`${input} w-20`} />
                              <span className="text-xs text-muted-foreground">{k.round ? "set by hand" : def ? `default: round ${def}` : "no default; set a round"}</span>
                              {editable && <Button type="submit" size="sm" variant="outline">Save</Button>}
                              {editable && k.round && <Button type="submit" name="clear" value="1" size="sm" variant="ghost">Use default</Button>}
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      <Section id="pool" icon={Users} title={`The pool (${s.pool.length})`}
        aside={<span className="text-sm text-muted-foreground">{s.pool.filter((p) => p.must_draft).length} must be drafted · ranked by evaluator average, then coach average</span>}>
        <div className="flex flex-wrap gap-2">
          {ages.map((a) => {
            const n = s.pool.filter((p) => p.league_age === a);
            return (
              <Link key={a} href={link({ age: sp.age === String(a) ? undefined : String(a) })}
                className={`rounded-lg border px-3 py-1.5 text-sm ${sp.age === String(a) ? "border-emerald-500 bg-emerald-600 text-white" : "border-border bg-card hover:bg-accent"}`}>
                Age {a}: <strong>{n.length}</strong>{n.some((p) => p.must_draft) ? ` (${n.filter((p) => p.must_draft).length} must)` : ""}
              </Link>
            );
          })}
        </div>
        <nav aria-label="Pool filters" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link key={f.key} href={link({ show: f.key === "all" ? undefined : f.key })}
              className={`rounded-md border px-3 py-1 text-sm ${filter.key === f.key ? "border-emerald-500 bg-emerald-600 text-white" : "border-border bg-card hover:bg-accent"}`}>
              {f.label} <span className="opacity-75">({s.pool.filter(f.test).length})</span>
            </Link>
          ))}
        </nav>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Player</th><th className="px-3 py-2">Why</th><th className="px-3 py-2 text-right">Evaluator</th><th className="px-3 py-2 text-right">Coach</th><th className="px-3 py-2 text-right">Prior year</th><th className="px-3 py-2">Change</th></tr>
            </thead>
            <tbody>
              {pool.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-muted-foreground">Nobody here.</td></tr>}
              {pool.map((p) => (
                <tr key={p.player_season_id} className="border-t border-border align-top">
                  <td className="px-3 py-2 text-muted-foreground">{p.rank}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium">{who(p)}</span> <span className="text-xs text-muted-foreground">age {p.league_age ?? "?"}{p.bib ? ` · #${p.bib}` : " · no bib"}</span>
                    <div className="flex flex-wrap gap-1 text-xs">
                      {p.must_draft && <span className="rounded bg-emerald-600 px-1.5 py-0.5 font-semibold text-white">Must draft</span>}
                      {p.sibling_group && <span className="rounded bg-muted px-1.5 py-0.5">Sibling group {p.sibling_group}</span>}
                      {p.also_in?.length ? <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-800 dark:text-amber-300">Also in {p.also_in.join(", ")} pool</span> : null}
                      {p.evaluations === 0 && <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-800 dark:text-rose-300">No ratings</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${REASON_STYLE[p.reason]}`}>{p.reason === "from_above" ? `Left over from ${p.from_division}` : REASON_LABEL[p.reason]}</span>
                    {p.reason !== "requested" && <div className="text-xs text-muted-foreground">{p.requested ? `Asked for ${p.requested}` : "No division in Sports Connect"}</div>}
                    {p.note && <div className="text-xs italic text-muted-foreground">&ldquo;{p.note}&rdquo;</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(p.evaluator_overall)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(p.coach_overall)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(p.prior_overall)}</td>
                  <td className="px-3 py-2">
                    {!s.division.season_closed && (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Change…</summary>
                        <form action={poolOverride} className="mt-2 flex w-64 flex-col gap-2">{hidden}<input type="hidden" name="playerSeasonId" value={p.player_season_id} />
                          <select name="moveTo" defaultValue="" aria-label="Move to" className={input}>
                            <option value="">Take out of this pool</option>
                            {s.other_divisions.map((o) => <option key={o.season_division_id} value={o.season_division_id}>Move to the {o.name} pool</option>)}
                          </select>
                          <input type="hidden" name="mode" value="out" />
                          <input name="note" required minLength={3} placeholder="Why? (kept in the log)" className={input} />
                          <Button type="submit" size="sm" variant="outline">Save</Button>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!s.division.season_closed && (
          <form action={poolOverride} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-3">{hidden}<input type="hidden" name="mode" value="in" />
            <span className="w-full text-sm font-medium text-foreground">Add a player to this pool</span>
            <select name="playerSeasonId" required defaultValue="" aria-label="Player" className={`${input} min-w-64`}>
              <option value="">Choose a player not in the pool…</option>
              {s.players.map((p) => <option key={p.player_season_id} value={p.player_season_id}>{who(p)} (age {p.league_age ?? "?"}{p.bib ? `, #${p.bib}` : ""})</option>)}
            </select>
            <input name="note" required minLength={3} placeholder="Why? (kept in the log)" className={`${input} min-w-64 flex-1`} />
            <Button type="submit" size="sm" className="h-9"><Plus className="mr-1 h-4 w-4" /> Add</Button>
          </form>
        )}

        {s.overrides.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Changes by hand ({s.overrides.length})</h3>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
              {s.overrides.map((o) => (
                <li key={o.player_season_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span><span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-semibold ${o.mode === "in" ? "bg-violet-500/15 text-violet-800 dark:text-violet-300" : "bg-rose-500/15 text-rose-800 dark:text-rose-300"}`}>{o.mode === "in" ? "Added" : "Taken out"}</span>
                    <span className="font-medium">{who(o)}</span> <span className="text-xs text-muted-foreground">age {o.league_age ?? "?"} · &ldquo;{o.note}&rdquo; · {o.by}, {new Date(o.at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" })}</span></span>
                  {!s.division.season_closed && (
                    <form action={poolOverride} className="flex items-center gap-2">{hidden}<input type="hidden" name="playerSeasonId" value={o.player_season_id} /><input type="hidden" name="mode" value="" />
                      <input name="note" required minLength={3} placeholder="Why undo?" aria-label={`Why undo the change for ${who(o)}`} className={`${input} w-40`} />
                      <Button type="submit" size="sm" variant="ghost">Undo</Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {editable && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Remove this draft setup…</summary>
          <form action={deleteDraft} className="mt-2 flex items-center gap-2">{hidden}
            <span className="text-muted-foreground">Removes the rules, order, roster sizes and kid rounds. Pool changes by hand stay.</span>
            <Button type="submit" size="sm" variant="destructive">Remove</Button>
          </form>
        </details>
      )}
    </div>
  );
}

export default function DraftSetupPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading the draft…</p>}>
      <SetupContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
