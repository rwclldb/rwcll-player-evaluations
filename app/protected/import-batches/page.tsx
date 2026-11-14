import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  UploadCloud, 
  FileSpreadsheet, 
  History, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  ShieldAlert,
  ArrowRight,
  ArrowLeft
} from "lucide-react";

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/auth/login");
  }

  // Verify administrator permissions via Supabase RPC function
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
  const administrator = !roleError && isAdmin === true;

  if (!administrator) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
            <Link href="/protected">
              <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Home
            </Link>
          </Button>
        </div>
        <h1 className="text-2xl font-bold text-foreground">Administrator Access Required</h1>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-700 dark:text-amber-400 shrink-0" />
          <span>Staged import batches are restricted to assigned administrators.</span>
        </div>
      </div>
    );
  }

  // Fetch player import batches matching original schema
  const { data, error } = await supabase
    .from("import_batches")
    .select("id, import_type, source_file_name, status, rows_received, rows_processed, rows_with_errors, created_at, season_id")
    .eq("import_type", "players")
    .order("created_at", { ascending: false })
    .limit(100);

  const batches = (data ?? []) as ImportBatch[];

  // Fetch associated season names dynamically
  const seasonIds = [...new Set(batches.map((b) => b.season_id).filter((id): id is number => id !== null))];
  const seasonNames = new Map<number, string>();

  if (seasonIds.length > 0) {
    const { data: seasons } = await supabase
      .from("seasons")
      .select("id, name")
      .in("id", seasonIds);

    for (const season of seasons ?? []) {
      seasonNames.set(Number(season.id), String(season.name));
    }
  }

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
              <Link href="/protected">
                <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Roadmap
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <FileSpreadsheet className="h-7 w-7 text-emerald-700 dark:text-emerald-400" />
            Staged Import Batches
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Administrator-only, read-only review of Sports Connect staging batches.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="text-xs">
            <Link href="/protected/prior-year">Prior-year ratings &rarr;</Link>
          </Button>
          <Button asChild variant="outline" className="text-xs">
            <Link href="/protected/players/bibs">Bib numbers &rarr;</Link>
          </Button>
          <Button asChild className="text-xs">
            <Link href="/protected/import-preview">
              <UploadCloud className="h-4 w-4 mr-2" /> Sports Connect import &rarr;
            </Link>
          </Button>
        </div>
      </div>

      {/* Audit Banner */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200/90 leading-relaxed">
        <strong className="text-amber-800 dark:text-amber-300 font-semibold">Review only.</strong> Opening a batch reads its staged rows and flags. No player or registration records are changed here.
      </div>

      {/* Import Batches Directory Table Card */}
      <Card className="border-border bg-card">
        <CardHeader className="py-4 border-b border-border/50">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <History className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            Staged Player Batches Log
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Showing up to 100 most recent player registration staging batches.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          {error ? (
            <div role="alert" className="p-6 text-xs text-rose-700 dark:text-rose-300 space-y-2">
              <strong className="text-rose-700 dark:text-rose-400 font-semibold">Could not load staged batches.</strong>
              <p>Refresh the page. If it keeps happening, check that you are signed in with an administrator account.</p>
            </div>
          ) : batches.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm font-semibold text-foreground">No staged batches yet</p>
              <p className="text-xs text-muted-foreground">Once a CSV is saved for review, its batch will appear here.</p>
              <Button asChild variant="outline" size="sm" className="border-border bg-background text-xs text-emerald-700 dark:text-emerald-400 hover:bg-accent">
                <Link href="/protected/import-preview">
                  Open Sports Connect import preview &rarr;
                </Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-background text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Batch</th>
                    <th className="px-4 py-3">Season</th>
                    <th className="px-4 py-3">Source File</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3 text-center">Rows</th>
                    <th className="px-4 py-3 text-center">Flagged</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {batches.map((batch) => {
                    const seasonName =
                      batch.season_id === null
                        ? "Unknown season"
                        : seasonNames.get(batch.season_id) ?? `Season #${batch.season_id}`;

                    return (
                      <tr key={batch.id} className="hover:bg-accent/50 transition-colors">
                        <td className="px-4 py-4 font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">
                          #{batch.id}
                        </td>
                        <td className="px-4 py-4 text-xs font-mono text-slate-700 dark:text-slate-300">
                          {seasonName}
                        </td>
                        <td className="px-4 py-4 text-xs font-mono text-foreground">
                          {batch.source_file_name || "—"}
                        </td>
                        <td className="px-4 py-4 text-xs font-mono text-muted-foreground">
                          {new Date(batch.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-4 text-center font-mono text-xs text-slate-700 dark:text-slate-300">
                          {batch.rows_received}
                        </td>
                        <td className="px-4 py-4 text-center font-mono text-xs">
                          {batch.rows_with_errors > 0 ? (
                            <span className="text-amber-700 dark:text-amber-400 font-semibold">{batch.rows_with_errors}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {batch.status === "staged" || batch.status === "completed" ? (
                            <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-mono gap-1 py-0.5">
                              <CheckCircle2 className="h-3 w-3" /> {batch.status}
                            </Badge>
                          ) : batch.status === "failed" ? (
                            <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400 text-xs font-mono gap-1 py-0.5">
                              <AlertCircle className="h-3 w-3" /> Failed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-mono gap-1 py-0.5">
                              <Clock className="h-3 w-3" /> {batch.status}
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <Button asChild variant="ghost" size="sm" className="h-8 text-xs text-slate-700 dark:text-slate-300 hover:text-foreground hover:bg-accent">
                            <Link href={`/protected/import-batches/${batch.id}`}>
                              View Rows <ArrowRight className="ml-1 h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      
      <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
        Showing at most the 100 most recent player-import batches. Other import types are not shown on this page.
      </p>
    </div>
  );
}

export default function ImportBatchesPage() {
  return (
    <Suspense
      fallback={
        <div className="h-96 w-full rounded-lg border border-border bg-card animate-pulse" />
      }
    >
      <ImportBatchesContent />
    </Suspense>
  );
}