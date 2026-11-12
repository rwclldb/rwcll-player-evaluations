import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { usDate } from "@/lib/players";
import { applyBibUpload, recheckBibUpload } from "../../actions";

type Params = Promise<{ batchId: string }>;
type SearchParams = Promise<{ message?: string; error?: string }>;
type Row = {
  id: number; source_row_number: number; external_player_id: string | null; first_name: string | null; last_name: string | null;
  birth_date: string | null; bib_raw: string | null; evaluation_number: number | null; status: string; change_kind: string | null;
  current_evaluation_number: number | null; message: string | null; matched_player_season_id: number | null;
  player_seasons: { players: { first_name: string; last_name: string } | null } | null;
};

const who = (r: Row) => {
  const p = r.player_seasons?.players;
  if (p) return `${p.last_name}, ${p.first_name}`;
  const name = [r.last_name, r.first_name].filter(Boolean).join(", ");
  return name || (r.external_player_id ? `Player Id ${r.external_player_id}` : "(no name)");
};
const detail = (r: Row) => [r.external_player_id ? `Id ${r.external_player_id}` : "", usDate(r.birth_date)].filter(Boolean).join(" · ");

function Group({ title, tone, rows, children, note }: { title: string; tone: string; rows: Row[]; children: (r: Row) => React.ReactNode; note?: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className={`text-sm font-semibold ${tone}`}>{title} ({rows.length})</h2>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="w-10 text-xs text-muted-foreground">Line {r.source_row_number}</span>
            {children(r)}
          </li>
        ))}
      </ul>
    </section>
  );
}

async function BatchContent({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { batchId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");

  const id = Number(batchId);
  const { data: batch } = await supabase.from("import_batches").select("id, source_file_name, created_at, season_id, seasons(name)").eq("id", id).eq("import_type", "bibs").maybeSingle();
  if (!batch) notFound();
  const { data } = await supabase.from("bib_import_rows")
    .select("id, source_row_number, external_player_id, first_name, last_name, birth_date, bib_raw, evaluation_number, status, change_kind, current_evaluation_number, message, matched_player_season_id, player_seasons(players(first_name, last_name))")
    .eq("import_batch_id", id).order("source_row_number");
  const rows = (data ?? []) as unknown as Row[];
  const ready = rows.filter((r) => r.status === "ready");
  const newRows = ready.filter((r) => r.change_kind === "new");
  const changes = ready.filter((r) => r.change_kind === "change");
  const conflicts = ready.filter((r) => r.change_kind === "conflict");
  const same = ready.filter((r) => r.change_kind === "same");
  const held = rows.filter((r) => r.status === "held");
  const invalid = rows.filter((r) => r.status === "invalid");
  const done = rows.filter((r) => r.status === "applied" || r.status === "skipped");
  const seasonName = (batch as unknown as { seasons: { name: string } | null }).seasons?.name;
  const playerLink = (r: Row) => r.matched_player_season_id
    ? <Link href={`/protected/players/${r.matched_player_season_id}`} className="font-medium text-foreground underline-offset-2 hover:underline">{who(r)}</Link>
    : <span className="font-medium text-foreground">{who(r)}</span>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected/players/bibs"><ArrowLeft className="mr-1 h-4 w-4" /> Bib uploads</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{batch.source_file_name ?? `Upload ${batch.id}`}</h1>
        <p className="text-sm text-muted-foreground">{seasonName} · uploaded {new Date(batch.created_at).toLocaleString("en-US")} · {rows.length} rows</p>
      </div>

      {sp.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{sp.message}</div>}
      {sp.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{sp.error}</div>}

      <form action={applyBibUpload} className="space-y-6">
        <input type="hidden" name="batchId" value={batch.id} />
        <Group title="Will set" tone="text-emerald-700 dark:text-emerald-400" rows={newRows} note="These players have no bib yet.">
          {(r) => <>{playerLink(r)}<span className="text-xs text-muted-foreground">{detail(r)}</span><span className="ml-auto font-mono font-bold">#{r.evaluation_number}</span></>}
        </Group>
        <Group title="Changes" tone="text-amber-700 dark:text-amber-400" rows={changes} note="These players already have a different bib. Tick the ones to change; the rest keep their current bib.">
          {(r) => (
            <label className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
              <input type="checkbox" name="acceptChange" value={r.id} className="h-5 w-5" />
              {playerLink(r)}<span className="text-xs text-muted-foreground">{detail(r)}</span>
              <span className="ml-auto font-mono">#{r.current_evaluation_number} → <b>#{r.evaluation_number}</b></span>
            </label>
          )}
        </Group>
        <Group title="Conflicts" tone="text-rose-700 dark:text-rose-400" rows={conflicts} note="Skipped: the bib already belongs to someone else. Fix the file or change bibs on the Players page.">
          {(r) => <>{playerLink(r)}<span className="font-mono">#{r.evaluation_number}</span><span className="w-full text-xs text-muted-foreground sm:w-auto">{r.message}</span></>}
        </Group>
        <Group title="Already set" tone="text-muted-foreground" rows={same}>
          {(r) => <>{playerLink(r)}<span className="ml-auto font-mono">#{r.evaluation_number}</span></>}
        </Group>
        {(newRows.length > 0 || changes.length > 0 || same.length > 0) && (
          <div className="flex flex-wrap items-center justify-end gap-3 rounded-lg border border-border bg-card p-3">
            <span className="text-sm text-muted-foreground">Sets {newRows.length} new bib(s) plus the changes you ticked.</span>
            <Button type="submit" className="min-h-11">Apply bibs</Button>
          </div>
        )}
      </form>

      <Group title="Held: no matching player yet" tone="text-amber-700 dark:text-amber-400" rows={held}
        note="Kept for later. After more registrations are imported, check again. You can also set these bibs by hand on the Players page.">
        {(r) => <>{playerLink(r)}<span className="text-xs text-muted-foreground">{detail(r)}</span><span className="font-mono">#{r.evaluation_number ?? r.bib_raw}</span><span className="w-full text-xs text-muted-foreground">{r.message}</span></>}
      </Group>
      {held.length > 0 && (
        <form action={recheckBibUpload} className="flex justify-end">
          <input type="hidden" name="batchId" value={batch.id} />
          <Button type="submit" variant="outline" className="min-h-11"><RefreshCw className="mr-1 h-4 w-4" /> Check held rows again</Button>
        </form>
      )}
      <Group title="Rejected" tone="text-rose-700 dark:text-rose-400" rows={invalid}>
        {(r) => <>{playerLink(r)}<span className="font-mono">{r.bib_raw ? `"${r.bib_raw}"` : "(blank)"}</span><span className="w-full text-xs text-muted-foreground">{r.message}</span></>}
      </Group>
      <Group title="Done" tone="text-muted-foreground" rows={done}>
        {(r) => <>{playerLink(r)}<span className="ml-auto font-mono">#{r.evaluation_number}</span><span className="text-xs text-muted-foreground">{r.status === "applied" ? "Set" : r.message}</span></>}
      </Group>
    </div>
  );
}

export default function BibBatchPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <BatchContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
