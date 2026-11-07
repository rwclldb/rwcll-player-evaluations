
import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

export default async function ProtectedPage() {
  const supabase = await createClient();

  const { data: claims, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claims?.claims) {
    redirect("/auth/login");
  }

  const { data: isAdmin, error: roleError } =
    await supabase.rpc("is_admin");

  const administrator = !roleError && isAdmin === true;

  return (
    <div className="flex w-full flex-1 flex-col gap-8">
      <header className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          RWCLL · Spring 2027
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          Player Evaluations
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Manage player evaluations, review registration imports, and
          prepare for the draft. Evaluation access is limited to assigned
          evaluators and authorized administrators.
        </p>
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Evaluation workspace</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Evaluations are organized by Little League age, independently
            of eventual division assignment.
          </p>
        </div>

        <div className="rounded-lg border p-5">
          <h3 className="font-semibold">Evaluation sessions</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            The planned Spring 2027 setup has nine individual age groups,
            ages 8 through 16. Groups can operate together on-site while
            keeping their records separate in the app.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Session management and evaluator assignments are the next
            features to build.
          </p>
        </div>
      </section>

      {administrator && (
        <section className="space-y-4">

        <div className="rounded-lg border p-5">
          <h3 className="font-semibold">Evaluation sessions</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Create age-based sessions and manage their setup, open, and locked
            states for each season.
          </p>
          <Link
            href="/protected/sessions"
            className="mt-4 inline-flex rounded-md border px-4 py-2 text-sm font-medium"
          >
            Manage evaluation sessions
          </Link>
        </div>

          <div>
            <h2 className="text-xl font-semibold">Registration administration</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Import and review registration data before it enters the
              player and season-registration records.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border p-5">
              <h3 className="font-semibold">Sports Connect import</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Preview a registration CSV, check league-age calculations,
                and stage rows for review.
              </p>
              <Link
                href="/protected/import-preview"
                className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Open import preview
              </Link>
            </div>

            <div className="rounded-lg border p-5">
              <h3 className="font-semibold">Staged import review</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Inspect staged batches and review row-level flags and
                administrator decisions.
              </p>
              <Link
                href="/protected/import-batches"
                className="mt-4 inline-flex rounded-md border px-4 py-2 text-sm font-medium"
              >
                Review staged batches
              </Link>
            </div>
          </div>
        </section>
      )}

      {!administrator && (
        <section className="rounded-lg border p-5">
          <h2 className="font-semibold">Evaluator access</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your assigned evaluation sessions will appear here once the
            evaluator workspace is implemented and assignments are configured.
          </p>
        </section>
      )}

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Development workspace · Registration payment status and evaluation
        eligibility must be verified before players can be evaluated.
      </footer>
    </div>
  );
}
