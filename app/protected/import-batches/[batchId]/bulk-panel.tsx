import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { bulkCommitClean, bulkIgnoreOutOfScope } from "./bulk-actions";

const field = "mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground";

// Shortcuts for the many rows that need no judgment. Everything else stays in Row Review.
export async function BulkPanel({ batchId, message, error }: { batchId: number; message?: string; error?: string }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("import_batch_bulk_counts", { p_batch_id: batchId });
  const counts = (data ?? [])[0] as { clean_rows: number; out_of_scope_rows: number; out_of_scope_programs: string | null } | undefined;
  if (!counts) return null;
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">Bulk review</h2>
      {message && <div role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-300">{message}</div>}
      {error && <div role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-sm text-rose-700 dark:text-rose-300">{error}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <form action={bulkIgnoreOutOfScope} className="space-y-2">
          <input type="hidden" name="batchId" value={batchId} />
          <p className="text-sm text-foreground"><b>{counts.out_of_scope_rows}</b> row(s) are in programs outside the evaluation pool.</p>
          {counts.out_of_scope_programs && <p className="text-xs text-muted-foreground">{counts.out_of_scope_programs}</p>}
          <label className="block text-xs text-muted-foreground">Reason<input name="reason" defaultValue="Out-of-scope program; not evaluated" className={field} /></label>
          <Button type="submit" variant="outline" disabled={counts.out_of_scope_rows === 0} className="min-h-10">Ignore out-of-scope rows</Button>
        </form>
        <form action={bulkCommitClean} className="space-y-2">
          <input type="hidden" name="batchId" value={batchId} />
          <p className="text-sm text-foreground"><b>{counts.clean_rows}</b> row(s) are clean new players.</p>
          <p className="text-xs text-muted-foreground">
            Active division, age group set, no warnings (payment status doesn&apos;t count), no other player with the same name, and a Player Id
            not already used. They&apos;re approved as new players and committed, each with its own audit entry.
          </p>
          <label className="block text-xs text-muted-foreground">Reason<input name="reason" defaultValue="Clean Sports Connect registration" className={field} /></label>
          <Button type="submit" disabled={counts.clean_rows === 0} className="min-h-10">Approve and commit clean rows</Button>
        </form>
      </div>
      <p className="text-xs text-muted-foreground">Rows left after this need a decision one at a time in Row Review: possible matches, duplicate Player Ids, missing birthdates, and other warnings.</p>
    </section>
  );
}
