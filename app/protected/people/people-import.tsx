"use client";

import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COLUMN_ALIASES, findHeader, readCsv } from "@/lib/csv-upload";
import { missingFromFile, planPersonRow, type ExistingPerson, type RowPlan, type SeasonRole } from "@/lib/people-sync";
import { invitePeople } from "./actions";

type Row = {
  key: string; name: string; email: string; role: SeasonRole; note: string; include: boolean;
  divisions: string[]; lines: number; remove: string[]; useFileName: boolean;
};

const STATUS: Record<RowPlan["status"], { label: string; className: string }> = {
  new: { label: "New account", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
  add_role: { label: "Add role", className: "bg-sky-500/15 text-sky-800 dark:text-sky-300" },
  changes: { label: "Changes", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  up_to_date: { label: "Up to date", className: "bg-muted text-muted-foreground" },
  role_conflict: { label: "Can't add", className: "bg-rose-500/15 text-rose-800 dark:text-rose-300" },
};
const ROLE_NAMES: Record<SeasonRole, string> = { coach: "coach", independent_evaluator: "independent evaluator" };

// Sports Connect volunteer roles: anything with "coach" or "manager" is a coach; "evaluator" is an evaluator.
function roleFrom(text: string, fallback: SeasonRole): SeasonRole {
  const t = text.toLowerCase();
  if (t.includes("evaluator")) return "independent_evaluator";
  if (t.includes("coach") || t.includes("manager")) return "coach";
  return fallback;
}

export function PeopleImport({ seasonId, divisions, existing }: { seasonId: number; divisions: string[]; existing: ExistingPerson[] }) {
  const known = new Map(divisions.map((d) => [d.toLowerCase(), d]));
  const byEmail = useMemo(() => new Map(existing.map((p) => [p.email.toLowerCase(), p])), [existing]);
  const [rows, setRows] = useState<Row[]>([]);
  const [hasDivisions, setHasDivisions] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fallback, setFallback] = useState<SeasonRole>("coach");
  const [delivery, setDelivery] = useState<"email" | "link">("email");

  const plans = useMemo(() => new Map(rows.map((r) => [r.key,
    planPersonRow({ name: r.name, role: r.role, fileDivisions: r.divisions }, byEmail.get(r.email), divisions, hasDivisions)])), [rows, byEmail, divisions, hasDivisions]);
  const selected = rows.filter((r) => r.include && plans.get(r.key)?.status !== "role_conflict");
  const missing = useMemo(() => rows.length ? missingFromFile(existing, rows.map((r) => r.email)) : [], [rows, existing]);
  const update = (key: string, change: Partial<Row>) => setRows((all) => all.map((x) => x.key === key ? { ...x, ...change } : x));

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
    const seen = new Map<string, Row>();
    const out: Row[] = [];
    for (const r of table.rows) {
      const email = (r[h.email] ?? "").trim().toLowerCase();
      if (!email) continue;
      const division = (h.division ? r[h.division] ?? "" : "").trim();
      const already = seen.get(email);
      if (already) {
        already.lines++;
        if (division && !already.divisions.some((d) => d.toLowerCase() === division.toLowerCase())) already.divisions.push(division);
        continue;
      }
      const name = (h.name ? r[h.name] : `${h.first ? r[h.first] : ""} ${h.last ? r[h.last] : ""}`).trim();
      const row: Row = { key: `${out.length}`, name, email, role: roleFrom(h.role ? r[h.role] ?? "" : "", fallback), include: true,
        note: h.role ? r[h.role] ?? "" : "", divisions: division ? [division] : [], lines: 1, remove: [], useFileName: false };
      seen.set(email, row);
      out.push(row);
    }
    if (out.length === 0) setProblem("No rows with an email address.");
    // Only rows that would change something start ticked.
    for (const row of out) {
      const plan = planPersonRow({ name: row.name, role: row.role, fileDivisions: row.divisions }, byEmail.get(row.email), divisions, Boolean(h.division));
      row.include = plan.status === "new" || plan.status === "add_role" || plan.status === "changes";
    }
    setHasDivisions(Boolean(h.division));
    setRows(out);
  }

  const counts = rows.reduce((c, r) => { const s = plans.get(r.key)!.status; c[s] = (c[s] ?? 0) + 1; return c; }, {} as Record<string, number>);
  const active = rows.filter((r) => plans.get(r.key)?.status !== "up_to_date");
  const upToDate = rows.filter((r) => plans.get(r.key)?.status === "up_to_date");

  const renderRow = (r: Row) => {
    const plan = plans.get(r.key)!;
    const conflict = plan.status === "role_conflict";
    return (
      <li key={r.key} className="space-y-1 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <input type="checkbox" checked={r.include && !conflict} disabled={conflict} className="h-5 w-5"
            onChange={(e) => update(r.key, { include: e.target.checked })} aria-label={`Include ${r.email}`} />
          <span className="font-medium text-foreground">{plan.currentName || r.name || "(no name)"}</span>
          <span className="font-mono text-xs text-muted-foreground">{r.email}</span>
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[plan.status].className}`}>{STATUS[plan.status].label}</span>
          <select value={r.role} onChange={(e) => update(r.key, { role: e.target.value as SeasonRole, remove: [] })}
            className="ml-auto h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground">
            <option value="coach">Coach</option>
            <option value="independent_evaluator">Independent evaluator</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-1 pl-8 text-xs text-muted-foreground">
          {r.note && <span>{r.note}</span>}
          {r.lines > 1 && <span>· on {r.lines} rows</span>}
          {conflict && <span className="text-rose-700 dark:text-rose-300">Already an {ROLE_NAMES[byEmail.get(r.email)!.role!]} this season. One account can&apos;t hold both roles; use a different email.</span>}
          {r.role === "coach" && !conflict && r.divisions.map((d) => {
            const name = known.get(d.toLowerCase());
            if (!name) return <span key={d} title="Not a division this season; it will be ignored" className="rounded bg-muted px-1.5 py-0.5 line-through">{d}</span>;
            const adding = plan.addDivisions.includes(name);
            return <span key={d} title={adding ? "Will be added" : "Already has it"} className={`rounded px-1.5 py-0.5 font-medium ${adding ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" : "bg-muted text-foreground"}`}>{adding ? "+ " : ""}{name}</span>;
          })}
        </div>
        {(plan.removeDivisions.length > 0 || plan.nameDiffers) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 pl-8 text-sm">
            {plan.removeDivisions.map((d) => (
              <label key={d} className="flex items-center gap-1.5">
                <input type="checkbox" className="h-4 w-4" checked={r.remove.includes(d)}
                  onChange={(e) => update(r.key, { include: e.target.checked || r.include, remove: e.target.checked ? [...r.remove, d] : r.remove.filter((x) => x !== d) })} />
                Remove {d} <span className="text-xs text-muted-foreground">(not in this file)</span>
              </label>
            ))}
            {plan.nameDiffers && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" className="h-4 w-4" checked={r.useFileName}
                  onChange={(e) => update(r.key, { include: e.target.checked || r.include, useFileName: e.target.checked })} />
                Use the file&apos;s name <span className="font-medium">{r.name}</span>
              </label>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1 text-xs text-muted-foreground">Coach or volunteer list (CSV)
          <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])}
            className="mt-1 block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-2" />
        </label>
        <label className="text-xs text-muted-foreground">When the file has no role column
          <select value={fallback} onChange={(e) => setFallback(e.target.value as SeasonRole)} className="mt-1 block h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground">
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
          <input type="hidden" name="rows" value={JSON.stringify(selected.map((r) => ({
            name: r.name, email: r.email, role: r.role,
            divisions: r.role === "coach" ? r.divisions : [],
            removeDivisions: r.role === "coach" ? r.remove : [],
            useFileName: r.useFileName,
          })))} />
          <p className="flex flex-wrap gap-2 text-xs">
            {(Object.keys(STATUS) as RowPlan["status"][]).filter((s) => counts[s]).map((s) => (
              <span key={s} className={`rounded px-2 py-1 font-medium ${STATUS[s].className}`}>{counts[s]} {STATUS[s].label.toLowerCase()}</span>
            ))}
          </p>
          {active.length > 0 && (
            <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card text-sm">{active.map(renderRow)}</ul>
          )}
          {upToDate.length > 0 && (
            <details className="rounded-lg border border-border bg-card text-sm">
              <summary className="cursor-pointer px-3 py-2 text-foreground">Already up to date ({upToDate.length}): same role and divisions</summary>
              <ul className="max-h-72 divide-y divide-border overflow-y-auto border-t border-border">{upToDate.map(renderRow)}</ul>
            </details>
          )}
          {missing.length > 0 && (
            <details className="rounded-lg border border-border bg-card text-sm">
              <summary className="cursor-pointer px-3 py-2 text-foreground">In the app this season but not in this file ({missing.length})</summary>
              <p className="border-t border-border px-3 pt-2 text-xs text-muted-foreground">Nothing is removed. To take away a role, use the person&apos;s row in Accounts below.</p>
              <ul className="max-h-72 space-y-1 overflow-y-auto px-3 py-2">
                {missing.map((p) => (
                  <li key={p.email}>{p.name || p.email} <span className="font-mono text-xs text-muted-foreground">{p.email}</span>{" "}
                    <span className="text-xs text-muted-foreground">{ROLE_NAMES[p.role!]}{p.divisions.length ? ` (${p.divisions.join(", ")})` : ""}</span></li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <label className="text-xs text-muted-foreground">New accounts
              <select value={delivery} onChange={(e) => setDelivery(e.target.value as "email" | "link")} className="ml-2 h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                <option value="email">Email each an invitation</option>
                <option value="link">Create without email (send Sign-in links yourself)</option>
              </select>
            </label>
            <span className="text-sm text-muted-foreground">{selected.length} selected.</span>
            <Button type="submit" className="min-h-11" disabled={selected.length === 0}><Upload className="mr-1 h-4 w-4" /> Apply selected</Button>
          </div>
          <p className="text-right text-xs text-muted-foreground">
            New divisions are added. Divisions and names change only where you tick them. Existing accounts keep their password and sign-in email.
          </p>
        </form>
      )}
    </div>
  );
}
