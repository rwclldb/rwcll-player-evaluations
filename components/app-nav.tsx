"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Laptop, LogOut, Menu, Moon, Sun } from "lucide-react";
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

function isCurrent(pathname: string, href: string) {
  if (href === "/protected") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Desktop (xl and up): links in a row inside the top bar.
export function DesktopNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 text-sm font-medium xl:flex">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={isCurrent(pathname, l.href) ? "page" : undefined}
          className={cn(
            "rounded-md px-2.5 py-1.5 transition-colors hover:bg-accent hover:text-foreground",
            isCurrent(pathname, l.href)
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-slate-700 dark:text-slate-300",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

// Phones, tablets and small laptops (below xl): one menu button holding the links, account, theme and sign out.
export function MobileMenu({ links, email }: { links: NavLink[]; email: string }) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const themes = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Laptop },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-10 w-10 xl:hidden" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {links.map((l) => (
          <DropdownMenuItem key={l.href} asChild>
            <Link
              href={l.href}
              aria-current={isCurrent(pathname, l.href) ? "page" : undefined}
              className={cn(
                "min-h-11 text-base",
                isCurrent(pathname, l.href) && "font-semibold text-emerald-700 dark:text-emerald-400",
              )}
            >
              {l.label}
            </Link>
          </DropdownMenuItem>
        ))}
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
        <DropdownMenuLabel className="truncate font-mono text-[11px] font-normal">{email}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void signOutAction()} className="min-h-11 gap-2 text-base">
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
