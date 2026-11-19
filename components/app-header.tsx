import Link from "next/link";
import Image from "next/image";
import { CircleHelp } from "lucide-react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { AccountMenu, DesktopNav, MobileMenu, type NavItem, type NavLink } from "@/components/app-nav";
import { getMyRoles } from "@/lib/my-roles";
import { OfflineStatus } from "@/components/offline-sync";

// Admins: grouped menus so everything fits in one row on a laptop. The phone menu uses the same groups.
const ADMIN_ITEMS: NavItem[] = [
  { href: "/protected", label: "Roadmap" },
  { label: "Players", links: [
    { href: "/protected/players", label: "Players" },
    { href: "/protected/import-batches", label: "Imports" },
    { href: "/protected/players/duplicates", label: "Possible duplicates" },
  ] },
  { label: "Evaluations", links: [
    { href: "/protected/sessions", label: "Sessions" },
    { href: "/protected/assignments", label: "Assignments" },
    { href: "/protected/progress", label: "Scoring progress" },
    { href: "/protected/evaluation-review", label: "Data Review" },
  ] },
  { label: "Evaluation day", links: [
    { href: "/protected/check-in", label: "Check-in" },
    { href: "/protected/announce", label: "Call players" },
    { href: "/protected/end-of-day", label: "End-of-day check" },
    { href: "/protected/roster", label: "Rosters" },
    { href: "/protected/timetable", label: "Who scores when" },
    { href: "/protected/qr", label: "QR codes" },
  ] },
  { label: "Reports", links: [
    { href: "/protected/draft-reports", label: "Draft Reports" },
    { href: "/protected/reports", label: "Season Export" },
  ] },
  { label: "Draft", links: [
    { href: "/protected/teams", label: "Teams" },
    { href: "/protected/teams/families", label: "Coach's kids and siblings" },
    { href: "/protected/drafts", label: "Drafts" },
  ] },
  { href: "/protected/people", label: "People" },
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
  { href: "/protected/announce", label: "Call players" },
  { href: "/protected/players", label: "Players" },
  { href: "/protected/import-batches", label: "Imports" },
  { href: "/protected/roster", label: "Rosters" },
  { href: "/protected/timetable", label: "Who scores when" },
  { href: "/protected/teams", label: "Teams" },
  { href: "/protected/drafts", label: "Drafts" },
];

// Announcers: call bibs on evaluation day. Names, bibs and ages only.
const ANNOUNCER_LINKS: NavLink[] = [
  { href: "/protected/announce", label: "Call players" },
  { href: "/protected/timetable", label: "Who scores when" },
];

export async function AppHeader({ user }: { user: User }) {
  const supabase = await createClient();
  const roles = await getMyRoles(supabase);
  const staff = roles.registrarSeason !== null || roles.announcerSeason !== null;
  const flat = [
    ...(roles.registrarSeason ? REGISTRAR_LINKS : []),
    ...(roles.announcerSeason ? ANNOUNCER_LINKS : []),
    ...(roles.scores || !staff ? EVALUATOR_LINKS : []),
  ];
  // Someone with two roles gets each page once.
  const items: NavItem[] = roles.isAdmin ? ADMIN_ITEMS : flat.filter((l, i) => flat.findIndex((x) => x.href === l.href) === i);
  const email = user.email ?? "";
  // An admin's "View as" preview of this account (read-only), or null.
  const { data: preview } = await supabase.rpc("current_preview");
  const previewInfo = preview as { target_name: string; admin_name: string } | null;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-card/95 shadow-sm backdrop-blur">
      {previewInfo && (
        <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-violet-600 px-4 py-2 text-center text-sm text-white">
          <span><b>Admin preview:</b> you&apos;re seeing the app as {previewInfo.target_name}. Read-only; nothing you do is saved.</span>
          <a href="/auth/end-preview" className="rounded-md bg-white/15 px-2.5 py-1 font-semibold hover:bg-white/25">End preview</a>
        </div>
      )}
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
          <DesktopNav items={items} />
        </div>

        {/* Scores saved on this device but not sent yet (no signal). Visible on every screen size. */}
        <div className="ml-auto"><OfflineStatus userId={user.id} /></div>

        {/* Laptops and up: help, and the account menu (Your account, theme, sign out). Below lg these are in the menu button. */}
        <div className="hidden items-center gap-2 lg:flex">
          <Link href="/protected/help" title="Help: guides for coaches, evaluators and registrars" aria-label="Help"
            className="flex h-9 items-center rounded border border-border bg-background px-2.5 text-muted-foreground hover:border-emerald-500/50 hover:text-foreground">
            <CircleHelp className="h-4 w-4" />
          </Link>
          {previewInfo && (
            <a href="/auth/end-preview" className="flex h-9 items-center rounded border border-violet-500/50 px-2.5 text-sm font-medium text-violet-700 hover:bg-violet-500/10 dark:text-violet-300">End preview</a>
          )}
          <AccountMenu email={email} preview={Boolean(previewInfo)} />
        </div>
        <MobileMenu items={items} email={email} preview={Boolean(previewInfo)} />
      </div>
    </header>
  );
}
