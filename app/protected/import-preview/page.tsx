import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RegistrationImportPreview } from "./registration-import-preview";
import { ShieldAlert, ArrowLeft, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";

async function ImportPreviewContent() {
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
              <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Return to workspace
            </Link>
          </Button>
        </div>
        <h1 className="text-2xl font-bold text-foreground">Administrator Access Required</h1>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-700 dark:text-amber-400 shrink-0" />
          <span>
            This import preview is restricted to assigned administrators. If you believe you should have access, ask a league administrator to verify your role.
          </span>
        </div>
      </div>
    );
  }

  const { data: seasons, error: seasonsError } = await supabase
    .from("seasons")
    .select("id, name, start_date, end_date, is_closed")
    .eq("is_closed", false)
    .order("start_date", { ascending: false });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
              <Link href="/protected">
                <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Back to workspace
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <UploadCloud className="h-7 w-7 text-emerald-700 dark:text-emerald-400" />
            Sports Connect Import Preview
          </h1>
          <p className="mt-1 text-xs font-mono text-muted-foreground">
            Phase 5.1 &bull; CSV preview and administrator-only staging
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="border-border bg-card text-xs text-slate-700 dark:text-slate-300 hover:bg-accent">
          <Link href="/protected/import-batches">
            Review Previously Staged Batches &rarr;
          </Link>
        </Button>
      </div>

      {/* Warning Notice Banner */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200/90 leading-relaxed">
        <strong className="text-amber-800 dark:text-amber-300 font-semibold">Staging only — no player or registration changes.</strong> Saving a batch stores a minimal review copy and an audit entry. It does not create or update players or registrations. The bundled age chart is for the 2027 season only; do not stage another season using this chart.
      </div>

      {seasonsError ? (
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
          Could not load open seasons. Check the database migration and administrator permissions before staging.
        </div>
      ) : (
        <RegistrationImportPreview
          seasons={(seasons ?? []).map((season) => ({
            id: season.id,
            name: season.name,
            startDate: season.start_date,
            endDate: season.end_date,
          }))}
        />
      )}
    </div>
  );
}

export default function ImportPreviewPage() {
  return (
    <Suspense
      fallback={
        <div className="h-96 w-full rounded-lg border border-border bg-card animate-pulse" />
      }
    >
      <ImportPreviewContent />
    </Suspense>
  );
}