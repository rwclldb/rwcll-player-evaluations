"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { ChevronDown, CircleHelp, Laptop, LogOut, Menu, Moon, Sun, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/app/actions";
import { cn } from "@/lib/utils";

export type NavLink = { href: string; label: string };
// A menu in the top bar holding related pages (admins: Players, Evaluations, Evaluation day, Reports).
export type NavGroup = { label: string; links: NavLink[] };
export type NavItem = NavLink | NavGroup;

const isGroup = (item: NavItem): item is NavGroup => "links" in item;
const allLinks = (items: NavItem[]) => items.flatMap((i) => (isGroup(i) ? i.links : [i]));

// The page you're on: the longest link that matches, so Possible duplicates wins over Players.
function useCurrentHref(items: NavItem[]) {
  const pathname = usePathname();
  return allLinks(items)
    .map((l) => l.href)
    .filter((h) => (h === "/protected" ? pathname === h : pathname === h || pathname.startsWith(`${h}/`)))
    .sort((a, b) => b.length - a.length)[0];
}

const barItem = (active: boolean) => cn(
  "flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors hover:bg-accent hover:text-foreground",
  active ? "text-emerald-700 dark:text-emerald-400" : "text-slate-700 dark:text-slate-300",
);

// Laptops and up (lg): links and menus in one row.
export function DesktopNav({ items }: { items: NavItem[] }) {
  const current = useCurrentHref(items);
  return (
    <nav aria-label="Main" className="hidden items-center gap-0.5 text-sm font-medium lg:flex">
      {items.map((item) =>
        isGroup(item) ? (
          <DropdownMenu key={item.label}>
            <DropdownMenuTrigger className={barItem(item.links.some((l) => l.href === current))}>
              {item.label} <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {item.links.map((l) => (
                <DropdownMenuItem key={l.href} asChild>
                  <Link href={l.href} aria-current={l.href === current ? "page" : undefined}
                    className={cn("min-h-9", l.href === current && "font-semibold text-emerald-700 dark:text-emerald-400")}>
                    {l.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Link key={item.href} href={item.href} aria-current={item.href === current ? "page" : undefined} className={barItem(item.href === current)}>
            {item.label}
          </Link>
        ),
      )}
    </nav>
  );
}

// Account, theme and sign out: the person icon on laptops, the bottom of the menu on phones.
function AccountItems({ email, preview, large }: { email: string; preview: boolean; large: boolean }) {
  const { theme, setTheme } = useTheme();
  const themes = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Laptop },
  ];
  const row = large ? "min-h-11 text-base" : "min-h-9";
  return (
    <>
      <DropdownMenuItem asChild>
        <Link href="/protected/account" className={cn(row, "gap-2")}>
          <UserRound className="h-4 w-4 shrink-0" />
          <span className="min-w-0">
            <span className="block">Your account</span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">{email}</span>
          </span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-[11px] font-normal">Theme</DropdownMenuLabel>
      <div className="grid grid-cols-3 gap-1 px-1 pb-1">
        {themes.map((t) => (
          <DropdownMenuItem
            key={t.value}
            onSelect={(e) => {
              e.preventDefault();
              setTheme(t.value);
            }}
            className={cn(
              "min-h-10 justify-center gap-1.5 border border-border text-xs",
              theme === t.value && "border-emerald-500 font-semibold text-emerald-700 dark:text-emerald-400",
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </DropdownMenuItem>
        ))}
      </div>
      <DropdownMenuSeparator />
      {preview ? (
        <DropdownMenuItem asChild>
          {/* A full page load (not client navigation): the route ends the preview and signs this window out. */}
          <a href="/auth/end-preview" className={cn(row, "gap-2")}><LogOut className="h-4 w-4" /> End preview</a>
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onSelect={() => void signOutAction()} className={cn(row, "gap-2")}>
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      )}
    </>
  );
}

// Laptops and up: the person icon opens Your account, theme and Sign out.
export function AccountMenu({ email, preview = false }: { email: string; preview?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={`Your account (${email})`}
        aria-label="Account menu"
        className="hidden h-9 max-w-[16rem] items-center gap-2 rounded border border-border bg-background px-2.5 text-muted-foreground hover:border-emerald-500/50 hover:text-foreground lg:flex"
      >
        <UserRound className="h-4 w-4 shrink-0" />
        <span className="hidden truncate font-mono text-xs 2xl:inline">{email}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <AccountItems email={email} preview={preview} large={false} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Phones and tablets (below lg): one menu button with every page (grouped like the top bar), help and account.
export function MobileMenu({ items, email, preview = false }: { items: NavItem[]; email: string; preview?: boolean }) {
  const current = useCurrentHref(items);
  const link = (l: NavLink) => (
    <DropdownMenuItem key={l.href} asChild>
      <Link
        href={l.href}
        aria-current={l.href === current ? "page" : undefined}
        className={cn("min-h-11 text-base", l.href === current && "font-semibold text-emerald-700 dark:text-emerald-400")}
      >
        {l.label}
      </Link>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-10 w-10 lg:hidden" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[80vh] w-64 overflow-y-auto">
        {items.map((item) =>
          isGroup(item) ? (
            <div key={item.label}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</DropdownMenuLabel>
              {item.links.map(link)}
            </div>
          ) : link(item),
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/protected/help" className="min-h-11 gap-2 text-base">
            <CircleHelp className="h-4 w-4 shrink-0" /> Help
          </Link>
        </DropdownMenuItem>
        <AccountItems email={email} preview={preview} large />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
