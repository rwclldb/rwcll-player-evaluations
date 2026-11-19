"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CsvTemplatePanel } from "@/components/csv-template";
import { TEAMS_TEMPLATE } from "@/lib/csv-templates";
import { readCsv } from "@/lib/csv-upload";
import { parseTeamsCsv, type TeamRow, type TeamsParse } from "@/lib/teams-csv";
import { importTeams, type TeamImportResult } from "./actions";

const STATUS: Record<TeamImportResult["status"], { label: string; cls: string }> = {
  new: { label: "New team", cls: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
  changed: { label: "Staff change", cls: "bg-sky-500/15 text-sky-800 dark:text-sky-300" },
  same: { label: "Up to date", cls: "bg-muted text-muted-foreground" },
  error: { label: "Can't add", cls: "bg-rose-500/15 text-rose-800 dark:text-rose-300" },
};

// Teams CSV: read in the browser, previewed by the database (same steps, rolled back), then applied.
export function TeamsUpload({ seasonId }: { seasonId: number }) {
  const router = useRouter();
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [parsed, setParsed] = useState<TeamsParse | null>(null);
  const [results, setResults] = useState<TeamImportResult[] | null>(null);
  const [applied, setApplied] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    setMessage(""); setResults(null); setApplied(false); setParsed(null); setRows([]);
    if (!file) return;
    const p = parseTeamsCsv(readCsv(await file.text()));
    if ("error" in p) { setMessage(p.error); return; }
    setParsed(p);
    setRows(p.rows);
    if (p.rows.length === 0) { setMessage("No teams found in the file."); return; }
    setBusy(true);
    const r = await importTeams({ seasonId, rows: p.rows, apply: false });
    setBusy(false);
    if (!r.ok) setMessage(r.message); else setResults(r.results);
  }

  async function apply() {
    setBusy(true);
    const r = await importTeams({ seasonId, rows, apply: true });
    setBusy(false);
    if (!r.ok) { setMessage(r.message); return; }
    setResults(r.results);
    setApplied(true);
    router.refresh();
  }

  const toApply = results?.filter((r) => r.status === "new" || r.status === "changed").length ?? 0;
  const problems = [...(parsed?.problems ?? []).map((p) => ({ ...p, status: "error" as const })), ...(results ?? [])].sort((a, b) => a.line - b.line);

  return (
    <details className="rounded-lg border border-border bg-card" open={results !== null || message !== ""}>
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-semibold text-foreground">
        <Upload className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> Upload teams from a spreadsheet
      </summary>
      <div className="space-y-3 border-t border-border p-4">
        <CsvTemplatePanel template={TEAMS_TEMPLATE} />
        <input type="file" accept=".csv,text/csv" aria-label="Teams CSV file" disabled={busy}
          onChange={(e) => onFile(e.target.files?.[0])} className="block text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-white" />
        {message && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{message}</p>}
        {busy && <p className="text-sm text-muted-foreground">Checking…</p>}
        {parsed && parsed.skipped.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Skipped {parsed.skipped.length} {parsed.skipped.length === 1 ? "row" : "rows"}: {[...new Set(parsed.skipped.map((s) => s.reason))].join("; ")}.
          </p>
        )}
        {results && (
          <>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr><th className="px-3 py-2">Line</th><th className="px-3 py-2">Division</th><th className="px-3 py-2">Team</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Details</th></tr>
                </thead>
                <tbody>
                  {problems.map((r, i) => (
                    <tr key={`${r.line}-${i}`} className="border-t border-border">
                      <td className="px-3 py-2 text-muted-foreground">{r.line}</td>
                      <td className="px-3 py-2">{r.division}</td>
                      <td className="px-3 py-2 font-medium">{r.team}</td>
                      <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
                      <td className="px-3 py-2 text-muted-foreground">{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {applied ? (
              <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Done: {toApply} {toApply === 1 ? "team" : "teams"} added or updated.</p>
            ) : (
              <div className="flex items-center gap-3">
                <Button type="button" onClick={apply} disabled={busy || toApply === 0}>Apply {toApply} {toApply === 1 ? "team" : "teams"}</Button>
                <span className="text-xs text-muted-foreground">Rows marked &quot;Can&apos;t add&quot; are left out. Fix them in the file and upload again.</span>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}
