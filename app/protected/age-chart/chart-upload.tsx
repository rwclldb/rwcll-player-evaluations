"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MONTHS, chartCsv, chartGrid, parseAgeChart, type ChartEntry } from "@/lib/age-chart";
import { saveAgeChart } from "./actions";

export function ChartGrid({ entries }: { entries: ChartEntry[] }) {
  const grid = chartGrid(entries);
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm tabular-nums">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr><th className="px-2 py-1.5 text-left">League age</th>{MONTHS.map((m) => <th key={m} className="px-2 py-1.5 text-right">{m}</th>)}</tr>
        </thead>
        <tbody>
          {grid.map((r) => (
            <tr key={r.age} className="border-t border-border">
              <td className="px-2 py-1 font-bold">{r.age}</td>
              {r.years.map((y, i) => <td key={i} className={`px-2 py-1 text-right ${i >= 8 ? "text-sky-800 dark:text-sky-300" : ""}`}>{y ?? "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DownloadChart({ entries, name }: { entries: ChartEntry[]; name: string }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => {
      const blob = new Blob([String.fromCharCode(0xfeff) + chartCsv(entries)], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `little-league-age-chart-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    }}><Download className="mr-1 h-4 w-4" /> Download as CSV</Button>
  );
}

// Choose or drop the league's age chart CSV, check it, then save it for the season (replacing the old one).
export function ChartUpload({ seasonId, seasonName, hasChart }: { seasonId: number; seasonName: string; hasChart: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<{ name: string; entries: ChartEntry[]; ages: number[]; problems: string[] } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function read(f: File | undefined) {
    setMessage(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) { setFile(null); setMessage({ ok: false, text: "Choose a CSV file." }); return; }
    const parsed = parseAgeChart(await f.text());
    setFile({ name: f.name, ...parsed });
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(false); read(e.dataTransfer.files?.[0]); };

  async function save() {
    if (!file) return;
    if (hasChart && !window.confirm(`Replace ${seasonName}'s age chart with ${file.name}? Players' ages don't change by themselves; the page then lists anyone whose age doesn't match.`)) return;
    setBusy(true);
    const r = await saveAgeChart(seasonId, file.entries, file.name);
    setBusy(false);
    if (r.ok) { setMessage({ ok: true, text: `Saved: ${r.rows} birth months.` }); setFile(null); router.refresh(); }
    else setMessage({ ok: false, text: r.message });
  }

  return (
    <div className="space-y-3">
      <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-emerald-500 bg-emerald-500/10" : "border-border bg-card hover:bg-accent"}`}>
        <UploadCloud className="h-8 w-8 text-emerald-700 dark:text-emerald-400" />
        <p className="text-sm font-medium text-foreground">Drop the age chart CSV here, or click to choose it</p>
        <p className="text-xs text-muted-foreground">Columns JAN to DEC (birth years) and AGE, one row per league age, as Little League publishes it.</p>
        <input ref={input} type="file" accept=".csv,text/csv" aria-label="Age chart CSV file" className="hidden" onChange={(e) => read(e.target.files?.[0])} />
      </div>
      {message && <div role={message.ok ? "status" : "alert"} className={`rounded-lg border p-3 text-sm ${message.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"}`}>{message.text}</div>}
      {file && (
        <div className="space-y-3 rounded-xl border border-emerald-500/40 p-3">
          <p className="text-sm text-foreground"><strong>{file.name}</strong>: ages {file.ages[0]}–{file.ages[file.ages.length - 1]}, {file.entries.length} birth months.</p>
          {file.problems.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-rose-700 dark:text-rose-300">{file.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          ) : <ChartGrid entries={file.entries} />}
          <div className="flex items-center gap-2">
            <Button disabled={busy || file.problems.length > 0} onClick={save}>Save as the {seasonName} age chart</Button>
            <Button variant="ghost" onClick={() => setFile(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
