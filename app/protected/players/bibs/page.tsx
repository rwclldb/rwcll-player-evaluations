import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, Hash, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { stageBibUpload } from "../actions";
import { CsvTemplatePanel } from "@/components/csv-template";
import { BIB_TEMPLATE } from "@/lib/csv-templates";

type SearchParams = Promise<{ message?: string; error?: string }>;
type Batch = { id: number; source_file_name: string | null; status: string; rows_received: number; created_at: string; season_id: number };

async function BibsContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");

  const [{ data: seasonData }, { data: batchData }, { data: heldData }] = await Promise.all([
    supabase.from("seasons").select("id, name, is_closed, start_date").order("start_date", { ascending: false }),
    supabase.from("import_batches").select("id, source_file_name, status, rows_received, created_at, season_id").eq("import_type", "bibs").order("created_at", { ascending: false }).limit(20),
    supabase.from("bib_import_rows").select("import_batch_id").eq("status", "held"),
  ]);
  const seasons = seasonData ?? [];
  const batches = (batchData ?? []) as Batch[];
  const heldBy = new Map<number, number>();
  for (const r of heldData ?? []) heldBy.set(r.import_batch_id, (heldBy.get(r.import_batch_id) ?? 0) + 1);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected/players"><ArrowLeft className="mr-1 h-4 w-4" /> All players</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground"><Hash className="h-6 w-6 text-emerald-700 dark:text-emerald-400" /> Upload bib numbers</h1>
        <p className="text-sm text-muted-foreground">
          A CSV with a bib column (&quot;Evaluation Number&quot;, &quot;Bib&quot;, or Sports Connect&apos;s &quot;Registration Number&quot;) and either a &quot;Player Id&quot; column (Sports Connect) or first name,
          last name, and birthdate columns. You&apos;ll see a preview before anything changes. Rows that don&apos;t match a registered player
          are held, so you can upload before or after the registration import and check them again later.
        </p>
      </div>

      {sp.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{sp.message}</div>}
      {sp.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{sp.error}</div>}

      <CsvTemplatePanel template={BIB_TEMPLATE} />

      <form action={stageBibUpload} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <label className="text-xs text-muted-foreground">Season
          <select name="seasonId" className="mt-1 block h-11 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            {seasons.filter((s) => !s.is_closed).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
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
                <Link href={`/protected/players/bibs/${b.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-accent/50">
                  <span className="font-medium text-foreground">{b.source_file_name ?? `Upload ${b.id}`}</span>
                  <span className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString("en-US")} · {b.rows_received} rows</span>
                  {(heldBy.get(b.id) ?? 0) > 0 && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-800 dark:text-amber-300">{heldBy.get(b.id)} held</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{b.status === "completed" ? "Done" : "Open"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function BibsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <BibsContent searchParams={searchParams} />
    </Suspense>
  );
}
