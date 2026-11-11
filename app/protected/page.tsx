import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { createSeason } from "@/app/actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  ClipboardList, 
  Users, 
  Calendar, 
  FileBarChart, 
  Award,
  ArrowRight,
  PlusCircle,
  Sparkles,
  ShieldCheck,
  UploadCloud,
  FileSpreadsheet,
  ClipboardCheck
} from "lucide-react";

type SeasonListItem = {
  id: number;
  name: string;
  start_date: string | null;
  end_date: string | null;
  is_closed: boolean;
};

async function ProtectedDashboardContent() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/auth/login");
  }

  // Check admin privileges via Supabase RPC function
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
  const administrator = !roleError && isAdmin === true;

  // Fetch all seasons ordered by start_date descending
  const { data: seasons, error: seasonsError } = await supabase
    .from("seasons")
    .select("id, name, start_date, end_date, is_closed")
    .order("start_date", { ascending: false, nullsFirst: false });

  if (seasonsError) {
    console.error("Error fetching seasons:", seasonsError);
  }

  // Resolve active season
  const seasonList = seasons || [];
  const activeSeason = seasonList.find((s) => !s.is_closed) || seasonList[0];
  const activeSeasonName = activeSeason ? activeSeason.name : "No active season";

  return (
    <div className="space-y-8">
      {/* Welcome & Active Season Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Evaluations Dashboard
          </h1>
          <div className="mt-1 text-sm text-muted-foreground flex items-center gap-2">
            <span>Welcome back, <span className="text-emerald-700 dark:text-emerald-400 font-mono">{user.email}</span></span>
            {administrator && (
              <Badge variant="outline" className="text-[10px] font-mono border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1">
                <ShieldCheck className="h-3 w-3" /> Admin Mode
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="py-1 px-3 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-mono text-xs">
            Active Season: {activeSeasonName}
          </Badge>
          {!administrator && (
            <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-foreground">
              <Link href="/protected/evaluations">
                Start Scoring <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Admin Registration Section */}
      {administrator && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-mono uppercase tracking-wider text-amber-700 dark:text-amber-400 font-semibold flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Registration Administration
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Sports Connect Import Card */}
            <Card className="border-border bg-card hover:border-amber-500/40 transition-colors group">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base font-semibold text-foreground">
                  Sports Connect Import
                </CardTitle>
                <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-700 dark:text-amber-400 group-hover:bg-amber-500 group-hover:text-foreground transition-colors">
                  <UploadCloud className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <CardDescription className="text-xs text-muted-foreground">
                  Upload and stage new CSV player rosters exported from Sports Connect.
                </CardDescription>
                <Button asChild variant="outline" className="w-full border-border bg-background hover:bg-accent text-amber-800 dark:text-amber-300 text-xs">
                  <Link href="/protected/import-preview">Sports Connect Import</Link>
                </Button>
              </CardContent>
            </Card>

            {/* Staged Import Review Card */}
            <Card className="border-border bg-card hover:border-amber-500/40 transition-colors group">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base font-semibold text-foreground">
                  Staged Import Review
                </CardTitle>
                <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-700 dark:text-amber-400 group-hover:bg-amber-500 group-hover:text-foreground transition-colors">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <CardDescription className="text-xs text-muted-foreground">
                  Review historical player batch imports and check mapping errors.
                </CardDescription>
                <Button asChild variant="outline" className="w-full border-border bg-background hover:bg-accent text-amber-800 dark:text-amber-300 text-xs">
                  <Link href="/protected/import-batches">Review Staged Batches</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Season Management Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Season Form — Rendered ONLY for Admins */}
        {administrator && (
          <Card className="border-border bg-card lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <PlusCircle className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                Create New Season
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Set up a new evaluation workspace for your league.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createSeason} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-xs text-slate-700 dark:text-slate-300">
                    Season Name
                  </Label>
                  <Input
                    id="name"
                    name="name"
                    required
                    placeholder="e.g., Spring 2027"
                    className="bg-background border-border text-foreground text-xs placeholder:text-slate-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="start_date" className="text-xs text-slate-700 dark:text-slate-300">
                      Start Date
                    </Label>
                    <Input
                      id="start_date"
                      name="start_date"
                      type="date"
                      className="bg-background border-border text-foreground text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="end_date" className="text-xs text-slate-700 dark:text-slate-300">
                      End Date
                    </Label>
                    <Input
                      id="end_date"
                      name="end_date"
                      type="date"
                      className="bg-background border-border text-foreground text-xs"
                    />
                  </div>
                </div>

                <Button type="submit" size="sm" className="w-full bg-emerald-600 hover:bg-emerald-500 text-foreground text-xs">
                  Create Season
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Existing Seasons Directory */}
        <Card className={`border-border bg-card ${administrator ? "lg:col-span-2" : "lg:col-span-3"}`}>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              League Seasons Directory
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Active evaluation workspace and archived historical seasons.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {seasonsError ? (
              <p className="text-xs text-rose-700 dark:text-rose-400">Could not load seasons: {seasonsError.message}</p>
            ) : seasonList.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-xs text-muted-foreground">Active Season: <span className="font-mono text-emerald-700 dark:text-emerald-400 font-semibold">e.g. Spring 2027</span></p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {seasonList.map((season: SeasonListItem) => (
                  <div key={season.id} className="flex items-center justify-between py-3">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">{season.name}</h4>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        {season.start_date || "No start date"} – {season.end_date || "No end date"}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs font-mono ${
                        season.is_closed
                          ? "border-border bg-muted text-muted-foreground"
                          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      {season.is_closed ? "Closed" : "Active / Open"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Navigation Feature Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Render Player Evaluations ONLY for Non-Admin Evaluators */}
        {!administrator ? (
          <>
            <Card className="hover:border-emerald-500/50 transition-colors group border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg font-semibold text-foreground">
                  Player Evaluations
                </CardTitle>
                <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-700 dark:text-emerald-400 group-hover:bg-emerald-500 group-hover:text-foreground transition-colors">
                  <ClipboardList className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <CardDescription className="text-muted-foreground">
                  Input and manage station scores for hitting, fielding, throwing, and running.
                </CardDescription>
                <Button asChild variant="outline" className="w-full border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground">
                  <Link href="/protected/evaluations">Enter Scores</Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="hover:border-emerald-500/50 transition-colors group border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg font-semibold text-foreground">
                  Evaluator Assignments
                </CardTitle>
                <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-700 dark:text-emerald-400 group-hover:bg-emerald-500 group-hover:text-foreground transition-colors">
                  <Users className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <CardDescription className="text-muted-foreground">
                  Check station assignments, evaluator responsibilities, and age division rotations.
                </CardDescription>
                <Button asChild variant="outline" className="w-full border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground">
                  <Link href="/protected/assignments">View Assignments</Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="hover:border-emerald-500/50 transition-colors group border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg font-semibold text-foreground">
                  Evaluation Sessions
                </CardTitle>
                <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-700 dark:text-emerald-400 group-hover:bg-emerald-500 group-hover:text-foreground transition-colors">
                  <Calendar className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <CardDescription className="text-muted-foreground">
                  Manage check-in times, age group schedules, and batch player registration uploads.
                </CardDescription>
                <Button asChild variant="outline" className="w-full border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground">
                  <Link href="/protected/sessions">Manage Sessions</Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="hover:border-emerald-500/50 transition-colors group border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg font-semibold text-foreground">
                  Draft Reports
                </CardTitle>
                <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-700 dark:text-emerald-400 group-hover:bg-emerald-500 group-hover:text-foreground transition-colors">
                  <Award className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <CardDescription className="text-muted-foreground">
                  Coach and evaluator averages with prior-year ratings, by age group. Available once an administrator releases each age group.
                </CardDescription>
                <Button asChild variant="outline" className="w-full border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground">
                  <Link href="/protected/draft-reports">Open Draft Reports</Link>
                </Button>
              </CardContent>
            </Card>
          </>
        ) : (
          /* Render Admin-Only Modules */
          <>
            <Card className="hover:border-emerald-500/50 transition-colors group border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg font-semibold text-foreground">Draft Reports</CardTitle>
                <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-700 dark:text-emerald-400">
                  <Award className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <CardDescription className="text-muted-foreground">
                  Coach and evaluator averages by age group. You can view them anytime; coaches see an age group after you release it.
                </CardDescription>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button asChild variant="outline" className="w-full border-border bg-card text-foreground hover:bg-accent">
                    <Link href="/protected/draft-reports">Draft Reports</Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full border-border bg-card text-foreground hover:bg-accent">
                    <Link href="/protected/roster">Evaluation-Day Roster</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="hover:border-emerald-500/50 transition-colors group border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg font-semibold text-foreground">
                  Data Review
                </CardTitle>
                <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-700 dark:text-emerald-400 group-hover:bg-emerald-500 group-hover:text-foreground transition-colors">
                  <ClipboardCheck className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <CardDescription className="text-muted-foreground">
                  Audit live evaluation progress, evaluator completion logs, and missing ratings.
                </CardDescription>
                <Button asChild variant="outline" className="w-full border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground">
                  <Link href="/protected/evaluation-review">Review Evaluations</Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="hover:border-emerald-500/50 transition-colors group border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg font-semibold text-foreground">
                  Evaluator Assignments
                </CardTitle>
                <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-700 dark:text-emerald-400 group-hover:bg-emerald-500 group-hover:text-foreground transition-colors">
                  <Users className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <CardDescription className="text-muted-foreground">
                  Check station assignments, evaluator responsibilities, and age division rotations.
                </CardDescription>
                <Button asChild variant="outline" className="w-full border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground">
                  <Link href="/protected/assignments">View Assignments</Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="hover:border-emerald-500/50 transition-colors group border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg font-semibold text-foreground">
                  Evaluation Sessions
                </CardTitle>
                <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-700 dark:text-emerald-400 group-hover:bg-emerald-500 group-hover:text-foreground transition-colors">
                  <Calendar className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <CardDescription className="text-muted-foreground">
                  Manage check-in times, age group schedules, and batch player registration uploads.
                </CardDescription>
                <Button asChild variant="outline" className="w-full border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground">
                  <Link href="/protected/sessions">Manage Sessions</Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="hover:border-emerald-500/50 transition-colors group border-border bg-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg font-semibold text-foreground">
                  Reports & Exports
                </CardTitle>
                <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-700 dark:text-emerald-400 group-hover:bg-emerald-500 group-hover:text-foreground transition-colors">
                  <FileBarChart className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <CardDescription className="text-muted-foreground">
                  Export raw rating CSVs, view overall division score breakdowns, and track completion.
                </CardDescription>
                <Button asChild variant="outline" className="w-full border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground">
                  <Link href="/protected/reports">View Reports</Link>
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

export default function ProtectedPage() {
  return (
    <Suspense
      fallback={
        <div className="h-96 w-full rounded-lg border border-border bg-card animate-pulse" />
      }
    >
      <ProtectedDashboardContent />
    </Suspense>
  );
}