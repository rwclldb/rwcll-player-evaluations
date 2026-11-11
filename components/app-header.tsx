import Link from "next/link";
import Image from "next/image";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { TopbarClock } from "@/components/topbar-clock";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { DesktopNav, MobileMenu, type NavLink } from "@/components/app-nav";

const ADMIN_LINKS: NavLink[] = [
  { href: "/protected/players", label: "Players" },
  { href: "/protected/sessions", label: "Sessions" },
  { href: "/protected/assignments", label: "Assignments" },
  { href: "/protected/import-batches", label: "Imports" },
  { href: "/protected/evaluation-review", label: "Data Review" },
  { href: "/protected/draft-reports", label: "Draft Reports" },
  { href: "/protected/reports", label: "Reports" },
];

// Coaches and independent evaluators. The database decides what each may open on Draft Reports
// (released age groups for this season's coaches and independent evaluators).
const EVALUATOR_LINKS: NavLink[] = [
  { href: "/protected/evaluations", label: "Evaluations" },
  { href: "/protected/draft-reports", label: "Draft Reports" },
  { href: "/protected/my-notes", label: "My Notes" },
];

export async function AppHeader({ user }: { user: User }) {
  const supabase = await createClient();
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
  const links = !roleError && isAdmin === true ? ADMIN_LINKS : EVALUATOR_LINKS;
  const email = user.email ?? "";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-card/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/protected" className="group flex shrink-0 items-center gap-2">
            <Image
              src="/rwcll-logo32.png"
              alt="RWCLL Logo"
              width={32}
              height={32}
              className="h-8 w-auto object-contain transition-transform group-hover:scale-105"
              priority
            />
            <span className="text-lg font-bold tracking-tight text-foreground">
              RWCLL <span className="font-normal text-emerald-700 dark:text-emerald-400">Evaluations</span>
            </span>
          </Link>
          <DesktopNav links={links} />
        </div>

        {/* Desktop: clock, account, sign out, theme. Below xl these move into the menu button. */}
        <div className="hidden items-center gap-3 xl:flex">
          <TopbarClock />
          <span className="hidden max-w-[16rem] truncate rounded border border-border bg-background px-2.5 py-1 font-mono text-xs text-muted-foreground 2xl:inline">
            {email}
          </span>
          <form action={signOutAction}>
            <Button variant="outline" size="sm" type="submit">
              Sign Out
            </Button>
          </form>
          <ThemeSwitcher />
        </div>
        <MobileMenu links={links} email={email} />
      </div>
    </header>
  );
}
