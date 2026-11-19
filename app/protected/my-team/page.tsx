import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Printer, Shirt } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { PrintButton } from "../roster/print-button";

type MyTeam = {
  team_id: number; team: string; division: string; season: string; role: string;
  staff: { name: string; role: string }[];
  players: { first_name: string; last_name: string; bib: number | null; league_age: number | null }[];
};
const ROLE: Record<string, string> = { manager: "Manager", coach: "Coach", assistant_coach: "Assistant coach" };

async function MyTeamContent() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_team_rosters");
  const teams = (data ?? []) as MyTeam[];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> Home</Link>
        </Button>
        {teams.length > 0 && <PrintButton />}
      </div>
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground"><Shirt className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> Your team{teams.length > 1 ? "s" : ""}</h1>
      {error && <p role="alert" className="text-sm text-rose-700">Could not load your team: {error.message}</p>}
      {teams.length === 0 && <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Your roster shows here once the league releases it after the draft.</p>}
      {teams.map((t) => (
        <section key={t.team_id} className="space-y-2 rounded-xl border border-border bg-card p-4 print:break-after-page print:border-0">
          <h2 className="text-xl font-bold text-foreground">{t.team} <span className="text-sm font-normal text-muted-foreground">{t.division} · {t.season} · you&apos;re {ROLE[t.role]?.toLowerCase() ?? t.role}</span></h2>
          <p className="text-sm text-muted-foreground">{t.staff.map((s) => `${ROLE[s.role] ?? s.role}: ${s.name}`).join(" · ")}</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Bib</th><th className="py-1">Player</th><th className="py-1">Age</th></tr></thead>
            <tbody>
              {t.players.map((p, i) => (
                <tr key={i} className="border-t border-border"><td className="py-1.5 text-muted-foreground">{p.bib ?? ""}</td><td className="py-1.5 font-medium">{p.last_name}, {p.first_name}</td><td className="py-1.5">{p.league_age ?? ""}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground print:hidden"><Printer className="mr-1 inline h-3.5 w-3.5" />{t.players.length} {t.players.length === 1 ? "player" : "players"}. Print or save as PDF with the Print button.</p>
        </section>
      ))}
    </div>
  );
}

export default function MyTeamPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading your team…</p>}>
      <MyTeamContent />
    </Suspense>
  );
}
