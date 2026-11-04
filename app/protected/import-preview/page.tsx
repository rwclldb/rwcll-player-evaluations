import { redirect } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RegistrationImportPreview } from "./registration-import-preview";

async function ImportPreviewContent() {
  // Auth claims and the administrator role are request-specific.
  await connection();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) redirect("/auth/login");

  // Import workflows are administrator-only. Check the role on the server;
  // never trust a client-side flag or a user-editable profile field.
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
  if (roleError || isAdmin !== true) {
    return (
      <section className="flex w-full flex-col gap-4">
        <h1 className="text-2xl font-bold">Administrator access required</h1>
        <p role="alert" className="rounded-lg border p-4 text-sm">
          This import preview is restricted to assigned administrators. If you believe you should have access, ask a league administrator to verify your app role.
        </p>
        <Link href="/protected" className="text-sm underline underline-offset-4">← Back to protected area</Link>
      </section>
    );
  }

  const { data: seasons, error: seasonsError } = await supabase
    .from("seasons")
    .select("id, name, start_date, end_date, is_closed")
    .eq("is_closed", false)
    .order("start_date", { ascending: false });

  return (
    <section className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/protected" className="text-sm underline underline-offset-4">← Back to protected area</Link>
        <h1 className="text-3xl font-bold">Sports Connect import preview</h1>
        <p className="text-sm text-muted-foreground">Phase 5.1 · CSV preview and administrator-only staging</p>
        <Link href="/protected/import-batches" className="text-sm underline underline-offset-4">Review previously staged batches →</Link>
      </div>
      <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
        <strong>Staging only — no player or registration changes.</strong> Saving a batch stores a minimal review copy and an audit entry. It does not create or update players or registrations. The bundled age chart is for the 2027 season only; do not stage another season using this chart.
      </div>
      {seasonsError ? (
        <p role="alert" className="rounded-lg border border-destructive p-4 text-sm">Could not load open seasons. Check the database migration and administrator permissions before staging.</p>
      ) : (
        <RegistrationImportPreview seasons={(seasons ?? []).map((season) => ({
          id: season.id,
          name: season.name,
          startDate: season.start_date,
          endDate: season.end_date,
        }))} />
      )}
    </section>
  );
}


export default function ImportPreviewPage() {
  return (
    <Suspense
      fallback={
        <section className="flex w-full flex-col gap-3">
          <h1 className="text-2xl font-bold">Sports Connect import preview</h1>
          <p className="text-sm text-muted-foreground">Checking administrator access...</p>
        </section>
      }
    >
      <ImportPreviewContent />
    </Suspense>
  );
}
