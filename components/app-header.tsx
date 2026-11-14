import Link from "next/link";
import Image from "next/image";
import { UserRound } from "lucide-react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { TopbarClock } from "@/components/topbar-clock";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { DesktopNav, MobileMenu, type NavLink } from "@/components/app-nav";
import { getMyRoles } from "@/lib/my-roles";

const ADMIN_LINKS: NavLink[] = [
  { href: "/protected", label: "Roadmap" },
  { href: "/protected/players", label: "Players" },
  { href: "/protected/sessions", label: "Sessions" },
  { href: "/protected/people", label: "People" },
  { href: "/protected/assignments", label: "Assignments" },
  { href: "/protected/import-batches", label: "Imports" },
  { href: "/protected/evaluation-review", label: "Data Review" },
  { href: "/protected/draft-reports", label: "Draft Reports" },
  { href: "/protected/reports", label: "Season Export" },
];

// Coaches and independent evaluators. The database decides what each may open on Draft Reports
// (released age groups for this season's coaches and independent evaluators).
const EVALUATOR_LINKS: NavLink[] = [
  { href: "/protected/evaluations", label: "Evaluations" },
  { href: "/protected/draft-reports", label: "Draft Reports" },
  { href: "/protected/my-notes", label: "My Notes" },
];

// Registrars: registrations and evaluation day for their season. No scores, notes or draft reports.
const REGISTRAR_LINKS: NavLink[] = [
  { href: "/protected/check-in", label: "Check-in" },
  { href: "/protected/players", label: "Players" },
  { href: "/protected/import-batches", label: "Imports" },
  { href: "/protected/roster", label: "Rosters" },
  { href: "/protected/timetable", label: "Who scores when" },
];

export async function AppHeader({ user }: { user: User }) {
  const supabase = await createClient();
  const roles = await getMyRoles(supabase);
  const links = roles.isAdmin ? ADMIN_LINKS : [
    ...(roles.registrarSeason ? REGISTRAR_LINKS : []),
    ...(roles.scores || !roles.registrarSeason ? EVALUATOR_LINKS : []),
  ];
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
          {/* Icon only on laptops so the menu fits; the email shows on wide screens. */}
          <Link href="/protected/account" title={`Your account (${email}): name and password`} aria-label="Your account"
            className="flex h-9 max-w-[16rem] items-center gap-2 rounded border border-border bg-background px-2.5 text-muted-foreground hover:border-emerald-500/50 hover:text-foreground">
            <UserRound className="h-4 w-4 shrink-0" />
            <span className="hidden truncate font-mono text-xs 2xl:inline">{email}</span>
          </Link>
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
