"use client";

import { useMemo, useState, useRef, type ChangeEvent, type DragEvent } from "react";
import { stageSportsConnectImport } from "./actions";
import {
  ACTIVE_DIVISIONS,
  makePreview,
  safeCsvCell,
  type PreviewRow,
} from "@/lib/sports-connect-preview";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  FileSpreadsheet, 
  UploadCloud, 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  FileCheck,
  Loader2,
  ListFilter
} from "lucide-react";

type AvailableSeason = {
  id: number;
  name: string;
  startDate: string | null;
  endDate: string | null;
};

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
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setRows([]);
    setError("");
    setMissingHeaders([]);
    setFileName("");
    setShowAll(false);
    setStageMessage("");
    setStagedBatchId(null);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Choose a CSV file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("For this preview, choose a CSV smaller than 10 MB.");
      return;
    }
    try {
      const result = makePreview(await file.text());
      setFileName(file.name);
      setMissingHeaders(result.missingHeaders);
      setRows(result.rows);
      if (result.missingHeaders.length === 0 && result.rows.length === 0) {
        setError("No registration rows were found.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read this CSV.");
    }
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await processFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) await processFile(file);
  };

  const summary = useMemo(() => {
    const payment = new Map<string, number>();
    const divisions = new Map<string, number>();
    const ages = new Map<number, number>();
    let issues = 0;
    let duplicateIds = 0;
    let duplicateRegs = 0;
    let reviewDivisions = 0;

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

    return {
      payment: [...payment.entries()].sort(),
      divisions: [...divisions.entries()].sort(),
      ages: [...ages.entries()].sort((a, b) => a[0] - b[0]),
      issues,
      duplicateIds,
      duplicateRegs,
      reviewDivisions,
    };
  }, [rows]);

  async function saveStagingBatch() {
    setStageMessage("");
    setStagedBatchId(null);
    if (!seasonId) {
      setStageMessage("Choose an open season first.");
      return;
    }
    if (!fileName || missingHeaders.length > 0 || rows.length === 0) {
      setStageMessage("Choose a valid CSV and resolve missing required headers before staging.");
      return;
    }
    if (rows.length > 5000) {
      setStageMessage("This staging workflow is limited to 5,000 rows per batch.");
      return;
    }
    setStaging(true);
    try {
      const result = await stageSportsConnectImport({ seasonId: Number(seasonId), fileName, rows });
      if (!result.ok) {
        setStageMessage(result.message);
        return;
      }
      setStagedBatchId(result.batchId);
      setStageMessage(
        `Saved staging batch #${result.batchId} with ${result.rowCount} rows. New players wait for your review. Players already registered are compared on the batch page.`
      );
    } catch (caught) {
      setStageMessage(
        caught instanceof Error ? caught.message : "Staging failed. No success was reported."
      );
    } finally {
      setStaging(false);
    }
  }

  function downloadIssueReport() {
    const flagged = rows.filter((row) => row.issues.length > 0);
    const csv = [
      [
        "CSV line",
        "Player Id",
        "Player First Name",
        "Player Last Name",
        "Division Name",
        "Birth Date",
        "League Age (2027 chart)",
        "Issues",
      ]
        .map(safeCsvCell)
        .join(","),
      ...flagged.map((row) =>
        [
          String(row.line),
          row.playerId,
          row.firstName,
          row.lastName,
          row.division,
          row.birthDate,
          row.leagueAge === null ? "" : String(row.leagueAge),
          row.issues.join("; "),
        ]
          .map(safeCsvCell)
          .join(",")
      ),
    ].join("\r\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "rwcll-import-preview-issues.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const visibleRows = showAll ? rows : rows.slice(0, 25);

  return (
    <div className="space-y-6">
      {/* File Upload Controls Card */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <UploadCloud className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            Upload Sports Connect CSV
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Expected source headers are checked. Account names, emails, order numbers, and dates are excluded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Drag and Drop Zone + Browse Button */}
            <div className="space-y-2">
              <label htmlFor="sports-connect-csv" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Choose CSV File
              </label>
              
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-5 text-center transition-colors cursor-pointer ${
                  isDragging
                    ? "border-emerald-400 bg-emerald-500/10"
                    : "border-border bg-background hover:border-emerald-500/50"
                }`}
              >
                <UploadCloud className={`mx-auto h-8 w-8 mb-1.5 transition-colors ${
                  isDragging ? "text-emerald-700 dark:text-emerald-400" : "text-slate-600 dark:text-slate-400 group-hover:text-emerald-400"
                }`} />
                <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  {isDragging ? "Drop CSV file here" : "Drag & drop CSV file here, or click to browse"}
                </p>
                <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                  Supported format: .csv (max 10MB)
                </p>
              </div>

              <input
                ref={fileInputRef}
                id="sports-connect-csv"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFile}
                className="hidden"
              />
            </div>

            {/* Target Season Selection */}
            <div className="space-y-2">
              <label htmlFor="import-season" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Target Open Season
              </label>
              <select
                id="import-season"
                value={seasonId}
                onChange={(event) => {
                  setSeasonId(event.target.value);
                  setStageMessage("");
                  setStagedBatchId(null);
                }}
                className="block w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:border-emerald-500"
              >
                <option value="">Choose a season…</option>
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                    {season.startDate ? ` · ${season.startDate}` : ""}
                    {season.endDate ? ` – ${season.endDate}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {seasons.length === 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400 italic">
              No open seasons were found. Create or reopen a season through the approved admin workflow before staging.
            </p>
          )}

          {fileName && (
            <p className="text-xs font-mono text-emerald-700 dark:text-emerald-400">
              Selected File: <span className="font-semibold">{fileName}</span>
            </p>
          )}

          {error && (
            <div role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300 font-mono">
              {error}
            </div>
          )}

          {missingHeaders.length > 0 && (
            <div role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
              <strong>Missing required columns:</strong> {missingHeaders.join(", ")}
            </div>
          )}

          {stageMessage && (
            <div
              role={stagedBatchId ? "status" : "alert"}
              className={`rounded-md border p-3 text-xs font-mono ${
                stagedBatchId
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
              }`}
            >
              {stageMessage}
            </div>
          )}
        </CardContent>
      </Card>

      {/* CSV Analysis Workspace */}
      {rows.length > 0 && (
        <>
          {/* Top Stat Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Metric label="Rows Previewed" value={rows.length} color="text-foreground" />
            <Metric label="Rows Needing Review" value={summary.issues} color={summary.issues > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"} />
            <Metric label="Duplicate Player IDs" value={summary.duplicateIds} color={summary.duplicateIds > 0 ? "text-amber-700 dark:text-amber-400" : "text-slate-700 dark:text-slate-300"} />
            <Metric label="Outside Active Divisions" value={summary.reviewDivisions} color={summary.reviewDivisions > 0 ? "text-amber-700 dark:text-amber-400" : "text-slate-700 dark:text-slate-300"} />
          </div>

          {/* Breakdown Summaries Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <SummaryList title="Payment Status" entries={summary.payment} />
            <SummaryList title="Source Division" entries={summary.divisions} />
            <SummaryList
              title="2027 League Age"
              entries={summary.ages.map(([age, count]) => [String(age), count] as [string, number])}
            />
          </div>

          {/* Save Staging Batch Action Card */}
          <Card className="border-border bg-card">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <FileCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                  Save Staging Batch
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  New players are added only after you review them. For players already registered, payment status, Registration Number and a missing bib are updated now; other changes wait for you on the batch page.
                </p>
              </div>
              <Button
                type="button"
                onClick={saveStagingBatch}
                disabled={staging || !seasonId || rows.length === 0 || missingHeaders.length > 0 || Boolean(stagedBatchId)}
                className="bg-emerald-600 hover:bg-emerald-500 text-foreground text-xs whitespace-nowrap"
              >
                {staging ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving Staging Batch…
                  </>
                ) : stagedBatchId ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-emerald-700 dark:text-emerald-300" /> Staged as #{stagedBatchId}
                  </>
                ) : (
                  "Save Batch for Review"
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Preview Table Section */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <ListFilter className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                Row Preview {rows.length > 25 && !showAll ? `(First 25 of ${rows.length})` : `(${rows.length})`}
              </h2>
              <div className="flex items-center gap-2">
                {rows.length > 25 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAll((current) => !current)}
                    className="border-border bg-background hover:bg-accent text-xs text-slate-700 dark:text-slate-300"
                  >
                    {showAll ? "Show First 25" : "Show All Rows"}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={downloadIssueReport}
                  disabled={summary.issues === 0}
                  className="border-border bg-background hover:bg-accent text-xs text-amber-800 dark:text-amber-300 disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5 mr-1" /> Download Issue Report
                </Button>
              </div>
            </div>

            <Card className="border-border bg-card">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-background text-xs font-mono uppercase tracking-wider text-muted-foreground border-b border-border">
                      <tr>
                        {["Line", "Player ID", "Player", "Birth Date", "Age", "Division", "Payment", "Registration #", "Coach's Kid", "Review Flags"].map((heading) => (
                          <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {visibleRows.map((row) => (
                        <tr key={`${row.line}-${row.playerId}`} className="hover:bg-accent/50 transition-colors align-top">
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.line}</td>
                          <td className="px-4 py-3 font-mono text-xs text-emerald-700 dark:text-emerald-400 font-semibold">{row.playerId || "—"}</td>
                          <td className="px-4 py-3 font-medium text-foreground text-xs">{row.firstName} {row.lastName}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">{row.birthDate || "—"}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">{row.leagueAge ?? "Review"}</td>
                          <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-300">{row.division || "—"}</td>
                          <td className="px-4 py-3 text-xs text-slate-700 dark:text-slate-300">{row.paymentStatus || "—"}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.registrationNumber || "—"}</td>
                          <td className="px-4 py-3 text-xs">{row.coachKid ? <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-semibold text-sky-800 dark:text-sky-300">Yes</span> : <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-4 py-3">
                            <div className="flex max-w-sm flex-wrap gap-1">
                              {row.issues.length ? (
                                row.issues.map((issue) => (
                                  <Badge key={issue} variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-[10px] font-mono">
                                    {issue}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-xs text-slate-600 dark:text-slate-400 italic">No preview flags</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
              A staged batch is not an import. &quot;No preview flags&quot; does not mean a row is approved. Existing-player matching, database conflict checks, administrator decisions, and transaction-safe player/registration commit occur at a later stage.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4">
        <p className="text-xs font-mono text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-bold font-mono tabular-nums ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function SummaryList({ title, entries }: { title: string; entries: [string, number][] }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="py-3 border-b border-border/50">
        <CardTitle className="text-xs font-bold text-foreground uppercase tracking-wider font-mono">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {entries.length ? (
          <ul className="space-y-2">
            {entries.map(([label, count]) => (
              <li key={label} className="flex justify-between items-center text-xs">
                <span className="text-slate-700 dark:text-slate-300">{label}</span>
                <span className="font-mono text-emerald-700 dark:text-emerald-400 font-semibold">{count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-600 dark:text-slate-400 italic">No data available</p>
        )}
      </CardContent>
    </Card>
  );
}