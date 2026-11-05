import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReviewDecisionForm } from "./review-decision-form";
import { Suspense } from "react";

type Row = {
  id: number; source_row_number: number; external_player_id: string | null;
  first_name: string; last_name: string; birth_date_text: string | null; birth_date: string | null;
  source_program: string | null; source_division: string | null; registration_number: string | null;
  payment_status: string | null; league_age: number | null; review_flags: unknown; review_state: string;
  matched_player_id: number | null; committed_player_season_id: number | null;
};
type Player = { id: number; first_name: string; last_name: string; date_of_birth: string | null };

function flags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 30) : [];
}

async function ImportBatchReviewContent({ params }: { params: Promise<{ batchId: string }> }) {
  await connection();
  const { batchId } = await params;
  const id = Number(batchId);
  if (!Number.isSafeInteger(id) || id < 1) return <main className="p-6"><h1 className="text-2xl font-bold">Invalid batch ID</h1></main>;
  const supabase = await createClient();
  const { data: claims, error: authError } = await supabase.auth.getClaims();
  if (authError || !claims?.claims) redirect("/auth/login");
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError || isAdmin !== true) return <main className="mx-auto max-w-4xl p-6"><h1 className="text-2xl font-bold">Administrator access required</h1><p className="mt-2">Only administrators can record import review decisions.</p></main>;

  const { data: batch, error: batchError } = await supabase.from("import_batches")
    .select("id, source_file_name, status, season_id").eq("id", id).eq("import_type", "players").maybeSingle();
  if (batchError || !batch) return <main className="mx-auto max-w-4xl p-6"><h1 className="text-2xl font-bold">Batch unavailable</h1><p role="alert">Could not load this player import batch. No data was changed.</p><Link className="underline" href="/protected/import-batches">Back to batches</Link></main>;

  const { data: rows, error: rowsError } = await supabase.from("sports_connect_import_rows")
    .select("id, source_row_number, external_player_id, first_name, last_name, birth_date_text, birth_date, source_program, source_division, registration_number, payment_status, league_age, review_flags, review_state, matched_player_id, committed_player_season_id")
    .eq("import_batch_id", id).order("source_row_number", { ascending: true }).limit(5000);
  const { data: players, error: playersError } = await supabase.from("players")
    .select("id, first_name, last_name, date_of_birth").order("id", { ascending: true }).limit(1000);
  const candidates = (players ?? []) as Player[];
    const committedRegistrationIds = (rows ?? [])
    .map((row) => (row as Row).committed_player_season_id)
    .filter((value): value is number => value !== null);

  const { data: committedRegistrations } = committedRegistrationIds.length
    ? await supabase
        .from("player_seasons")
        .select("id, player_id")
        .in("id", committedRegistrationIds)
    : { data: [] };

  const committedPlayerIds = [
    ...new Set((committedRegistrations ?? []).map((registration) => registration.player_id)),
  ];

  const { data: committedPlayers } = committedPlayerIds.length
    ? await supabase
        .from("players")
        .select("id, first_name, last_name, date_of_birth")
        .in("id", committedPlayerIds)
    : { data: [] };

  const committedPlayerByRegistrationId = new Map(
    (committedRegistrations ?? []).map((registration) => [
      registration.id,
      (committedPlayers ?? []).find((player) => player.id === registration.player_id),
    ]),
  );

  return <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
    <div className="flex flex-col gap-2"><Link className="text-sm underline" href={`/protected/import-batches/${id}`}>← Back to batch detail</Link><h1 className="text-3xl font-bold">Administrator row review · Batch #{id}</h1><p className="text-muted-foreground">{batch.source_file_name || "Unnamed file"}</p></div>
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm"><strong>Review only.</strong> Saving a decision updates the staged row and audit log. It does not create or update players or registrations, merge identities, or commit the batch.</div>
    {playersError && <p role="alert" className="rounded-lg border p-3 text-sm">Existing-player candidates could not be loaded. Approved-match decisions require a player selection; do not infer identity from a Sports Connect ID.</p>}
    {rowsError ? <p role="alert" className="rounded-lg border p-4">Could not load staged rows. Confirm the local staging and review-decision migrations are applied.</p> : !rows?.length ? <p className="rounded-lg border p-4">No staged rows in this batch.</p> : rows.map((row) => {
      const rowData = row as Row;
      const name = `${rowData.first_name} ${rowData.last_name}`.trim().toLocaleLowerCase("en-US");
      const date = rowData.birth_date;
      const matches = candidates.filter((p) => (`${p.first_name} ${p.last_name}`).trim().toLocaleLowerCase("en-US") === name || (date && p.date_of_birth === date)).slice(0, 10);
            const committedRegistrationId = rowData.committed_player_season_id;
      const committedPlayer =
        committedRegistrationId == null
          ? undefined
          : committedPlayerByRegistrationId.get(committedRegistrationId);
      const committedPlayerLabel = committedPlayer
        ? `#${committedPlayer.id} · ${committedPlayer.first_name} ${committedPlayer.last_name}`
        : null;
      return <article key={rowData.id} className="flex flex-col gap-4 rounded-xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-lg font-semibold">Row {rowData.source_row_number}: {rowData.first_name} {rowData.last_name}</h2><p className="text-sm text-muted-foreground">Staged row #{rowData.id} · State: {rowData.review_state}</p></div><span className="rounded-full border px-3 py-1 text-xs">{rowData.review_state}</span></div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="font-medium">Sports Connect ID</dt><dd>{rowData.external_player_id || "—"}</dd></div><div><dt className="font-medium">Birth date</dt><dd>{rowData.birth_date_text || rowData.birth_date || "—"}</dd></div><div><dt className="font-medium">Program / division</dt><dd>{rowData.source_program || "—"} / {rowData.source_division || "—"}</dd></div><div><dt className="font-medium">Registration / payment</dt><dd>{rowData.registration_number || "—"} / {rowData.payment_status || "—"}</dd></div><div><dt className="font-medium">League age</dt><dd>{rowData.league_age ?? "—"}</dd></div></dl>
        {flags(rowData.review_flags).length > 0 && <div className="rounded-md bg-muted p-3 text-sm"><strong>Flags:</strong> {flags(rowData.review_flags).join(" · ")}</div>}
        <ReviewDecisionForm rowId={rowData.id} batchId={id} currentDecision={rowData.review_state} currentMatchedPlayerId={rowData.matched_player_id} committedPlayerLabel={committedPlayerLabel} committedPlayerSeasonId={rowData.committed_player_season_id} candidates={matches.map((p) => ({ id: p.id, label: `#${p.id} · ${p.first_name} ${p.last_name}${p.date_of_birth ? ` · ${p.date_of_birth}` : ""}` }))} disabled={rowData.review_state === "committed" || Boolean(rowsError)} />
      </article>;
    })}
    <p className="text-xs text-muted-foreground">Candidate list is limited to the first 1,000 visible players and up to 10 suggestions per row. A suggestion is not an identity match; verify manually.</p>
  </main>;
}

export default function ImportBatchReviewPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-5xl p-6">
          <p className="text-sm text-muted-foreground">
            Loading administrator row review…
          </p>
        </main>
      }
    >
      <ImportBatchReviewContent params={params} />
    </Suspense>
  );
}
