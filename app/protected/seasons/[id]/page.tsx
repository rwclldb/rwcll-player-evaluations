import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, History, Lock, LockOpen, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { closeSeason, reopenSeason } from "../actions";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ message?: string; error?: string }>;
type Check = {
  open_age_groups: number[]; setup_age_groups: number[]; unreleased_age_groups: number[];
  import_rows_waiting: number; bib_rows_held: number; players_without_bib: number; draft_evaluations: number;
};
type HistoryRow = { action: string; reason: string | null; actor_name: string; created_at: string };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const ages = (list: number[]) => (list.length === 1 ? `Age ${list[0]}` : `Ages ${list.join(", ")}`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Item({ kind, children, href, link }: { kind: "block" | "warn" | "ok"; children: React.ReactNode; href?: string; link?: string }) {
  const Icon = kind === "block" ? XCircle : kind === "warn" ? AlertTriangle : CheckCircle2;
  const color = kind === "block" ? "text-rose-600" : kind === "warn" ? "text-amber-600" : "text-emerald-600";
  return (
    <li className="flex items-start gap-2 py-2 text-sm">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
      <span className="flex-1">{children}</span>
      {href && <Link href={href} className="shrink-0 text-sm font-semibold text-primary hover:underline">{link}</Link>}
    </li>
  );
}

function StatusForm({ seasonId, seasonName, closing }: { seasonId: number; seasonName: string; closing: boolean }) {
  return (
    <form action={closing ? closeSeason : reopenSeason} className="space-y-3">
      <input type="hidden" name="seasonId" value={seasonId} />
      <label className="block text-sm font-medium">
        Reason <span className="font-normal text-muted-foreground">(kept in the audit log)</span>
        <textarea name="reason" required minLength={10} rows={2}
          placeholder={closing ? "e.g., Season over; end-of-season ratings are in." : "e.g., Fix a bib entered wrong before the draft."}
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      </label>
      <label className="block text-sm font-medium">
        Type <span className="font-semibold">{seasonName}</span> to confirm
        <input name="confirmName" required autoComplete="off" className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
      </label>
      <Button type="submit" variant={closing ? "destructive" : "default"}>
        {closing ? <><Lock className="mr-1 h-4 w-4" /> Close season</> : <><LockOpen className="mr-1 h-4 w-4" /> Reopen season</>}
      </Button>
    </form>
  );
}

// Close or reopen one season (admins). Both need a reason and the season's name typed; both are audited.
async function SeasonContent({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");

  const seasonId = Number(id);
  const { data: season } = await supabase.from("seasons").select("id, name, start_date, end_date, is_closed, closed_at").eq("id", seasonId).maybeSingle();
  if (!season) redirect("/protected");
  const [{ data: checkData }, { data: historyData }, { data: backupData }] = await Promise.all([
    supabase.rpc("admin_season_close_check", { p_season_id: seasonId }),
    supabase.rpc("admin_season_status_history", { p_season_id: seasonId }),
    supabase.from("audit_log").select("created_at, actor_user_id").eq("action", "season_backup_downloaded")
      .eq("target_table", "seasons").eq("target_id", String(seasonId)).order("created_at", { ascending: false }).limit(3),
  ]);
  const backups = (backupData ?? []) as { created_at: string; actor_user_id: string | null }[];
  const backupActors = [...new Set(backups.map((b) => b.actor_user_id).filter((x): x is string => Boolean(x)))];
  const { data: actorData } = backupActors.length
    ? await supabase.from("user_profiles").select("user_id, display_name").in("user_id", backupActors)
    : { data: [] };
  const actorName = new Map(((actorData ?? []) as { user_id: string; display_name: string | null }[]).map((p) => [p.user_id, p.display_name ?? "An admin"]));
  const check = checkData as Check | null;
  const history = (historyData ?? []) as HistoryRow[];
  const lastClose = history.find((h) => h.action === "season_closed");
  const blocked = (check?.open_age_groups.length ?? 0) > 0;
  const warnings = check ? [
    check.setup_age_groups.length > 0 && { text: `${ages(check.setup_age_groups)} never opened for scoring.`, href: "/protected/sessions", link: "Sessions" },
    check.unreleased_age_groups.length > 0 && { text: `${ages(check.unreleased_age_groups)} locked but the draft report isn't released.`, href: "/protected/sessions", link: "Sessions" },
    check.draft_evaluations > 0 && { text: `${plural(check.draft_evaluations, "draft evaluation", "draft evaluations")} (not counted in reports).`, href: "/protected/evaluation-review", link: "Data Review" },
    check.import_rows_waiting > 0 && { text: `${plural(check.import_rows_waiting, "Sports Connect row is", "Sports Connect rows are")} still waiting in import review.`, href: "/protected/import-batches", link: "Imports" },
    check.bib_rows_held > 0 && { text: `${plural(check.bib_rows_held, "bib upload row is", "bib upload rows are")} held.`, href: "/protected/players/bibs", link: "Bib upload" },
    check.players_without_bib > 0 && { text: `${plural(check.players_without_bib, "player has", "players have")} no bib.`, href: `/protected/players?season=${seasonId}`, link: "Players" },
  ].filter((w): w is { text: string; href: string; link: string } => Boolean(w)) : [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link href={`/protected?season=${season.id}`}><ArrowLeft className="mr-1 h-4 w-4" /> Roadmap</Link>
        </Button>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-bold">
          {season.name}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${season.is_closed ? "bg-muted text-muted-foreground" : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"}`}>
            {season.is_closed ? "Closed" : "Active"}
          </span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {season.start_date || "—"} – {season.end_date || "—"}
          {season.is_closed && season.closed_at && <> · Closed {when(season.closed_at)}{lastClose ? ` by ${lastClose.actor_name}` : ""}</>}
        </p>
      </div>

      {sp.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{sp.message}</div>}
      {sp.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{sp.error}</div>}

      <section id="backup" className="scroll-mt-20 space-y-3 rounded-2xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Download className="h-5 w-5" /> Season backup</h2>
        <p className="text-sm text-muted-foreground">
          A zip of spreadsheets with everything this season holds: every score, the draft report averages, players, prior-year
          ratings, check-ins, calls, people and the schedule. If the app is down on draft night, open <span className="font-mono">draft-report.csv</span>.
          Birthdates and coaches&apos; private notes are left out. Download one at the end of evaluation day and after the draft, and keep it
          somewhere private: it has children&apos;s names and coaches&apos; emails.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild>
            {/* A plain link: the route sends the zip as a download. */}
            <a href={`/protected/seasons/${season.id}/backup`} download><Download className="mr-1 h-4 w-4" /> Download season backup</a>
          </Button>
          <span className="text-xs text-muted-foreground">Takes a few seconds. Each download is recorded in the audit log.</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {backups.length === 0 ? "No backup downloaded yet." : <>Last downloaded: {backups.map((b) => `${when(b.created_at)} by ${actorName.get(b.actor_user_id ?? "") ?? "an admin"}`).join(" · ")}</>}
        </p>
      </section>

      {season.is_closed ? (
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><LockOpen className="h-5 w-5" /> Reopen this season</h2>
          <p className="text-sm text-muted-foreground">
            A closed season can&apos;t be changed: no scores, imports, bibs, check-ins, exemptions or player edits. Coaches can still edit their
            private notes. Its end-of-season ratings stay available to next season as prior-year context. Reopen only to fix something,
            then close it again.
          </p>
          <StatusForm seasonId={season.id} seasonName={season.name} closing={false} />
        </section>
      ) : (
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Lock className="h-5 w-5" /> Close this season</h2>
          <p className="text-sm text-muted-foreground">
            Closing freezes the season: no scores, imports, bibs, check-ins, exemptions or player edits until an admin reopens it
            (also audited). Draft reports stay readable. Coaches can still edit their private notes.
          </p>
          <div>
            <h3 className="text-sm font-semibold">Before closing</h3>
            <ul className="divide-y divide-border">
              {blocked && check && (
                <Item kind="block" href="/protected/sessions" link="Sessions">
                  Scoring is still open for {ages(check.open_age_groups).toLowerCase()}. Lock {check.open_age_groups.length === 1 ? "it" : "them"} first.
                </Item>
              )}
              {warnings.map((w) => <Item key={w.text} kind="warn" href={w.href} link={w.link}>{w.text}</Item>)}
              {!blocked && warnings.length === 0 && <Item kind="ok">Nothing left open. The season is ready to close.</Item>}
            </ul>
            {!blocked && warnings.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Warnings don&apos;t stop you from closing; they&apos;re saved with the close in the audit log.</p>}
          </div>
          {blocked
            ? <p className="text-sm font-medium text-rose-700 dark:text-rose-300">Lock every age group on the Sessions page before closing.</p>
            : <StatusForm seasonId={season.id} seasonName={season.name} closing />}
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold"><History className="h-5 w-5" /> Close and reopen history</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Never closed in the app.</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((h) => (
              <li key={`${h.action}-${h.created_at}`} className="py-2 text-sm">
                <span className="font-semibold">{h.action === "season_closed" ? "Closed" : "Reopened"}</span>
                <span className="text-muted-foreground"> · {when(h.created_at)} · {h.actor_name}</span>
                {h.reason && <p className="text-muted-foreground">“{h.reason}”</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function SeasonPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading season…</p>}>
      <SeasonContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
