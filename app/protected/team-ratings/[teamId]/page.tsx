import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import type { RatingSheet } from "@/lib/team-ratings";
import { TeamRatingSheet } from "./rating-sheet";

type Params = Promise<{ teamId: string }>;

async function SheetContent({ params }: { params: Params }) {
  const { teamId } = await params;
  const supabase = await createClient();
  const [{ data: isAdmin }, { data, error }, { data: categoryData }] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase.rpc("team_rating_sheet", { p_team_id: Number(teamId) }),
    supabase.from("rating_categories").select("id, code, name, category_group, sort_order").order("sort_order"),
  ]);
  const sheet = data as RatingSheet | null;
  const backHref = isAdmin === true ? `/protected/team-ratings${sheet ? `?season=${sheet.season_id}` : ""}` : "/protected";
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
        <Link href={backHref}><ArrowLeft className="mr-1 h-4 w-4" /> {isAdmin === true ? "End-of-season ratings" : "Home"}</Link>
      </Button>
      {error || !sheet
        ? <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{error?.message ?? "Team not found."}</p>
        : <TeamRatingSheet sheet={sheet} categories={categoryData ?? []} byAdmin={isAdmin === true} />}
    </div>
  );
}

export default function TeamRatingSheetPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading your team…</p>}>
      <SheetContent params={params} />
    </Suspense>
  );
}
