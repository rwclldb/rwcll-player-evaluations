import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { usDate } from "@/lib/players";
import { dismissPriorYear, importPriorYear, recheckPriorYear } from "../actions";

type Params = Promise<{ batchId: string }>;
type SearchParams = Promise<{ message?: string; error?: string }>;
type Row = {
  id: number; source_row_number: number; source_player_id: string | null; first_name: string | null; last_name: string | null;
  birth_date: string | null; source_season_label: string; source_division_name: string; source_team_label: string | null;
  source_coach_name: string | null; ratings: Record<string, number>; candidate_player_ids: number[]; resolved_player_id: number | null;
  review_state: string; match_status: string; match_message: string | null; review_reason: string | null;
};
type Candidate = { id: number; first_name: string; last_name: string; date_of_birth: string | null; player_seasons: { season_id: number; league_age: number | null; evaluation_number: number | null; external_player_id: string | null }[] };

const SHORT: Record<string, string> = {
  hitting: "Hit", throwing: "Thr", grounders: "Grd", fly_balls: "Fly", running_awareness: "Run",
  pitching_mechanics: "P-mech", pitching_accuracy_control: "P-acc", pitching_arm_strength: "P-arm",
  catching_receiving: "C-rec", catching_blocking: "C-blk", catching_throwing: "C-thr",
};

async function BatchContent({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { batchId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/protected");

  const id = Number(batchId);
  const { data: batch } = await supabase.from("import_batches").select("id, source_file_name, created_at, season_id, seasons(name)")
    .eq("id", id).eq("import_type", "historical_evaluations").maybeSingle();
  if (!batch) notFound();
  const { data } = await supabase.from("historical_evaluation_import_rows")
    .select("id, source_row_number, source_player_id, first_name, last_name, birth_date, source_season_label, source_division_name, source_team_label, source_coach_name, ratings, candidate_player_ids, resolved_player_id, review_state, match_status, match_message, review_reason")
    .eq("import_batch_id", id).order("source_row_number");
  const rows = (data ?? []) as Row[];
  const candidateIds = [...new Set(rows.flatMap((r) => [...r.candidate_player_ids, ...(r.resolved_player_id ? [r.resolved_player_id] : [])]))];
  const { data: candData } = candidateIds.length
    ? await supabase.from("players").select("id, first_name, last_name, date_of_birth, player_seasons(season_id, league_age, evaluation_number, external_player_id)").in("id", candidateIds)
    : { data: [] };
  const players = new Map(((candData ?? []) as Candidate[]).map((p) => [p.id, p]));
  const describe = (playerId: number) => {
    const p = players.get(playerId);
    if (!p) return `Player ${playerId}`;
    const reg = p.player_seasons.find((r) => r.season_id === batch.season_id);
    return [`${p.first_name} ${p.last_name}`, p.date_of_birth ? `born ${usDate(p.date_of_birth)}` : "no birthdate",
      reg?.external_player_id ? `Id ${reg.external_player_id}` : "", reg?.league_age ? `age ${reg.league_age}` : "", reg?.evaluation_number ? `bib ${reg.evaluation_number}` : ""]
      .filter(Boolean).join(" · ");
  };
  const pending = rows.filter((r) => r.review_state === "pending_review");
  const matched = pending.filter((r) => r.match_status === "matched");
  const review = pending.filter((r) => r.match_status === "review");
  const held = pending.filter((r) => r.match_status === "held");
  const invalid = pending.filter((r) => r.match_status === "invalid");
  const imported = rows.filter((r) => r.review_state === "imported");
  const dismissed = rows.filter((r) => r.review_state === "rejected");
  const seasonName = (batch as unknown as { seasons: { name: string } | null }).seasons?.name;

  const fileLine = (r: Row) => (
    <span className="text-xs text-muted-foreground">
      File: {r.first_name} {r.last_name}{r.birth_date ? `, ${usDate(r.birth_date)}` : ""}{r.source_player_id ? `, Id ${r.source_player_id}` : ""}
      {" · "}{r.source_season_label} {r.source_division_name}{r.source_team_label ? ` (${r.source_team_label})` : ""}{r.source_coach_name ? `, coach ${r.source_coach_name}` : ""}
    </span>
  );
  const ratingLine = (r: Row) => (
    <span className="font-mono text-xs text-foreground">
      {Object.entries(r.ratings).map(([k, v]) => `${SHORT[k] ?? k} ${v}`).join("  ") || "no ratings"}
    </span>
  );
  const box = "divide-y divide-border rounded-lg border border-border bg-card text-sm";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <Button asChild variant="ghost" size="sm" className="h-8 w-fit px-2 text-xs text-muted-foreground hover:text-foreground">
          <Link href="/protected/prior-year"><ArrowLeft className="mr-1 h-4 w-4" /> Prior-year uploads</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{batch.source_file_name ?? `Upload ${batch.id}`}</h1>
        <p className="text-sm text-muted-foreground">
          Matched to {seasonName} players · uploaded {new Date(batch.created_at).toLocaleString("en-US")} · {rows.length} rows:
          {" "}{imported.length} imported, {matched.length} ready, {review.length} to review, {held.length} held, {invalid.length} rejected, {dismissed.length} dismissed
        </p>
      </div>

      {sp.message && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{sp.message}</div>}
      {sp.error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{sp.error}</div>}

      {(matched.length > 0 || review.length > 0) && (
        <form action={importPriorYear} className="space-y-6">
          <input type="hidden" name="batchId" value={batch.id} />
          {matched.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Ready: Player Id, name and birthdate agree ({matched.length})</h2>
              <ul className={box}>
                {matched.map((r) => (
                  <li key={r.id} className="px-3 py-2">
                    <label className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <input type="checkbox" name="import" value={r.id} defaultChecked className="h-5 w-5" />
                      <input type="hidden" name={`player_${r.id}`} value={r.candidate_player_ids[0]} />
                      <span className="font-medium text-foreground">{describe(r.candidate_player_ids[0])}</span>
                      {ratingLine(r)}
                      <span className="w-full">{fileLine(r)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {review.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-400">Check these ({review.length})</h2>
              <p className="text-xs text-muted-foreground">Only part of the details agree. Pick the player if you&apos;re sure it&apos;s the same child; otherwise leave it.</p>
              <ul className={box}>
                {review.map((r) => (
                  <li key={r.id} className="space-y-1 px-3 py-2">
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Line {r.source_row_number}: {r.match_message}</p>
                    {fileLine(r)}
                    <div>{ratingLine(r)}</div>
                    <fieldset className="flex flex-col gap-1 pt-1">
                      {r.candidate_player_ids.map((pid) => (
                        <label key={pid} className="flex items-center gap-2"><input type="radio" name={`pick_${r.id}`} value={pid} className="h-4 w-4" /> Same child: {describe(pid)}</label>
                      ))}
                      <label className="flex items-center gap-2 text-muted-foreground"><input type="radio" name={`pick_${r.id}`} value="" defaultChecked className="h-4 w-4" /> Leave for now</label>
                    </fieldset>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="flex justify-end"><Button type="submit" className="min-h-11">Import selected ratings</Button></div>
        </form>
      )}

      {held.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-400">Held: no registered player matches yet ({held.length})</h2>
          <p className="text-xs text-muted-foreground">Check again after importing more registrations. Dismiss players who aren&apos;t returning.</p>
          <form action={recheckPriorYear} className="flex justify-end">
            <input type="hidden" name="batchId" value={batch.id} />
            <Button type="submit" variant="outline" className="min-h-11"><RefreshCw className="mr-1 h-4 w-4" /> Check held rows again</Button>
          </form>
          <form action={dismissPriorYear} className="space-y-2">
            <input type="hidden" name="batchId" value={batch.id} />
            <ul className={box}>
              {held.map((r) => (
                <li key={r.id} className="px-3 py-2">
                  <label className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <input type="checkbox" name="dismiss" value={r.id} className="h-5 w-5" />
                    <span className="text-xs text-muted-foreground">Line {r.source_row_number}</span>
                    {fileLine(r)}
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end justify-end gap-2">
              <label className="text-xs text-muted-foreground">Reason
                <input name="reason" defaultValue="Not returning this season" className="mt-1 block h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground" />
              </label>
              <Button type="submit" variant="outline" className="h-10">Dismiss ticked rows</Button>
            </div>
          </form>
        </section>
      )}

      {invalid.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-rose-700 dark:text-rose-400">Rejected ({invalid.length})</h2>
          <ul className={box}>
            {invalid.map((r) => (
              <li key={r.id} className="space-y-1 px-3 py-2">
                <p className="text-xs text-rose-700 dark:text-rose-300">Line {r.source_row_number}: {r.match_message}</p>
                {fileLine(r)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(imported.length > 0 || dismissed.length > 0) && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Done ({imported.length + dismissed.length})</h2>
          <ul className={box}>
            {[...imported, ...dismissed].sort((a, b) => a.source_row_number - b.source_row_number).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 px-3 py-2 text-xs">
                <span className="text-muted-foreground">Line {r.source_row_number}</span>
                {r.review_state === "imported"
                  ? <span className="text-foreground">Imported for {describe(r.resolved_player_id!)}</span>
                  : <span className="text-muted-foreground">Dismissed: {r.first_name} {r.last_name} ({r.review_reason})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function PriorYearBatchPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 w-full animate-pulse rounded-lg border border-border bg-card" />}>
      <BatchContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
