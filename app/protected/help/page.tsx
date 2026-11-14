import Link from "next/link";
import { BookOpen, ClipboardCheck, ClipboardList, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/my-roles";
import { GUIDES, type GuideKey } from "@/lib/help";

const ICONS: Record<GuideKey, typeof ClipboardList> = { coach: ClipboardList, evaluator: Eye, registrar: ClipboardCheck };

// Help: the guides, with the ones for the reader's own roles first.
export default async function HelpPage() {
  const supabase = await createClient();
  const [roles, { data: seasonRoles }] = await Promise.all([getMyRoles(supabase), supabase.rpc("my_season_roles")]);
  const names = new Set(((seasonRoles ?? []) as { role_name: string }[]).map((r) => r.role_name));
  const mine = new Set<GuideKey>([
    ...(names.has("coach") ? ["coach" as const] : []),
    ...(names.has("independent_evaluator") ? ["evaluator" as const] : []),
    ...(roles.registrarSeason ? ["registrar" as const] : []),
  ]);
  const ordered = [...GUIDES].sort((a, b) => Number(mine.has(b.key)) - Number(mine.has(a.key)));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <BookOpen className="h-6 w-6 text-emerald-700 dark:text-emerald-400" /> Help
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Short guides for each job. Each one prints (or saves as a PDF) as a quick-start sheet{roles.isAdmin ? " you can hand out" : ""}.
        </p>
      </div>
      <ul className="grid gap-3">
        {ordered.map((g) => {
          const Icon = ICONS[g.key];
          return (
            <li key={g.key}>
              <Link href={`/protected/help/${g.key}`}
                className="group flex items-start gap-4 rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-emerald-500/50 hover:shadow-md">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white dark:text-emerald-400">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                    {g.title}
                    {mine.has(g.key) && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">For you</span>}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{g.intro}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">Still stuck? Ask a league admin.</p>
    </div>
  );
}
