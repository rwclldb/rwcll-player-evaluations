import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, History, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { stagePriorYearUpload } from "./actions";

type SearchParams = Promise<{ message?: string; error?: string }>;
type Batch = { id: number; source_file_name: string | null; status: string; rows_received: number; created_at: string };

async function PriorYearContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");

  const [{ data: seasonData }, { data: batchData }, { data: pendingData }] = await Promise.all([
    supabase.from("seasons").select("id, name, is_closed, start_date").eq("is_closed", false).order("start_date", { ascending: false }),
    supabase.from("import_batches").select("id, source_file_name, status, rows_received, created_at").eq("import_type", "historical_evaluations").order("created_at", { ascending: false }).limit(20),
    supabase.from("historical_evaluation_import_rows").select("import_batch_id, match_status").eq("review_state", "pending_review").neq("match_status", "invalid"),
  ]);
  const batches = (batchData ?? []) as Batch[];
  const open = new Map<number, number>();
  for (const r of pendingData ?? []) open.set(r.import_batch_id, (open.get(r.import_batch_id) ?? 0) + 1);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected/import-batches"><ArrowLeft className="mr-1 h-4 w-4" /> Imports</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground"><History className="h-6 w-6 text-emerald-700 dark:text-emerald-400" /> Prior-year coach ratings</h1>
        <p className="text-sm text-muted-foreground">
          Upload last season&apos;s end-of-season coach ratings. Each row is one coach&apos;s rating of one player: player first and last name,
          birthdate, Player Id (if you have it), season, division, team, coach name, and one column per skill (1-5, blank if not rated).
          Rows are matched to players registered for the season you choose. Import the Sports Connect registrations first for the best
          matches; rows that don&apos;t match yet are held and can be checked again later. No players are ever created from this file.
        </p>
      </div>

      {sp.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{sp.message}</div>}
      {sp.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{sp.error}</div>}

      <form action={stagePriorYearUpload} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <label className="text-xs text-muted-foreground">Match to players in
          <select name="seasonId" className="mt-1 block h-11 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            {(seasonData ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">Ratings are from (if no Season column)
          <input name="seasonLabel" placeholder="Spring 2026" className="mt-1 block h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground" />
        </label>
        <label className="min-w-56 flex-1 text-xs text-muted-foreground">CSV file
          <input type="file" name="file" accept=".csv,text/csv" required className="mt-1 block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-2" />
        </label>
        <Button type="submit" className="h-11"><Upload className="mr-1 h-4 w-4" /> Preview</Button>
      </form>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Earlier uploads</h2>
        {batches.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {batches.map((b) => (
              <li key={b.id}>
                <Link href={`/protected/prior-year/${b.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-accent/50">
                  <span className="font-medium text-foreground">{b.source_file_name ?? `Upload ${b.id}`}</span>
                  <span className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString("en-US")} · {b.rows_received} rows</span>
                  {(open.get(b.id) ?? 0) > 0 && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-300">{open.get(b.id)} waiting</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function PriorYearPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <PriorYearContent searchParams={searchParams} />
    </Suspense>
  );
}
