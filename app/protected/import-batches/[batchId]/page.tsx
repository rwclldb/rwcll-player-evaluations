import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertCircle, 
  UserCheck, 
  Clock,
  Layers,
  ShieldAlert,
  ArrowRight,
  UserSearch
} from "lucide-react";

type StagedRow = {
  id: number;
  source_row_number: number;
  external_player_id: string | null;
  first_name: string;
  last_name: string;
  birth_date_text: string;
  birth_date: string | null;
  source_program: string;
  source_division: string;
  registration_number: string | null;
  payment_status: string;
  league_age: number | null;
  review_flags: unknown;
  review_state: string;
};

type ExistingPlayer = {
  id: number;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
};

type MatchCandidate = {
  player: ExistingPlayer;
  reason: string;
  strength: number;
};

function normalizedName(first: string, last: string): string {
  return `${first} ${last}`.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function buildCandidateIndex(players: ExistingPlayer[]) {
  const byName = new Map<string, ExistingPlayer[]>();
  const byBirthDate = new Map<string, ExistingPlayer[]>();
  for (const player of players) {
    const name = normalizedName(player.first_name, player.last_name);
    if (name) byName.set(name, [...(byName.get(name) ?? []), player]);
    if (player.date_of_birth) byBirthDate.set(player.date_of_birth, [...(byBirthDate.get(player.date_of_birth) ?? []), player]);
  }
  return { byName, byBirthDate };
}

function candidatesFor(row: StagedRow, index: ReturnType<typeof buildCandidateIndex>): MatchCandidate[] {
  const rowName = normalizedName(row.first_name, row.last_name);
  const possible = new Map<number, ExistingPlayer>();
  for (const player of index.byName.get(rowName) ?? []) possible.set(player.id, player);
  if (row.birth_date) {
    for (const player of index.byBirthDate.get(row.birth_date) ?? []) possible.set(player.id, player);
  }
  return [...possible.values()]
    .map((player) => {
      const sameName = Boolean(rowName) && rowName === normalizedName(player.first_name, player.last_name);
      const sameBirthDate = Boolean(row.birth_date) && Boolean(player.date_of_birth) && row.birth_date === player.date_of_birth;
      if (sameName && sameBirthDate) return { player, reason: "Name and birth date match", strength: 3 };
      if (sameName) return { player, reason: "Name matches; birth date differs or is missing", strength: 2 };
      return { player, reason: "Birth date matches; name differs", strength: 1 };
    })
    .sort((a, b) => b.strength - a.strength || a.player.id - b.player.id)
    .slice(0, 3);
}

function flagsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 30);
}

async function ImportBatchDetailContent({ batchId }: { batchId: string }) {
  const numericId = Number(batchId);
  if (!Number.isSafeInteger(numericId) || numericId < 1) {
    return (
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected/import-batches">
            <ArrowLeft className="h-4 w-4 mr-1 text-emerald-400" /> Back to staged batches
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
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
  const administrator = !roleError && isAdmin === true;

  if (!administrator) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
            <Link href="/protected">
              <ArrowLeft className="h-4 w-4 mr-1 text-emerald-400" /> Return to workspace
            </Link>
          </Button>
        </div>
        <h1 className="text-2xl font-bold text-foreground">Administrator Access Required</h1>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200 flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0" />
          <span>Staged import rows are restricted to assigned administrators.</span>
        </div>
      </div>
    );
  }

  // Fetch batch details
  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .select("id, source_file_name, status, rows_received, rows_with_errors, created_at, season_id")
    .eq("id", numericId)
    .eq("import_type", "players")
    .maybeSingle();

  if (batchError) {
    return (
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected/import-batches">
            <ArrowLeft className="h-4 w-4 mr-1 text-emerald-400" /> Back to staged batches
          </Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">Batch Review Unavailable</h1>
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300 font-mono">
          Could not read this batch. Confirm the Phase 5.0 migration is installed in the intended database. No data was changed.
        </div>
      </div>
    );
  }

  if (!batch) {
    return notFound();
  }

  // Fetch staged rows for this batch
  const { data: rows, error: rowsError } = await supabase
    .from("sports_connect_import_rows")
    .select("id, source_row_number, external_player_id, first_name, last_name, birth_date_text, birth_date, source_program, source_division, registration_number, payment_status, league_age, review_flags, review_state")
    .eq("import_batch_id", numericId)
    .order("source_row_number", { ascending: true })
    .limit(5000);

  // Fetch existing players in chunks of 1000 up to 10,000 for candidate matching
  const candidatePlayers: ExistingPlayer[] = [];
  let playersError: { message: string } | null = null;

  for (let offset = 0; offset < 10000; offset += 1000) {
    const { data: playerPage, error: playerPageError } = await supabase
      .from("players")
      .select("id, first_name, last_name, date_of_birth")
      .order("id", { ascending: true })
      .range(offset, offset + 999);

    if (playerPageError) {
      playersError = playerPageError;
      break;
    }
    candidatePlayers.push(...((playerPage ?? []) as ExistingPlayer[]));
    if (!playerPage || playerPage.length < 1000) break;
  }

  const candidateIndex = buildCandidateIndex(candidatePlayers);

  return (
    <div className="space-y-6">
      {/* Top Header & Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
              <Link href="/protected/import-batches">
                <ArrowLeft className="h-4 w-4 mr-1 text-emerald-400" /> Back to Staged Batches
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex items-center gap-2">
            <FileSpreadsheet className="h-7 w-7 text-emerald-400" />
            Import Batch #{batch.id}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground font-mono">
            {batch.source_file_name || "Unnamed source file"} &bull; Created {new Date(batch.created_at).toLocaleString()}
          </p>
        </div>

        <Button asChild className="bg-emerald-600 hover:bg-emerald-500 text-foreground text-xs">
          <Link href={`/protected/import-batches/${batch.id}/review`}>
            Open Administrator Row Review <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {/* Read-Only Notice */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200/90 leading-relaxed">
        <strong className="text-amber-300 font-semibold">Read-only review.</strong> Possible matches below are suggestions only. They never link or merge players, approve rows, or commit registrations.
      </div>

      {playersError ? (
        <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          Existing-player suggestions are unavailable for this view. Confirm administrator read access to players. Staged rows remain unchanged.
        </div>
      ) : (
        <p className="text-xs font-mono text-muted-foreground">
          Candidate matching compares names and birth dates against up to 10,000 existing player records. Sports Connect IDs are not treated as permanent player identities. Review every suggestion manually.
        </p>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Rows Received
            </CardTitle>
            <Layers className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground font-mono">
              {batch.rows_received}
            </div>
            <p className="text-xs text-slate-500 mt-1">Staged in CSV payload</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Rows Flagged
            </CardTitle>
            <AlertCircle className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400 font-mono">
              {batch.rows_with_errors}
            </div>
            <p className="text-xs text-slate-500 mt-1">Validation or duplicate warnings</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Batch Status
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-emerald-400 font-mono capitalize">
              {batch.status}
            </div>
            <p className="text-xs text-slate-500 mt-1">Staging state</p>
          </CardContent>
        </Card>
      </div>

      {/* Staged Rows Table Card */}
      <Card className="border-border bg-card">
        <CardHeader className="py-4 border-b border-border/50">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-emerald-400" />
            Staged Registration Rows & Candidates
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Raw staged CSV records mapped alongside candidate existing-player matches.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          {rowsError ? (
            <div role="alert" className="p-6 text-xs text-rose-300">
              Could not load staged rows. Confirm the staging migration is applied and the current account has administrator access.
            </div>
          ) : !rows?.length ? (
            <div className="p-8 text-center text-xs text-slate-500 italic">
              No staged rows were found for this batch.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-background text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Line</th>
                    <th className="px-4 py-3">External ID</th>
                    <th className="px-4 py-3">Player</th>
                    <th className="px-4 py-3">Birth Date</th>
                    <th className="px-4 py-3">Age</th>
                    <th className="px-4 py-3">Program</th>
                    <th className="px-4 py-3">Division</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3">Reg #</th>
                    <th className="px-4 py-3">Review Flags</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3 min-w-[280px]">Possible Existing-Player Matches</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(rows as StagedRow[]).map((row) => {
                    const flags = flagsOf(row.review_flags);
                    const candidates = playersError ? [] : candidatesFor(row, candidateIndex);

                    return (
                      <tr key={row.id} className="hover:bg-accent/50 transition-colors align-top">
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.source_row_number}</td>
                        <td className="px-4 py-3 font-mono text-xs text-emerald-400 font-semibold">{row.external_player_id || "—"}</td>
                        <td className="px-4 py-3 font-medium text-foreground text-xs">{row.first_name} {row.last_name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-300">{row.birth_date_text || row.birth_date || "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-300">{row.league_age ?? "Review"}</td>
                        <td className="px-4 py-3 text-xs text-slate-300">{row.source_program || "—"}</td>
                        <td className="px-4 py-3 text-xs text-slate-300">{row.source_division || "—"}</td>
                        <td className="px-4 py-3 text-xs text-slate-300">{row.payment_status || "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.registration_number || "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex max-w-sm flex-wrap gap-1">
                            {flags.length ? (
                              flags.map((flag, index) => (
                                <Badge key={`${flag}-${index}`} variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px] font-mono">
                                  {flag}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-slate-500 italic">No preview flags</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-slate-300">{row.review_state}</td>
                        <td className="px-4 py-3">
                          {playersError ? (
                            <span className="text-xs text-slate-500 italic">Unavailable</span>
                          ) : candidates.length ? (
                            <div className="space-y-1.5">
                              {candidates.map((candidate) => (
                                <div key={candidate.player.id} className="rounded border border-border bg-background p-2 text-xs">
                                  <p className="font-semibold text-foreground flex items-center gap-1 font-mono">
                                    <UserSearch className="h-3 w-3 text-emerald-400 shrink-0" />
                                    #{candidate.player.id} &bull; {candidate.player.first_name} {candidate.player.last_name}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                                    DOB: {candidate.player.date_of_birth || "unknown"}
                                  </p>
                                  <p className="text-[11px] text-amber-300 font-mono mt-0.5">
                                    {candidate.reason}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500 italic">No suggested match</span>
                          )}
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

      <p className="text-xs font-mono text-slate-500">
        This page displays staged data and read-only candidate suggestions only. Candidate results are not identity decisions. The eventual commit must use explicit administrator decisions and a separate atomic workflow.
      </p>
    </div>
  );
}

export default async function ImportBatchDetailPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="h-96 w-full rounded-lg border border-border bg-card animate-pulse" />
      }
    >
      <ImportBatchParams params={params} />
    </Suspense>
  );
}

async function ImportBatchParams({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  return <ImportBatchDetailContent batchId={batchId} />;
}