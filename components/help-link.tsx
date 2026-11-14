import Link from "next/link";
import { CircleHelp } from "lucide-react";

// A small "Help" link from a screen to the matching section of a guide (/protected/help/<guide>#<section>).
export function HelpLink({ href, label = "Help" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground print:hidden">
      <CircleHelp className="h-4 w-4" /> {label}
    </Link>
  );
}
