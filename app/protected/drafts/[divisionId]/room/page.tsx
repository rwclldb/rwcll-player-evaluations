import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import type { Board, RoomPlayer } from "@/lib/draft-room";
import { DraftRoom } from "./draft-room";

type Params = Promise<{ divisionId: string }>;
type SearchParams = Promise<{ view?: string }>;

async function RoomContent({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { divisionId } = await params;
  const { view } = await searchParams;
  const supabase = await createClient();
  // my_drafts() lists only drafts this person may watch: admins and registrars, and the division's managers and coaches.
  const { data: mine } = await supabase.rpc("my_drafts");
  const row = ((mine ?? []) as { draft_id: number; season_division_id: number; status: string }[])
    .find((d) => String(d.season_division_id) === divisionId);
  if (!row) {
    return (
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground"><Link href="/protected"><ArrowLeft className="mr-1 h-4 w-4" /> Home</Link></Button>
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          This draft isn&apos;t open to you. Only the division&apos;s managers and coaches, league admins and registrars can watch it.
        </p>
      </div>
    );
  }
  const [{ data: board, error }, { data: players }] = await Promise.all([
    supabase.rpc("draft_board", { p_draft_id: row.draft_id }),
    supabase.rpc("draft_players", { p_draft_id: row.draft_id }),
  ]);
  if (error || !board) {
    return <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">Could not load the draft: {error?.message ?? "not found"}</p>;
  }
  const b = board as Board;
  if (b.draft.status === "setup") {
    return (
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground">
          <Link href={b.can_run ? `/protected/drafts/${divisionId}` : "/protected"}><ArrowLeft className="mr-1 h-4 w-4" /> {b.can_run ? "Draft setup" : "Home"}</Link>
        </Button>
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          The {b.draft.division} draft hasn&apos;t started yet. {b.can_run ? "Start it from the draft setup page." : "This page shows the board once it starts; keep it open or come back then."}
        </p>
      </div>
    );
  }
  return (
    <DraftRoom draftId={row.draft_id} divisionId={Number(divisionId)} initialBoard={b} initialPlayers={(players ?? []) as RoomPlayer[]} projector={view === "board"} />
  );
}

export default function DraftRoomPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading the draft…</p>}>
      <RoomContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
