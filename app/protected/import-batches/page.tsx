import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type ImportBatch = {
  id: number;
  import_type: string;
  source_file_name: string | null;
  status: string;
  rows_received: number;
  rows_processed: number;
  rows_with_errors: number;
  created_at: string;
  season_id: number | null;
};

async function ImportBatchesContent() {
  await connection();
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims) redirect("/auth/login");

  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
  if (roleError || isAdmin !== true) {
    return <section className="flex flex-col gap-4"><h1 className="text-2xl font-bold">Administrator access required</h1><p role="alert" className="rounded-lg border p-4 text-sm">Staged import batches are restricted to assigned administrators.</p><Link className="underline" href="/protected">← Back to protected area</Link></section>;
  }

  const { data, error } = await supabase
    .from("import_batches")
    .select("id, import_type, source_file_name, status, rows_received, rows_processed, rows_with_errors, created_at, season_id")
    .eq("import_type", "players")
    .order("created_at", { ascending: false })
    .limit(100);

  const batches = (data ?? []) as ImportBatch[];
  const seasonIds = [...new Set(batches.map((batch) => batch.season_id).filter((id): id is number => id !== null))];
  const seasonNames = new Map<number, string>();
  if (seasonIds.length > 0) {
    const { data: seasons } = await supabase.from("seasons").select("id, name").in("id", seasonIds);
    for (const season of seasons ?? []) seasonNames.set(Number(season.id), String(season.name));
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link className="text-sm underline underline-offset-4" href="/protected">← Back to protected area</Link>
        <h1 className="text-3xl font-bold">Staged import batches</h1>
        <p className="text-sm text-muted-foreground">Administrator-only, read-only review of Sports Connect staging batches. This screen does not approve, match, or import players.</p>
      </div>
      <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm"><strong>Review only.</strong> Opening a batch reads its staged rows and flags. No player or registration records are changed here.</div>
      {error ? (
        <div role="alert" className="rounded-lg border border-destructive p-4 text-sm"><strong>Could not load staged batches.</strong><p className="mt-2">Confirm that the Phase 5.0 staging migration has been applied to the intended local database and that the administrator role is configured. No database changes were attempted by this page.</p></div>
      ) : batches.length === 0 ? (
        <div className="rounded-lg border p-6"><h2 className="font-semibold">No staged batches yet</h2><p className="mt-2 text-sm text-muted-foreground">Once a CSV is saved for review, its batch will appear here.</p><Link className="mt-4 inline-block underline underline-offset-4" href="/protected/import-preview">Open Sports Connect import preview →</Link></div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-muted"><tr>{["Batch", "Season", "Source file", "Created", "Rows", "Flagged", "Status", "Review"].map((heading) => <th key={heading} className="p-3 font-semibold">{heading}</th>)}</tr></thead>
            <tbody>{batches.map((batch) => <tr key={batch.id} className="border-t align-top">
              <td className="p-3 font-mono">#{batch.id}</td>
              <td className="p-3">{batch.season_id === null ? "Unknown season" : seasonNames.get(batch.season_id) ?? `Season #${batch.season_id}`}</td>
              <td className="p-3">{batch.source_file_name || "—"}</td>
              <td className="p-3">{new Date(batch.created_at).toLocaleString()}</td>
              <td className="p-3 tabular-nums">{batch.rows_received}</td>
              <td className="p-3 tabular-nums">{batch.rows_with_errors}</td>
              <td className="p-3">{batch.status}</td>
              <td className="p-3"><Link className="underline underline-offset-4" href={`/protected/import-batches/${batch.id}`}>View rows</Link></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Showing at most the 100 most recent player-import batches. Other import types are not shown on this page.</p>
    </section>
  );
}

export default function ImportBatchesPage() {
  return <Suspense fallback={<section className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Staged import batches</h1><p className="text-sm text-muted-foreground">Checking administrator access…</p></section>}><ImportBatchesContent /></Suspense>;
}
