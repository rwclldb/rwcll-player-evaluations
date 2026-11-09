import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  BarChart3, 
  ArrowLeft, 
  Users, 
  UserCheck, 
  Layers, 
  ShieldAlert,
  Download,
  FileText
} from "lucide-react";

type SearchParams = Promise<{ seasonId?: string }>;

type Season = {
  id: number;
  name: string;
  is_closed?: boolean;
};

type Registration = {
  id: number;
  player_id: number;
  season_id: number;
  league_age: number | null;
  evaluation_number: number | null;
  registration_payment_status: string | null;
  players: { first_name: string; last_name: string } | null;
};

async function ReportsContent({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/auth/login");
  }

  // Verify administrator permissions via RPC
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
  const administrator = !roleError && isAdmin === true;

  if (!administrator) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
            <Link href="/protected">
              <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Return to workspace
            </Link>
          </Button>
        </div>
        <h1 className="text-2xl font-bold text-foreground">Administrator Access Required</h1>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-700 dark:text-amber-400 shrink-0" />
          <span>Full league analytics and reports are restricted to assigned administrators.</span>
        </div>
      </div>
    );
  }

  // Fetch seasons for selector
  const { data: seasonsData, error: seasonError } = await supabase
    .from("seasons")
    .select("id, name, is_closed")
    .order("start_date", { ascending: false });

  const seasons = (seasonsData || []) as Season[];
  const selectedSeasonId = params.seasonId ? Number(params.seasonId) : seasons[0]?.id;
  const activeSeason = seasons.find((s) => s.id === selectedSeasonId) || seasons[0];

  // Fetch player registrations for selected season
  const registrationResult = activeSeason
    ? await supabase
        .from("player_seasons")
        .select(`
          id,
          player_id,
          season_id,
          league_age,
          evaluation_number,
          registration_payment_status,
          players (
            first_name,
            last_name
          )
        `)
        .eq("season_id", activeSeason.id)
        .order("league_age", { ascending: false })
        .order("evaluation_number", { ascending: true, nullsFirst: false })
    : { data: [], error: null };

  const registrations = (registrationResult.data || []) as unknown as Registration[];
  const queryError = seasonError || registrationResult.error;

  return (
    <div className="space-y-8">
      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
              <Link href="/protected">
                <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Back to workspace
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <BarChart3 className="h-7 w-7 text-emerald-700 dark:text-emerald-400" />
            League Executive Reports
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Administrator individual player reports, ratings, and league export tools.
          </p>
        </div>

        {activeSeason && (
          <Button asChild variant="outline" size="sm" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 text-xs font-mono">
            <a href={`/protected/reports/export?seasonId=${activeSeason.id}`}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export Season CSV
            </a>
          </Button>
        )}
      </div>

      {/* Season Selection Context */}
      {seasons.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="py-3 border-b border-border/50">
            <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> Select Season Context
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-2">
              {seasons.map((s) => {
                const isActive = activeSeason?.id === s.id;
                return (
                  <Button
                    key={s.id}
                    asChild
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    className={
                      isActive
                        ? "bg-emerald-600 hover:bg-emerald-500 text-foreground text-xs font-semibold"
                        : "border-border bg-background text-slate-700 dark:text-slate-300 hover:bg-accent text-xs"
                    }
                  >
                    <Link href={`/protected/reports?seasonId=${s.id}`}>
                      {s.name} {s.is_closed ? "(Closed)" : ""}
                    </Link>
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total Registrations
            </CardTitle>
            <Users className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground font-mono">{registrations.length}</div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Registered in {activeSeason?.name || "season"}</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Assigned Eval #s
            </CardTitle>
            <UserCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 font-mono">
              {registrations.filter((r) => r.evaluation_number !== null).length}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Ready for station evaluation</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Active Season Context
            </CardTitle>
            <Layers className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-foreground font-mono truncate">
              {activeSeason?.name || "None"}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{activeSeason?.is_closed ? "Closed" : "Active Workspace"}</p>
          </CardContent>
        </Card>
      </div>

      {/* Roster & Player Reports Table */}
      <Card className="border-border bg-card">
        <CardHeader className="py-4 border-b border-border/50">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            Player Directory & Report Log
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Open individual player reports or review league evaluation status.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          {queryError ? (
            <div className="p-6 text-xs text-rose-700 dark:text-rose-300 font-mono">
              Could not load player reports: {queryError.message}
            </div>
          ) : registrations.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-600 dark:text-slate-400 italic">
              No player registrations found for {activeSeason?.name || "this season"}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-background text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Eval #</th>
                    <th className="px-4 py-3">Player Name</th>
                    <th className="px-4 py-3 text-center">League Age</th>
                    <th className="px-4 py-3">Payment Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {registrations.map((registration) => {
                    const playerData = Array.isArray(registration.players)
                      ? registration.players[0]
                      : registration.players;

                    const firstName = playerData?.first_name || "";
                    const lastName = playerData?.last_name || "";
                    const name = playerData ? `${lastName}, ${firstName}` : `Registration #${registration.id}`;

                    return (
                      <tr key={registration.id} className="hover:bg-accent/50 transition-colors">
                        <td className="px-4 py-3 font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">
                          {registration.evaluation_number ? `#${registration.evaluation_number}` : "—"}
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground text-xs">
                          {name}
                        </td>
                        <td className="px-4 py-3 text-center text-xs font-mono text-slate-700 dark:text-slate-300 font-bold">
                          {registration.league_age ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs font-mono">
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              registration.registration_payment_status?.toLowerCase() === "paid" ||
                              registration.registration_payment_status?.toLowerCase() === "completed"
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            }`}
                          >
                            {registration.registration_payment_status ?? "Unknown"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button asChild variant="outline" size="sm" className="h-7 border-border bg-background text-xs text-slate-700 dark:text-slate-300 hover:bg-accent hover:text-foreground">
                            <Link href={`/protected/reports/player/${registration.id}`}>
                              <FileText className="h-3.5 w-3.5 mr-1 text-emerald-700 dark:text-emerald-400" /> Open Report
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense
      fallback={
        <div className="h-96 w-full rounded-lg border border-border bg-card animate-pulse" />
      }
    >
      <ReportsContent searchParams={searchParams} />
    </Suspense>
  );
}