import { AppHeader } from "@/components/app-header";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

async function ProtectedLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  return (
    <div className="min-h-screen bg-background text-slate-800 dark:text-slate-100 flex flex-col font-sans antialiased">
      <div className="print:hidden">
        <AppHeader user={user} />
      </div>
      <main className="flex-1 bg-gradient-to-b from-[#121824] to-[#0d131d] print:bg-none print:bg-white print:text-black">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 print:max-w-none print:p-0">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="flex items-center gap-3 text-muted-foreground text-sm">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
            Loading evaluation portal...
          </div>
        </div>
      }
    >
      <ProtectedLayoutContent>{children}</ProtectedLayoutContent>
    </Suspense>
  );
}