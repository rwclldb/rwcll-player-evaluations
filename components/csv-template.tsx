"use client";

import { useState } from "react";
import { Check, Copy, Download, FileSpreadsheet } from "lucide-react";
import type { CsvTemplate } from "@/lib/csv-templates";

const csvCell = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// "Expected columns" panel for an upload page: the column list, a blank CSV to download, and copy-to-clipboard.
export function CsvTemplatePanel({ template }: { template: CsvTemplate }) {
  const [copied, setCopied] = useState(false);
  const header = template.columns.map((c) => csvCell(c.name)).join(",");

  function download() {
    // BOM so Excel opens it as UTF-8; CRLF line ending like Excel's own CSVs.
    const blob = new Blob([String.fromCharCode(0xfeff) + header + "\r\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = template.file;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    try {
      // Tab-separated pastes into separate spreadsheet cells.
      await navigator.clipboard.writeText(template.columns.map((c) => c.name).join("\t"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <details className="group rounded-lg border border-border bg-card text-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2.5">
        <FileSpreadsheet className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
        <span className="font-semibold text-foreground">Expected columns</span>
        <span className="text-xs text-muted-foreground group-open:hidden">({template.columns.length}) · show list, download a blank CSV</span>
        <span className="ml-auto flex gap-2" onClick={(e) => e.preventDefault()}>
          <button type="button" onClick={download}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:border-emerald-500/60 hover:bg-accent">
            <Download className="h-3.5 w-3.5" /> Download blank CSV
          </button>
          <button type="button" onClick={copy} title="Copies the column names, ready to paste into row 1 of a spreadsheet"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:border-emerald-500/60 hover:bg-accent">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy headings"}
          </button>
        </span>
      </summary>
      <div className="space-y-2 border-t border-border px-4 py-3">
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {template.columns.map((c) => (
            <li key={c.name} className="flex flex-wrap items-baseline gap-x-2">
              <code className="font-mono text-xs font-semibold text-foreground">{c.name}</code>
              <span className={`text-[11px] ${c.need === "required" ? "font-semibold text-rose-700 dark:text-rose-300" : "text-muted-foreground"}`}>
                {c.need}{c.note ? ` · ${c.note}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {template.tip && <p className="text-xs text-muted-foreground">{template.tip} Column names aren&apos;t case-sensitive, and extra columns are ignored.</p>}
      </div>
    </details>
  );
}
