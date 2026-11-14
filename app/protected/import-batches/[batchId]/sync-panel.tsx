import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { applyTickedChanges, keepAppValues } from "./sync-actions";

type Change = { field: string; label: string; current: string; incoming: string; auto: boolean; applied?: boolean; blocked?: string | null; note?: string | null };
type SyncRow = {
  id: number; source_row_number: number; external_player_id: string | null; first_name: string; last_name: string;
  review_state: "up_to_date" | "has_changes" | "changes_reviewed"; sync_changes: Change[]; existing_player_season_id: number | null;
};
type Missing = { player_season_id: number; player_name: string; external_player_id: string; league_age: number | null; evaluation_number: number | null };

const field = "mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground";
const shown = (value: string) => value || "—";
const summary = (changes: Change[]) => changes.map((c) => `${c.label} ${shown(c.current)} → ${shown(c.incoming)}`).join("; ");

function PlayerLink({ row }: { row: SyncRow }) {
  // The name the app has now (a waiting or kept name change still shows the old one).
  const nameChange = row.sync_changes.find((c) => c.field === "name");
  const name = nameChange && !nameChange.applied ? nameChange.current : `${row.first_name} ${row.last_name}`;
  return row.existing_player_season_id
    ? <Link href={`/protected/players/${row.existing_player_season_id}`} className="font-medium text-foreground underline-offset-2 hover:underline">{name}</Link>
    : <span className="font-medium">{name}</span>;
}

// Rows whose Player Id is already registered this season: what was updated, what waits for a tick, who is missing.
export async function SyncPanel({ batchId, message, error }: { batchId: number; message?: string; error?: string }) {
  const supabase = await createClient();
  const [{ data: rowData }, { data: missingData }] = await Promise.all([
    supabase.from("sports_connect_import_rows")
      .select("id, source_row_number, external_player_id, first_name, last_name, review_state, sync_changes, existing_player_season_id")
      .eq("import_batch_id", batchId).in("review_state", ["up_to_date", "has_changes", "changes_reviewed"])
      .order("source_row_number").limit(5000),
    supabase.rpc("import_batch_missing_registrations", { p_batch_id: batchId }),
  ]);
  const rows = (rowData ?? []) as SyncRow[];
  const missing = (missingData ?? []) as Missing[];
  if (rows.length === 0 && !message && !error) return null;

  const waiting = rows.filter((r) => r.review_state === "has_changes");
  const reviewed = rows.filter((r) => r.review_state === "changes_reviewed");
  const upToDate = rows.filter((r) => r.review_state === "up_to_date");
  const autoUpdated = rows.filter((r) => r.sync_changes.some((c) => c.auto));

  return (
    <section id="registered" className="scroll-mt-20 space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Players already registered</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Rows whose Player Id is already registered this season are compared with that registration. Payment status, Registration Number and a
          missing bib are updated automatically. Everything else waits for your tick. Nothing is ever removed.
        </p>
      </div>
      {message && <div role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-sm text-emerald-700 dark:text-emerald-300">{message}</div>}
      {error && <div role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-sm text-rose-700 dark:text-rose-300">{error}</div>}

      <ul className="flex flex-wrap gap-2 text-sm">
        <li className="rounded-full border border-border px-3 py-1"><b>{upToDate.length}</b> up to date</li>
        <li className={`rounded-full border px-3 py-1 ${waiting.length ? "border-amber-500/50 bg-amber-500/10" : "border-border"}`}><b>{waiting.length}</b> with changes waiting</li>
        <li className="rounded-full border border-border px-3 py-1"><b>{reviewed.length}</b> changes reviewed</li>
        <li className="rounded-full border border-border px-3 py-1"><b>{autoUpdated.length}</b> updated automatically</li>
      </ul>

      {waiting.length > 0 && (
        <form action={applyTickedChanges} className="space-y-3">
          <input type="hidden" name="batchId" value={batchId} />
          {waiting.map((row) => (
            <div key={row.id} className="rounded-md border border-amber-500/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  <PlayerLink row={row} />{" "}
                  <span className="text-xs text-muted-foreground">Line {row.source_row_number} · Player Id {row.external_player_id}</span>
                </p>
                <Button type="submit" formAction={keepAppValues.bind(null, row.id)} variant="outline" size="sm">Keep app values</Button>
              </div>
              <table className="mt-2 w-full table-fixed text-left text-sm">
                <colgroup><col className="w-16" /><col className="w-1/4" /><col /><col /></colgroup>
                <thead className="text-xs text-muted-foreground">
                  <tr><th className="py-1 pr-3 font-normal">Apply</th><th className="py-1 pr-3 font-normal">What</th><th className="py-1 pr-3 font-normal">In the app</th><th className="py-1 font-normal">In this file</th></tr>
                </thead>
                <tbody>
                  {row.sync_changes.filter((c) => !c.auto).map((c) => (
                    <tr key={c.field} className="align-top">
                      <td className="py-1 pr-3">
                        {c.blocked ? <span className="text-xs text-muted-foreground">—</span>
                          : <input type="checkbox" name="change" value={`${row.id}:${c.field}`} aria-label={`Apply ${c.label} for ${row.first_name} ${row.last_name}`} className="h-5 w-5" />}
                      </td>
                      <td className="py-1 pr-3">{c.label}</td>
                      <td className="py-1 pr-3 font-mono">{shown(c.current)}</td>
                      <td className="py-1 font-mono">
                        {shown(c.incoming)}
                        {c.blocked && <span className="block font-sans text-xs text-amber-800 dark:text-amber-300">{c.blocked}</span>}
                        {c.note && <span className="block font-sans text-xs text-muted-foreground">{c.note}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-64 flex-1 text-xs text-muted-foreground">Reason (saved in the audit log)
              <input name="reason" defaultValue="Updated from the latest Sports Connect export" className={field} />
            </label>
            <Button type="submit" className="min-h-10">Apply ticked changes</Button>
          </div>
          <p className="text-xs text-muted-foreground">A player with at least one tick is marked reviewed; their unticked changes keep the app&apos;s values. Players with no ticks keep waiting.</p>
        </form>
      )}

      {autoUpdated.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-foreground">Updated automatically ({autoUpdated.length})</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {autoUpdated.map((row) => (
              <li key={row.id}><PlayerLink row={row} />: <span className="text-muted-foreground">{summary(row.sync_changes.filter((c) => c.auto))}</span></li>
            ))}
          </ul>
        </details>
      )}

      {reviewed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-foreground">Changes reviewed ({reviewed.length})</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {reviewed.map((row) => {
              const manual = row.sync_changes.filter((c) => !c.auto);
              const applied = manual.filter((c) => c.applied);
              const kept = manual.filter((c) => !c.applied);
              return (
                <li key={row.id}>
                  <PlayerLink row={row} />:{" "}
                  {applied.length > 0 && <span>applied {summary(applied)}</span>}
                  {applied.length > 0 && kept.length > 0 && "; "}
                  {kept.length > 0 && <span className="text-muted-foreground">kept the app&apos;s {kept.map((c) => c.label.toLowerCase()).join(", ")}</span>}
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {missing.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-foreground">Registered but not in this file ({missing.length})</summary>
          <p className="mt-2 text-xs text-muted-foreground">
            Only meaningful when this file is a full export of the season. Nothing is removed. If a player withdrew, handle it on their Players page.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {missing.map((m) => (
              <li key={m.player_season_id}>
                <Link href={`/protected/players/${m.player_season_id}`} className="underline-offset-2 hover:underline">{m.player_name}</Link>{" "}
                <span className="text-xs text-muted-foreground">Player Id {m.external_player_id} · age {m.league_age ?? "—"} · bib {m.evaluation_number ?? "—"}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
