import Link from "next/link";
import Image from "next/image";
import { AuthButton } from "@/components/auth-button";
import { TopbarClock } from "@/components/topbar-clock";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ThemeSwitcher } from "@/components/theme-switcher";

export async function AppHeader({ user }: { user: User }) {
  const supabase = await createClient();

  // Check administrator role via RPC
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
  const administrator = !roleError && isAdmin === true;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-card/95 backdrop-blur shadow-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          {/* Brand Logo & Name */}
          <Link href="/protected" className="flex items-center gap-3 group">
            <Image
              src="/rwcll-logo32.png"
              alt="RWCLL Logo"
              width={32}
              height={32}
              className="h-8 w-auto object-contain transition-transform group-hover:scale-105"
              priority
            />
            <span className="font-bold text-lg tracking-tight text-foreground">
              RWCLL <span className="text-emerald-400 font-normal">Evaluations</span>
            </span>
          </Link>

          {/* Role-Based Navigation Links */}
          <nav className="flex items-center gap-4 text-sm font-medium text-slate-300">
            {administrator ? (
              /* Administrator Navigation Links */
              <>
                <Link
                  href="/protected/sessions"
                  className="hover:text-emerald-400 transition-colors"
                >
                  Sessions
                </Link>
                <Link
                  href="/protected/assignments"
                  className="hover:text-emerald-400 transition-colors"
                >
                  Assignments
                </Link>
                <Link
                  href="/protected/import-batches"
                  className="hover:text-emerald-400 transition-colors"
                >
                  Imports
                </Link>
                <Link
                  href="/protected/evaluation-review"
                  className="hover:text-emerald-400 transition-colors"
                >
                  Data Review
                </Link>
                <Link
                  href="/protected/reports"
                  className="hover:text-emerald-400 transition-colors"
                >
                  Reports
                </Link>
              </>
            ) : (
              /* Non-Admin Coach/Evaluator Navigation Links */
              <>
                <Link
                  href="/protected/evaluations"
                  className="hover:text-emerald-400 transition-colors"
                >
                  Evaluations
                </Link>
                <Link
                  href="/protected/coach-reports"
                  className="hover:text-emerald-400 transition-colors"
                >
                  Coach Reports
                </Link>
                <Link
                  href="/protected/assignments"
                  className="hover:text-emerald-400 transition-colors"
                >
                  Assignments
                </Link>
                <Link
                  href="/protected/sessions"
                  className="hover:text-emerald-400 transition-colors"
                >
                  Sessions
                </Link>
              </>
            )}
          </nav>
        </div>

        {/* Right Side Controls: Live Clock + Auth Button */}
        <div className="flex items-center gap-4">
          <TopbarClock />
          <AuthButton />
          <ThemeSwitcher />
        </div>
      </div>
    </header>
  );
}

