import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ReviewDecisionForm } from "./review-decision-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft, 
  FileSpreadsheet, 
  ShieldAlert, 
  CheckCircle2, 
  UserCheck, 
  AlertTriangle,
  FileCheck
} from "lucide-react";

type Row = {
  id: number;
  source_row_number: number;
  external_player_id: string | null;
  first_name: string;
  last_name: string;
  birth_date_text: string | null;
  birth_date: string | null;
  source_program: string | null;
  source_division: string | null;
  registration_number: string | null;
  payment_status: string | null;
  league_age: number | null;
  review_flags: unknown;
  review_state: string;
  matched_player_id: number | null;
  committed_player_season_id: number | null;
  duplicate_player_id_resolved_at: string | null;
  duplicate_player_id_resolved_by: string | null;
  duplicate_player_id_resolution_reason: string | null;
};

type Player = {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
};

function flags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 30) : [];
}

// Which rows the review list shows. Default hides rows that need nothing more: ignored (the admin chose not
// to use them) and committed. Ignored rows can be reopened from the Ignored view.
// Rows for players already registered this season; their changes are handled on the batch page.
const SYNC_STATES = ["up_to_date", "has_changes", "changes_reviewed"];

const VIEWS = [
  { key: "open", label: "Needs work", test: (s: string) => s !== "ignored" && s !== "committed" && !SYNC_STATES.includes(s) },
  { key: "registered", label: "Already registered", test: (s: string) => SYNC_STATES.includes(s) },
  { key: "ignored", label: "Ignored", test: (s: string) => s === "ignored" },
  { key: "committed", label: "Committed", test: (s: string) => s === "committed" },
  { key: "all", label: "All rows", test: () => true },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

async function ImportBatchReviewContent({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<{ show?: string }> }) {
  const { batchId } = await params;
  const { show } = await searchParams;
  const view = VIEWS.find((v) => v.key === show) ?? VIEWS[0];
  const id = Number(batchId);

  if (!Number.isSafeInteger(id) || id < 1) {
    return (
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected/import-batches">
            <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Back to staged batches
          </Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">Invalid Batch ID</h1>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/auth/login");
  }

  // Verify administrator permissions via Supabase RPC function
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError || isAdmin !== true) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
            <Link href="/protected">
              <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Home
            </Link>
          </Button>
        </div>
        <h1 className="text-2xl font-bold text-foreground">Administrator Access Required</h1>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-700 dark:text-amber-400 shrink-0" />
          <span>Only administrators can record import review decisions.</span>
        </div>
      </div>
    );
  }

  // Fetch batch details
  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .select("id, source_file_name, status, season_id")
    .eq("id", id)
    .eq("import_type", "players")
    .maybeSingle();

  if (batchError || !batch) {
    return (
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected/import-batches">
            <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Back to batches
          </Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">Batch Unavailable</h1>
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300 font-mono">
          Could not load this player import batch. No data was changed.
        </div>
      </div>
    );
  }

  // Fetch staged rows
  const { data: rows, error: rowsError } = await supabase
    .from("sports_connect_import_rows")
    .select("id, source_row_number, external_player_id, first_name, last_name, birth_date_text, birth_date, source_program, source_division, registration_number, payment_status, league_age, review_flags, review_state, matched_player_id, committed_player_season_id, duplicate_player_id_resolved_at, duplicate_player_id_resolved_by, duplicate_player_id_resolution_reason")
    .eq("import_batch_id", id)
    .order("source_row_number", { ascending: true })
    .limit(5000);

  // Fetch candidates for matching
  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("id, first_name, last_name, date_of_birth")
    .order("id", { ascending: true })
    .limit(1000);

  const candidates = (players ?? []) as Player[];
  const allRows = (rows ?? []) as Row[];
  const counts = Object.fromEntries(VIEWS.map((v) => [v.key, allRows.filter((r) => v.test(r.review_state)).length])) as Record<ViewKey, number>;
  const shownRows = allRows.filter((r) => view.test(r.review_state));

  // Fetch committed player details for committed rows
  const committedRegistrationIds = (rows ?? [])
    .map((row) => (row as Row).committed_player_season_id)
    .filter((value): value is number => value !== null);

  const { data: committedRegistrations } = committedRegistrationIds.length
    ? await supabase.from("player_seasons").select("id, player_id").in("id", committedRegistrationIds)
    : { data: [] };

  const committedPlayerIds = [
    ...new Set((committedRegistrations ?? []).map((registration) => registration.player_id)),
  ];

  const { data: committedPlayers } = committedPlayerIds.length
    ? await supabase.from("players").select("id, first_name, last_name, date_of_birth").in("id", committedPlayerIds)
    : { data: [] };

  const committedPlayerByRegistrationId = new Map(
    (committedRegistrations ?? []).map((registration) => [
      registration.id,
      (committedPlayers ?? []).find((player) => player.id === registration.player_id),
    ])
  );

  return (
    <div className="space-y-6">
      {/* Top Navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
              <Link href={`/protected/import-batches/${id}`}>
                <ArrowLeft className="h-4 w-4 mr-1 text-emerald-700 dark:text-emerald-400" /> Back to Batch Detail
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ShieldAlert className="h-7 w-7 text-amber-700 dark:text-amber-400" />
            Administrator Row Review &bull; Batch #{id}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground font-mono">
            {batch.source_file_name || "Unnamed file"}
          </p>
        </div>
      </div>

      {/* Warning Notice Banner */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200/90 leading-relaxed">
        <strong className="text-amber-800 dark:text-amber-300 font-semibold">Review only.</strong> Saving a decision updates the staged row and audit log. It does not create or update players or registrations, merge identities, or commit the batch.
      </div>

      {playersError && (
        <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300 font-mono">
          Existing-player candidates could not be loaded. Approved-match decisions require a player selection; do not infer identity from a Sports Connect ID.
        </div>
      )}

      {rowsError ? (
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300 font-mono">
          Could not load staged rows. Confirm the local staging and review-decision migrations are applied.
        </div>
      ) : !rows?.length ? (
        <Card className="border-border bg-card p-8 text-center text-xs text-muted-foreground">
          No staged rows in this batch.
        </Card>
      ) : (
        <div className="space-y-6">
          <nav aria-label="Filter rows" className="flex flex-wrap items-center gap-2">
            {VIEWS.map((v) => (
              <Link key={v.key} href={`/protected/import-batches/${id}/review${v.key === "open" ? "" : `?show=${v.key}`}`}
                aria-current={v.key === view.key ? "page" : undefined}
                className={`rounded-full border px-3 py-1.5 text-sm ${v.key === view.key ? "border-emerald-500 bg-emerald-600 text-white" : "border-border bg-card text-foreground hover:bg-accent"}`}>
                {v.label} <span className="ml-1 font-mono text-xs opacity-80">{counts[v.key]}</span>
              </Link>
            ))}
            {view.key === "open" && counts.ignored + counts.committed + counts.registered > 0 && (
              <span className="text-xs text-muted-foreground">
                Hiding {counts.ignored} ignored, {counts.committed} committed and {counts.registered} already registered. To use an ignored row after all, open Ignored and click Reopen Ignored Row.
              </span>
            )}
          </nav>
          {shownRows.length === 0 && (
            <Card className="border-border bg-card p-8 text-center text-sm text-muted-foreground">
              {view.key === "open" ? "Nothing left to review in this batch." : `No ${view.label.toLowerCase()} rows.`}
            </Card>
          )}
          {shownRows.map((rowData) => {
            const name = `${rowData.first_name} ${rowData.last_name}`.trim().toLocaleLowerCase("en-US");
            const date = rowData.birth_date;
            const matches = candidates
              .filter(
                (p) =>
                  `${p.first_name} ${p.last_name}`.trim().toLocaleLowerCase("en-US") === name ||
                  (date && p.date_of_birth === date)
              )
              .slice(0, 10);

            const committedRegistrationId = rowData.committed_player_season_id;
            const committedPlayer =
              committedRegistrationId == null
                ? undefined
                : committedPlayerByRegistrationId.get(committedRegistrationId);
            const committedPlayerLabel = committedPlayer
              ? `#${committedPlayer.id} · ${committedPlayer.first_name} ${committedPlayer.last_name}`
              : null;

            return (
              <Card key={rowData.id} className="border-border bg-card">
                <CardHeader className="py-4 border-b border-border/50">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                        Row {rowData.source_row_number}: {rowData.first_name} {rowData.last_name}
                      </CardTitle>
                      <CardDescription className="text-xs text-muted-foreground font-mono mt-0.5">
                        Staged row #{rowData.id} &bull; State: {rowData.review_state}
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className="font-mono text-xs border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 w-fit">
                      {rowData.review_state}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4 pt-4">
                  {/* Row Details Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs bg-background p-4 rounded-lg border border-border">
                    <div>
                      <span className="text-muted-foreground block font-mono text-[11px]">Sports Connect ID</span>
                      <span className="text-foreground font-mono font-semibold">{rowData.external_player_id || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[11px]">Birth Date</span>
                      <span className="text-foreground font-mono">{rowData.birth_date_text || rowData.birth_date || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[11px]">Program / Division</span>
                      <span className="text-foreground">{rowData.source_program || "—"} / {rowData.source_division || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[11px]">Registration / Payment</span>
                      <span className="text-foreground">{rowData.registration_number || "—"} / {rowData.payment_status || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[11px]">League Age</span>
                      <span className="text-emerald-700 dark:text-emerald-400 font-mono font-bold">{rowData.league_age ?? "—"}</span>
                    </div>
                  </div>

                  {/* Review Flags */}
                  {flags(rowData.review_flags).length > 0 && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                      <strong className="font-semibold text-amber-700 dark:text-amber-400 mr-1">Flags:</strong>
                      {flags(rowData.review_flags).join(" · ")}
                    </div>
                  )}

                  {SYNC_STATES.includes(rowData.review_state) ? (
                    <p className="rounded-md border border-border bg-background p-3 text-sm text-foreground">
                      This player is already registered this season.{" "}
                      {rowData.review_state === "has_changes" ? "Their changes wait for you" : "Nothing to decide here; see the details"} on the{" "}
                      <Link href={`/protected/import-batches/${id}#registered`} className="font-medium underline">batch page</Link>.
                    </p>
                  ) : (
                  <ReviewDecisionForm
                    rowId={rowData.id}
                    batchId={id}
                    currentDecision={rowData.review_state}
                    currentMatchedPlayerId={rowData.matched_player_id}
                    committedPlayerLabel={committedPlayerLabel}
                    committedPlayerSeasonId={rowData.committed_player_season_id}
                    candidates={matches.map((p) => ({
                      id: p.id,
                      label: `#${p.id} · ${p.first_name} ${p.last_name}${p.date_of_birth ? ` · ${p.date_of_birth}` : ""}`,
                    }))}
                    hasDuplicatePlayerIdFlag={flags(rowData.review_flags).includes("Duplicate Player ID in file")}
                    duplicatePlayerIdResolvedAt={rowData.duplicate_player_id_resolved_at}
                    duplicatePlayerIdResolutionReason={rowData.duplicate_player_id_resolution_reason}
                    disabled={rowData.review_state === "committed" || Boolean(rowsError)}
                  />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
        Candidate list is limited to the first 1,000 visible players and up to 10 suggestions per row. A suggestion is not an identity match; verify manually.
      </p>
    </div>
  );
}

export default function ImportBatchReviewPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<{ show?: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="h-96 w-full rounded-lg border border-border bg-card animate-pulse" />
      }
    >
      <ImportBatchReviewContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}