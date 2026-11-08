import { Suspense } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

async function RootRedirectContent() {
  // Opt into request-time dynamic execution for cacheComponents compatibility
  await connection();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/protected");
  } else {
    redirect("/auth/login");
  }

  return null;
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-full items-center justify-center bg-background text-muted-foreground font-mono text-sm">
          Loading RWCLL Evaluation Portal...
        </div>
      }
    >
      <RootRedirectContent />
    </Suspense>
  );
}