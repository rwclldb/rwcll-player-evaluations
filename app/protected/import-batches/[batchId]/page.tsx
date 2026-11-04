import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
  return [...possible.values()].map((player) => {
    const sameName = Boolean(rowName) && rowName === normalizedName(player.first_name, player.last_name);
    const sameBirthDate = Boolean(row.birth_date) && Boolean(player.date_of_birth) && row.birth_date === player.date_of_birth;
    if (sameName && sameBirthDate) return { player, reason: "Name and birth date match", strength: 3 };
    if (sameName) return { player, reason: "Name matches; birth date differs or is missing", strength: 2 };
    return { player, reason: "Birth date matches; name differs", strength: 1 };
  }).sort((a, b) => b.strength - a.strength || a.player.id - b.player.id).slice(0, 3);
}

function flagsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 30);
}

async function ImportBatchDetailContent({ batchId }: { batchId: string }) {
  await connection();
  const numericId = Number(batchId);
  if (!Number.isSafeInteger(numericId) || numericId < 1) {
    return <section className="flex flex-col gap-4"><h1 className="text-2xl font-bold">Invalid batch ID</h1><Link className="underline" href="/protected/import-batches">← Back to staged batches</Link></section>;
  }

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims) redirect("/auth/login");
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
  if (roleError || isAdmin !== true) {
    return <section className="flex flex-col gap-4"><h1 className="text-2xl font-bold">Administrator access required</h1><p role="alert" className="rounded-lg border p-4 text-sm">Staged import rows are restricted to assigned administrators.</p><Link className="underline" href="/protected">← Back to protected area</Link></section>;
  }

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .select("id, source_file_name, status, rows_received, rows_with_errors, created_at, season_id")
    .eq("id", numericId)
    .eq("import_type", "players")
    .maybeSingle();

  if (batchError) {
    return <section className="flex flex-col gap-4"><Link className="text-sm underline" href="/protected/import-batches">← Back to staged batches</Link><h1 className="text-2xl font-bold">Batch review unavailable</h1><p role="alert" className="rounded-lg border border-destructive p-4 text-sm">Could not read this batch. Confirm the Phase 5.0 migration is installed in the intended local database. No data was changed.</p></section>;
  }
  if (!batch) {
    return <section className="flex flex-col gap-4"><Link className="text-sm underline" href="/protected/import-batches">← Back to staged batches</Link><h1 className="text-2xl font-bold">Batch not found</h1><p className="text-sm text-muted-foreground">The requested player-import batch does not exist or is not available for review.</p></section>;
  }

  const { data: rows, error: rowsError } = await supabase
    .from("sports_connect_import_rows")
    .select("id, source_row_number, external_player_id, first_name, last_name, birth_date_text, birth_date, source_program, source_division, registration_number, payment_status, league_age, review_flags, review_state")
    .eq("import_batch_id", numericId)
    .order("source_row_number", { ascending: true })
    .limit(5000);

  // Read-only suggestions only. This query never writes or links player identities.
  const candidatePlayers: ExistingPlayer[] = [];
  let playersError: { message: string } | null = null;
  // Page in chunks so the API's configured per-request row cap does not silently truncate matches.
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
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2"><Link className="text-sm underline underline-offset-4" href="/protected/import-batches">← Back to staged batches</Link><h1 className="text-3xl font-bold">Import batch #{batch.id}</h1><p className="text-sm text-muted-foreground">{batch.source_file_name || "Unnamed source file"} · Created {new Date(batch.created_at).toLocaleString()}</p></div>
      <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm"><strong>Read-only review.</strong> Possible matches below are suggestions only. They never link or merge players, approve rows, or commit registrations.</div>
      {playersError ? <p role="alert" className="rounded-lg border p-3 text-sm">Existing-player suggestions are unavailable for this view. Confirm administrator read access to players. Staged rows remain unchanged.</p> : <p className="text-sm text-muted-foreground">Candidate matching compares names and birth dates against up to 10,000 existing player records. Sports Connect IDs are not treated as permanent player identities. Review every suggestion manually.</p>}
      <div className="grid gap-3 sm:grid-cols-3"><Metric label="Rows received" value={batch.rows_received} /><Metric label="Rows flagged" value={batch.rows_with_errors} /><Metric label="Batch status" value={batch.status} /></div>
      {rowsError ? (
        <p role="alert" className="rounded-lg border border-destructive p-4 text-sm">
          Could not load staged rows. Confirm the staging migration is applied and the current account has administrator access.
        </p>
      ) : !rows?.length ? (
        <p className="rounded-lg border p-4 text-sm">No staged rows were found for this batch.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1500px] text-left text-sm">
            <thead className="bg-muted">
              <tr>
                {["CSV line", "External ID", "Player", "Birth date", "Age", "Program", "Division", "Payment status", "Registration #", "Review flags", "Review state", "Possible existing-player matches"].map((heading) => (
                  <th key={heading} className="p-3 font-semibold">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows as StagedRow[]).map((row) => {
                const flags = flagsOf(row.review_flags);
                const candidates = playersError ? [] : candidatesFor(row, candidateIndex);
                return (
                  <tr key={row.id} className="border-t align-top">
                    <td className="p-3 tabular-nums">{row.source_row_number}</td>
                    <td className="p-3 font-mono">{row.external_player_id || "—"}</td>
                    <td className="p-3">{row.first_name} {row.last_name}</td>
                    <td className="p-3">{row.birth_date_text || row.birth_date || "—"}</td>
                    <td className="p-3">{row.league_age ?? "Review"}</td>
                    <td className="p-3">{row.source_program || "—"}</td>
                    <td className="p-3">{row.source_division || "—"}</td>
                    <td className="p-3">{row.payment_status || "—"}</td>
                    <td className="p-3">{row.registration_number || "—"}</td>
                    <td className="p-3">
                      <div className="flex max-w-sm flex-wrap gap-1">
                        {flags.length ? flags.map((flag, index) => (
                          <span key={`${flag}-${index}`} className="rounded bg-amber-500/15 px-2 py-1 text-xs">{flag}</span>
                        )) : <span className="text-muted-foreground">No preview flags</span>}
                      </div>
                    </td>
                    <td className="p-3">{row.review_state}</td>
                    <td className="p-3">
                      {playersError ? <span className="text-muted-foreground">Unavailable</span> : candidates.length ? (
                        <ul className="flex min-w-64 flex-col gap-2">
                          {candidates.map((candidate) => <li key={candidate.player.id} className="rounded border p-2">
                            <p className="font-medium">#{candidate.player.id} · {candidate.player.first_name} {candidate.player.last_name}</p>
                            <p className="text-xs text-muted-foreground">Birth date: {candidate.player.date_of_birth || "unknown"}</p>
                            <p className="text-xs">{candidate.reason}</p>
                          </li>)}
                        </ul>
                      ) : <span className="text-muted-foreground">No suggested match</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">This page displays staged data and read-only candidate suggestions only. Candidate results are not identity decisions. The eventual commit must use explicit administrator decisions and a separate atomic workflow.</p>
    </section>
  );
}

export default async function ImportBatchDetailPage({ params }: { params: Promise<{ batchId: string }> }) {
  return <Suspense fallback={<section className="flex flex-col gap-3"><h1 className="text-2xl font-bold">Import batch review</h1><p className="text-sm text-muted-foreground">Loading staged rows…</p></section>}><ImportBatchParams params={params} /></Suspense>;
}

async function ImportBatchParams({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  return <ImportBatchDetailContent batchId={batchId} />;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></div>;
}
