import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { InfoIcon } from "lucide-react";
import { FetchDataSteps } from "@/components/tutorial/fetch-data-steps";
import { Suspense } from "react";
import Link from "next/link";

async function UserDetails() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  return JSON.stringify(data.claims, null, 2);
}

export default function ProtectedPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-12">
      <div className="w-full">
        <div className="bg-accent text-sm p-3 px-5 rounded-md text-foreground flex gap-3 items-center">
          <InfoIcon size="16" strokeWidth={2} />
          This is a protected page that you can only see as an authenticated
          user
        </div>
      </div>
      <div className="flex flex-col gap-2 items-start">
        <h2 className="font-bold text-2xl mb-4">Your user details</h2>
        <pre className="text-xs font-mono p-3 rounded border max-h-32 overflow-auto">
          <Suspense>
            <UserDetails />
          </Suspense>
        </pre>
      </div>
      <div className="rounded-lg border p-5 flex flex-col gap-2">
        <h2 className="font-bold text-xl">Staged import review</h2>
        <p className="text-sm text-muted-foreground">Review previously staged CSV batches and their row-level flags. This view is read-only; it does not match or import players.</p>
        <Link href="/protected/import-batches" className="inline-flex w-fit rounded-md border px-4 py-2 text-sm font-medium">Review staged batches</Link>
      </div>
      <div className="rounded-lg border p-5 flex flex-col gap-2">
        <h2 className="font-bold text-xl">Sports Connect registration import</h2>
        <p className="text-sm text-muted-foreground">Preview a registration CSV, review duplicate identifiers and division flags, and inspect 2027 league-age calculations. This first integration screen is read-only and does not write to Supabase.</p>
        <Link href="/protected/import-preview" className="inline-flex w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Open import preview</Link>
      </div>
      <div>
        <h2 className="font-bold text-2xl mb-4">Next steps</h2>
        <FetchDataSteps />
      </div>
    </div>
  );
}
