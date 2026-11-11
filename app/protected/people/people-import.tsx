"use client";

import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COLUMN_ALIASES, findHeader, readCsv } from "@/lib/csv-upload";
import { invitePeople } from "./actions";

type Role = "coach" | "independent_evaluator";
type Row = { key: string; name: string; email: string; role: Role; note: string; include: boolean };

// Sports Connect volunteer roles: anything with "coach" or "manager" is a coach; "evaluator" is an evaluator.
function roleFrom(text: string, fallback: Role): Role {
  const t = text.toLowerCase();
  if (t.includes("evaluator")) return "independent_evaluator";
  if (t.includes("coach") || t.includes("manager")) return "coach";
  return fallback;
}

export function PeopleImport({ seasonId }: { seasonId: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [fallback, setFallback] = useState<Role>("coach");
  const selected = useMemo(() => rows.filter((r) => r.include), [rows]);

  async function onFile(file: File | undefined) {
    setProblem(null); setRows([]);
    if (!file) return;
    const table = readCsv(await file.text());
    const h = {
      email: findHeader(table.headers, COLUMN_ALIASES.email),
      first: findHeader(table.headers, ["Volunteer First Name", ...COLUMN_ALIASES.firstName.filter((a) => !a.startsWith("Player"))]),
      last: findHeader(table.headers, ["Volunteer Last Name", ...COLUMN_ALIASES.lastName.filter((a) => !a.startsWith("Player"))]),
      name: findHeader(table.headers, ["Name", "Full Name", "Volunteer Name"]),
      role: findHeader(table.headers, COLUMN_ALIASES.role),
    };
    if (!h.email) { setProblem("No email column found (looked for \"Email\", \"Email Address\", \"Volunteer Email\")."); return; }
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const r of table.rows) {
      const email = (r[h.email] ?? "").trim().toLowerCase();
      if (!email) continue;
      const name = (h.name ? r[h.name] : `${h.first ? r[h.first] : ""} ${h.last ? r[h.last] : ""}`).trim();
      const role = roleFrom(h.role ? r[h.role] ?? "" : "", fallback);
      const dup = seen.has(email);
      seen.add(email);
      out.push({ key: `${out.length}`, name, email, role, include: !dup, note: dup ? "Listed more than once; only the first is used." : h.role ? r[h.role] ?? "" : "" });
    }
    if (out.length === 0) setProblem("No rows with an email address.");
    setRows(out);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 text-xs text-muted-foreground">Coach or volunteer list (CSV)
          <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])}
            className="mt-1 block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-2" />
        </label>
        <label className="text-xs text-muted-foreground">When the file has no role column
          <select value={fallback} onChange={(e) => setFallback(e.target.value as Role)} className="mt-1 block h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground">
            <option value="coach">Coach</option>
            <option value="independent_evaluator">Independent evaluator</option>
          </select>
        </label>
      </div>
      {problem && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{problem}</p>}
      {rows.length > 0 && (
        <form action={invitePeople} className="space-y-3">
          <input type="hidden" name="seasonId" value={seasonId} />
          <input type="hidden" name="rows" value={JSON.stringify(selected.map(({ name, email, role }) => ({ name, email, role })))} />
          <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card text-sm">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <input type="checkbox" checked={r.include} className="h-5 w-5"
                  onChange={(e) => setRows((all) => all.map((x) => x.key === r.key ? { ...x, include: e.target.checked } : x))} aria-label={`Invite ${r.email}`} />
                <span className="font-medium text-foreground">{r.name || "(no name)"}</span>
                <span className="font-mono text-xs text-muted-foreground">{r.email}</span>
                <select value={r.role} onChange={(e) => setRows((all) => all.map((x) => x.key === r.key ? { ...x, role: e.target.value as Role } : x))}
                  className="ml-auto h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground">
                  <option value="coach">Coach</option>
                  <option value="independent_evaluator">Independent evaluator</option>
                </select>
                {r.note && <span className="w-full text-xs text-muted-foreground">{r.note}</span>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-sm text-muted-foreground">
              {selected.length} selected. New emails get an invitation; existing accounts just get the role.
            </span>
            <Button type="submit" className="min-h-11" disabled={selected.length === 0}><Upload className="mr-1 h-4 w-4" /> Invite selected</Button>
          </div>
        </form>
      )}
    </div>
  );
}
