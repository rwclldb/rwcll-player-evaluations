"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Moon, Sun, Laptop } from "lucide-react";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Prevent SSR hydration mismatches by ensuring component is mounted on client
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
        <Sun className="h-4 w-4 text-amber-500" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-amber-500" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-emerald-400" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-card border-border text-foreground">
        <DropdownMenuItem
          onSelect={() => setTheme("light")}
          className={`cursor-pointer flex items-center gap-2 hover:bg-accent hover:text-accent-foreground ${
            theme === "light" ? "text-emerald-500 font-semibold" : ""
          }`}
        >
          <Sun className="h-4 w-4 text-amber-500" />
          <span>Light</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => setTheme("dark")}
          className={`cursor-pointer flex items-center gap-2 hover:bg-accent hover:text-accent-foreground ${
            theme === "dark" ? "text-emerald-400 font-semibold" : ""
          }`}
        >
          <Moon className="h-4 w-4 text-emerald-400" />
          <span>Dark</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("system")}
          className={`cursor-pointer flex items-center gap-2 hover:bg-accent hover:text-accent-foreground ${
            theme === "system" ? "text-emerald-500 font-semibold" : ""
          }`}
        >
          <Laptop className="h-4 w-4 text-slate-400" />
          <span>System</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}