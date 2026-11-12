"use client";

import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COLUMN_ALIASES, findHeader, readCsv } from "@/lib/csv-upload";
import { invitePeople } from "./actions";

type Role = "coach" | "independent_evaluator";
type Row = { key: string; name: string; email: string; role: Role; note: string; include: boolean; divisions: string[]; lines: number };

// Sports Connect volunteer roles: anything with "coach" or "manager" is a coach; "evaluator" is an evaluator.
function roleFrom(text: string, fallback: Role): Role {
  const t = text.toLowerCase();
  if (t.includes("evaluator")) return "independent_evaluator";
  if (t.includes("coach") || t.includes("manager")) return "coach";
  return fallback;
}

export function PeopleImport({ seasonId, divisions }: { seasonId: number; divisions: string[] }) {
  const known = new Map(divisions.map((d) => [d.toLowerCase(), d]));
  const [rows, setRows] = useState<Row[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [fallback, setFallback] = useState<Role>("coach");
  const [delivery, setDelivery] = useState<"email" | "link">("email");
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
      division: findHeader(table.headers, ["Division Name", "Division"]),
    };
    if (!h.email) { setProblem("No email column found (looked for \"Email\", \"Email Address\", \"Volunteer Email\")."); return; }
    // One entry per email. A coach on several rows (several teams) keeps every division listed.
    const byEmail = new Map<string, Row>();
    const out: Row[] = [];
    for (const r of table.rows) {
      const email = (r[h.email] ?? "").trim().toLowerCase();
      if (!email) continue;
      const division = (h.division ? r[h.division] ?? "" : "").trim();
      const existing = byEmail.get(email);
      if (existing) {
        existing.lines++;
        if (division && !existing.divisions.some((d) => d.toLowerCase() === division.toLowerCase())) existing.divisions.push(division);
        continue;
      }
      const name = (h.name ? r[h.name] : `${h.first ? r[h.first] : ""} ${h.last ? r[h.last] : ""}`).trim();
      const role = roleFrom(h.role ? r[h.role] ?? "" : "", fallback);
      const row: Row = { key: `${out.length}`, name, email, role, include: true, note: h.role ? r[h.role] ?? "" : "", divisions: division ? [division] : [], lines: 1 };
      byEmail.set(email, row);
      out.push(row);
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
          <input type="hidden" name="delivery" value={delivery} />
          <input type="hidden" name="rows" value={JSON.stringify(selected.map(({ name, email, role, divisions: d }) => ({ name, email, role, divisions: role === "coach" ? d : [] })))} />
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
                {(r.note || r.divisions.length > 0 || r.lines > 1) && (
                  <span className="flex w-full flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {r.note && <span>{r.note}</span>}
                    {r.lines > 1 && <span>· on {r.lines} rows</span>}
                    {r.role === "coach" && r.divisions.map((d) => known.has(d.toLowerCase())
                      ? <span key={d} className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-800 dark:text-emerald-300">{known.get(d.toLowerCase())}</span>
                      : <span key={d} title="Not a division this season; it will be ignored" className="rounded bg-muted px-1.5 py-0.5 line-through">{d}</span>)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <label className="text-xs text-muted-foreground">New accounts
              <select value={delivery} onChange={(e) => setDelivery(e.target.value as "email" | "link")} className="ml-2 h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                <option value="email">Email each an invitation</option>
                <option value="link">Create without email (send Sign-in links yourself)</option>
              </select>
            </label>
            <span className="text-sm text-muted-foreground">
              {selected.length} selected. Existing accounts just get the role.
            </span>
            <Button type="submit" className="min-h-11" disabled={selected.length === 0}><Upload className="mr-1 h-4 w-4" /> Invite selected</Button>
          </div>
        </form>
      )}
    </div>
  );
}
