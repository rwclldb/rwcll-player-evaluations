"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { stageSportsConnectImport } from "./actions";
import { ACTIVE_DIVISIONS, makePreview, safeCsvCell, type PreviewRow } from "@/lib/sports-connect-preview";

type AvailableSeason = { id: number; name: string; startDate: string | null; endDate: string | null };

export function RegistrationImportPreview({ seasons }: { seasons: AvailableSeason[] }) {
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [missingHeaders, setMissingHeaders] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [seasonId, setSeasonId] = useState("");
  const [staging, setStaging] = useState(false);
  const [stageMessage, setStageMessage] = useState("");
  const [stagedBatchId, setStagedBatchId] = useState<number | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setRows([]); setError(""); setMissingHeaders([]); setFileName(""); setShowAll(false); setStageMessage(""); setStagedBatchId(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { setError("Choose a CSV file."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("For this preview, choose a CSV smaller than 10 MB."); return; }
    try {
      const result = makePreview(await file.text());
      setFileName(file.name);
      setMissingHeaders(result.missingHeaders);
      setRows(result.rows);
      if (result.missingHeaders.length === 0 && result.rows.length === 0) setError("No registration rows were found.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read this CSV.");
    }
  }

  const summary = useMemo(() => {
    const payment = new Map<string, number>();
    const divisions = new Map<string, number>();
    const ages = new Map<number, number>();
    let issues = 0; let duplicateIds = 0; let duplicateRegs = 0; let reviewDivisions = 0;
    for (const row of rows) {
      const status = row.paymentStatus || "(blank)";
      payment.set(status, (payment.get(status) ?? 0) + 1);
      const division = row.division || "(blank)";
      divisions.set(division, (divisions.get(division) ?? 0) + 1);
      if (row.leagueAge !== null) ages.set(row.leagueAge, (ages.get(row.leagueAge) ?? 0) + 1);
      if (row.issues.length) issues += 1;
      if (row.issues.includes("Duplicate Player ID in file")) duplicateIds += 1;
      if (row.issues.includes("Duplicate Registration Number in file")) duplicateRegs += 1;
      if (!ACTIVE_DIVISIONS.has(row.division.toUpperCase())) reviewDivisions += 1;
    }
    return { payment: [...payment.entries()].sort(), divisions: [...divisions.entries()].sort(), ages: [...ages.entries()].sort((a,b) => a[0]-b[0]), issues, duplicateIds, duplicateRegs, reviewDivisions };
  }, [rows]);

  async function saveStagingBatch() {
    setStageMessage("");
    setStagedBatchId(null);
    if (!seasonId) { setStageMessage("Choose an open season first."); return; }
    if (!fileName || missingHeaders.length > 0 || rows.length === 0) {
      setStageMessage("Choose a valid CSV and resolve missing required headers before staging."); return;
    }
    if (rows.length > 5000) { setStageMessage("This staging workflow is limited to 5,000 rows per batch."); return; }
    setStaging(true);
    try {
      const result = await stageSportsConnectImport({ seasonId: Number(seasonId), fileName, rows });
      if (!result.ok) { setStageMessage(result.message); return; }
      setStagedBatchId(result.batchId);
      setStageMessage(`Saved staging batch #${result.batchId} with ${result.rowCount} rows. No player or registration records were changed.`);
    } catch (caught) {
      setStageMessage(caught instanceof Error ? caught.message : "Staging failed. No success was reported.");
    } finally {
      setStaging(false);
    }
  }

  function downloadIssueReport() {
    const flagged = rows.filter((row) => row.issues.length > 0);
    const csv = [
      ["CSV line", "Player Id", "Player First Name", "Player Last Name", "Division Name", "Birth Date", "League Age (2027 chart)", "Issues"].map(safeCsvCell).join(","),
      ...flagged.map((row) => [String(row.line), row.playerId, row.firstName, row.lastName, row.division, row.birthDate, row.leagueAge === null ? "" : String(row.leagueAge), row.issues.join("; ")].map(safeCsvCell).join(",")),
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "rwcll-import-preview-issues.csv"; link.click(); URL.revokeObjectURL(url);
  }

  const visibleRows = showAll ? rows : rows.slice(0, 25);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border p-4 flex flex-col gap-3">
        <label htmlFor="sports-connect-csv" className="font-semibold">Choose Sports Connect CSV</label>
        <input id="sports-connect-csv" type="file" accept=".csv,text/csv" onChange={handleFile} className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-primary-foreground" />
        <p className="text-xs text-muted-foreground">Expected source headers are checked. Account names, emails, order numbers, and order dates are not staged or shown in the preview/report.</p>
        <label htmlFor="import-season" className="mt-2 font-semibold">Existing open season</label>
        <select id="import-season" value={seasonId} onChange={(event) => { setSeasonId(event.target.value); setStageMessage(""); setStagedBatchId(null); }} className="block w-full rounded-md border bg-background px-3 py-2 text-sm">
          <option value="">Choose a season…</option>
          {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.startDate ? ` · ${season.startDate}` : ""}{season.endDate ? ` – ${season.endDate}` : ""}</option>)}
        </select>
        {seasons.length === 0 && <p className="text-sm text-muted-foreground">No open seasons were found. Create or reopen a season through the approved admin workflow before staging.</p>}
        {fileName && <p className="text-sm">Selected file: <strong>{fileName}</strong></p>}
        {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
        {missingHeaders.length > 0 && <div role="alert" className="rounded-md border border-destructive p-3 text-sm"><strong>Missing required columns:</strong> {missingHeaders.join(", ")}</div>}
        {stageMessage && <p role={stagedBatchId ? "status" : "alert"} className="rounded-md border p-3 text-sm">{stageMessage}</p>}
      </div>

      {rows.length > 0 && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Rows previewed" value={rows.length} />
          <Metric label="Rows needing review" value={summary.issues} />
          <Metric label="Rows with duplicate IDs" value={summary.duplicateIds} />
          <Metric label="Rows outside active divisions" value={summary.reviewDivisions} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <SummaryList title="Payment status" entries={summary.payment} />
          <SummaryList title="Source division" entries={summary.divisions} />
          <SummaryList title="2027 league age" entries={summary.ages.map(([age,count]) => [String(age),count] as [string,number])} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <div className="flex flex-col gap-1"><h2 className="text-lg font-bold">Save staging batch</h2><p className="text-sm text-muted-foreground">This saves the minimal rows for administrator review only. It does not write player or registration records. Review flags are retained; unresolved conflicts are not approved by this action.</p></div>
          <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" onClick={saveStagingBatch} disabled={staging || !seasonId || rows.length === 0 || missingHeaders.length > 0 || Boolean(stagedBatchId)}>{staging ? "Saving staging batch…" : stagedBatchId ? `Staged as #${stagedBatchId}` : "Save batch for review"}</button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Row preview {rows.length > 25 && !showAll ? `(first 25 of ${rows.length})` : `(${rows.length})`}</h2>
          <div className="flex flex-wrap gap-2">
            {rows.length > 25 && <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => setShowAll((current) => !current)}>{showAll ? "Show first 25" : "Show all rows"}</button>}
            <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={downloadIssueReport} disabled={summary.issues === 0}>Download issue report</button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-muted"><tr>{["Line", "Player ID", "Player", "Birth date", "Age", "Division", "Payment", "Registration #", "Review flags"].map((heading) => <th key={heading} className="p-3 font-semibold">{heading}</th>)}</tr></thead>
            <tbody>
              {visibleRows.map((row) => <tr key={`${row.line}-${row.playerId}`} className="border-t align-top">
                <td className="p-3">{row.line}</td><td className="p-3 font-mono">{row.playerId || "—"}</td>
                <td className="p-3">{row.firstName} {row.lastName}</td><td className="p-3">{row.birthDate || "—"}</td>
                <td className="p-3">{row.leagueAge ?? "Review"}</td><td className="p-3">{row.division || "—"}</td>
                <td className="p-3">{row.paymentStatus || "—"}</td><td className="p-3">{row.registrationNumber || "—"}</td>
                <td className="p-3"><div className="flex max-w-sm flex-wrap gap-1">{row.issues.length ? row.issues.map((issue) => <span key={issue} className="rounded bg-amber-500/15 px-2 py-1 text-xs">{issue}</span>) : <span className="text-muted-foreground">No preview flags</span>}</div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">A staged batch is not an import. “No preview flags” does not mean a row is approved. Existing-player matching, database conflict checks, administrator decisions, and transaction-safe player/registration commit are a later stage.</p>
      </>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></div>;
}

function SummaryList({ title, entries }: { title: string; entries: [string, number][] }) {
  return <div className="rounded-lg border p-4"><h3 className="mb-3 font-semibold">{title}</h3>{entries.length ? <ul className="flex flex-col gap-2">{entries.map(([label, count]) => <li key={label} className="flex justify-between gap-3 text-sm"><span>{label}</span><span className="font-mono tabular-nums">{count}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">No data</p>}</div>;
}
