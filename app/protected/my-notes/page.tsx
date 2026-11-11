import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ArrowLeft, Lock, MessageSquare, StickyNote } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { saveNote } from "./actions";

type SearchParams = Promise<{ message?: string; error?: string }>;

type MyNote = {
  player_season_id: number;
  session_id: number | null;
  season_id: number;
  season_name: string;
  season_closed: boolean;
  league_age: number | null;
  evaluation_number: number | null;
  first_name: string;
  last_name: string;
  kind: "private" | "shared";
  note_text: string;
  updated_at: string;
  editable: boolean;
};

const updated = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

async function MyNotesContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect("/auth/login");

  // Admins don't score, so they have no notes of their own.
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin === true) return redirect("/protected");

  const { data, error } = await supabase.rpc("my_notes");
  const notes = (data ?? []) as MyNote[];

  // Group by season, then age group (the database already sorts newest season first, then bib).
  const seasons = [...new Map(notes.map((n) => [n.season_id, n])).values()];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected/evaluations"><ArrowLeft className="mr-1 h-4 w-4" /> Back to evaluations</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <StickyNote className="h-7 w-7 text-emerald-700 dark:text-emerald-400" /> My Notes
        </h1>
        <p className="text-sm text-muted-foreground">
          Notes you wrote on players. Coach notes are private: only you can see them, and you can change them anytime.
          Independent evaluator notes are shared with coaches once the draft report is released, and lock with the session.
          Add a note from a player&apos;s scoring page.
        </p>
      </div>

      {params.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{params.message}</div>}
      {params.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{params.error}</div>}
      {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">Could not load your notes: {error.message}</div>}

      {!error && notes.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          You haven&apos;t written any notes yet. Open a player on the <Link href="/protected/evaluations" className="underline">Evaluations</Link> page and use the notes box.
        </div>
      )}

      {seasons.map((season) => (
        <section key={season.season_id} className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            {season.season_name}
            {season.season_closed && <span className="ml-2 text-xs font-normal text-muted-foreground">(season closed)</span>}
          </h2>
          <ul className="space-y-3">
            {notes.filter((n) => n.season_id === season.season_id).map((n) => (
              <li key={`${n.kind}-${n.player_season_id}`} className="rounded-lg border border-border bg-card p-3">
                <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-base font-bold text-foreground">{n.evaluation_number === null ? "No bib" : `#${n.evaluation_number}`}</span>
                  <span className="text-sm font-medium text-foreground">{n.last_name}, {n.first_name}</span>
                  <span className="text-xs text-muted-foreground">Age {n.league_age ?? "?"}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {n.kind === "private" ? <><Lock className="h-3 w-3" /> Private</> : <><MessageSquare className="h-3 w-3" /> Shared</>}
                  </span>
                  <span className="ml-auto text-[11px] text-muted-foreground">Updated {updated(n.updated_at)}</span>
                </div>
                {n.editable ? (
                  <form action={saveNote} className="space-y-2">
                    <input type="hidden" name="kind" value={n.kind} />
                    <input type="hidden" name="playerSeasonId" value={n.player_season_id} />
                    {n.session_id !== null && <input type="hidden" name="sessionId" value={n.session_id} />}
                    <input type="hidden" name="returnTo" value="/protected/my-notes" />
                    <label className="sr-only" htmlFor={`note-${n.kind}-${n.player_season_id}`}>Note</label>
                    <textarea
                      id={`note-${n.kind}-${n.player_season_id}`}
                      name="note"
                      defaultValue={n.note_text}
                      maxLength={2000}
                      rows={3}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 sm:text-sm"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">Clear the box and save to delete the note.</span>
                      <Button type="submit" size="sm" className="min-h-10">Save note</Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{n.note_text}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">Locked with the session.</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function MyNotesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <MyNotesContent searchParams={searchParams} />
    </Suspense>
  );
}
