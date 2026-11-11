"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, Lock, MessageSquare, Printer, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeCsvCell } from "@/lib/sports-connect-preview";
import { saveNote } from "@/app/protected/my-notes/actions";

export type DraftReportRow = {
  player_season_id: number;
  evaluation_number: number | null;
  first_name: string;
  last_name: string;
  league_age: number;
  coach_overall: number | null;
  coach_skills_rated: number;
  coach_evaluations: number;
  evaluator_overall: number | null;
  evaluator_skills_rated: number;
  evaluator_evaluations: number;
  prior_overall: number | null;
  prior_skills_rated: number;
  prior_ratings: number;
  skill_averages: { coach: Record<string, number>; evaluator: Record<string, number>; prior: Record<string, number> };
  my_evaluation: { status: string; ratings: Record<string, number> } | null;
  blank_core_skills: number;
  not_evaluated_marks: number;
  drafts_excluded: number;
};

export type ReportNote = { player_season_id: number; kind: "private" | "shared"; note_text: string; author_label: string; is_mine: boolean };

type SortKey = "evaluator_overall" | "coach_overall" | "prior_overall" | "evaluation_number" | "name" | "pitching" | "catching";

const SKILLS: [string, string][] = [
  ["hitting", "Hitting"], ["throwing", "Throwing"], ["grounders", "Grounders"], ["fly_balls", "Fly Balls"], ["running_awareness", "Running / Awareness"],
];
const OPTIONAL: [string, string][] = [["pitching", "Pitching"], ["catching", "Catching"]];
const MY_PITCH = ["pitching_mechanics", "pitching_accuracy_control", "pitching_arm_strength"];
const MY_CATCH = ["catching_receiving", "catching_blocking", "catching_throwing"];

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const fmt = (v: number | string | null | undefined) => { const n = num(v); return n === null ? "—" : n.toFixed(2); };
const bestOptional = (r: DraftReportRow, k: "pitching" | "catching") => num(r.skill_averages?.evaluator?.[k]) ?? num(r.skill_averages?.coach?.[k]);
const myAverage = (ratings: Record<string, number>, codes: string[]) => {
  const v = codes.map((c) => ratings[c]).filter((x) => x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

function flags(r: DraftReportRow, administrator: boolean) {
  const out: string[] = [];
  if (r.evaluation_number === null) out.push("No bib");
  if (r.coach_evaluations + r.evaluator_evaluations === 0) out.push("Not rated");
  if (r.blank_core_skills > 0) out.push(`${r.blank_core_skills} blank skill${r.blank_core_skills === 1 ? "" : "s"}`);
  if (r.not_evaluated_marks > 0) out.push(`${r.not_evaluated_marks} not evaluated`);
  if (administrator && r.drafts_excluded > 0) out.push(`${r.drafts_excluded} unsubmitted draft${r.drafts_excluded === 1 ? "" : "s"}`);
  return out;
}

// notes: what the database lets this viewer see (player_notes). canWritePrivate: coaches get a private-note box.
export function DraftReportTable({ rows, title, fileName, administrator, notes = [], canWritePrivate = false, returnTo }: {
  rows: DraftReportRow[]; title: string; fileName: string; administrator: boolean;
  notes?: ReportNote[]; canWritePrivate?: boolean; returnTo: string;
}) {
  const notesFor = useMemo(() => {
    const m = new Map<number, ReportNote[]>();
    for (const n of notes) m.set(n.player_season_id, [...(m.get(n.player_season_id) ?? []), n]);
    return m;
  }, [notes]);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "evaluator_overall", desc: true });
  const [open, setOpen] = useState<Set<number>>(new Set());

  const sorted = useMemo(() => {
    const value = (r: DraftReportRow): number | string | null => {
      switch (sort.key) {
        case "name": return `${r.last_name}, ${r.first_name}`.toLowerCase();
        case "evaluation_number": return r.evaluation_number;
        case "pitching": case "catching": return bestOptional(r, sort.key);
        default: return num(r[sort.key]);
      }
    };
    return [...rows].sort((a, b) => {
      const va = value(a), vb = value(b);
      if (va === null && vb === null) return a.last_name.localeCompare(b.last_name);
      if (va === null) return 1; // blanks always last
      if (vb === null) return -1;
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return (sort.desc ? -c : c) || a.last_name.localeCompare(b.last_name);
    });
  }, [rows, sort]);

  const header = (key: SortKey, label: string, defaultDesc: boolean, extra = "") => (
    <th scope="col" className={`px-3 py-2 ${extra}`} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" className="font-semibold hover:underline print:no-underline" onClick={() => setSort(sort.key === key ? { key, desc: !sort.desc } : { key, desc: defaultDesc })}>
        {label}{sort.key === key ? (sort.desc ? " ▼" : " ▲") : ""}
      </button>
    </th>
  );

  function downloadCsv() {
    const head = ["Bib", "Last Name", "First Name", "Age", "Evaluator Overall", "Evaluator Skills Rated", "Evaluators", "Coach Overall", "Coach Skills Rated", "Coaches",
      "Prior-Year Overall", "Prior-Year Ratings", ...SKILLS.flatMap(([c, l]) => [`Evaluator ${l}`, `Coach ${l}`, `Prior ${l}`]),
      "Evaluator Pitching", "Coach Pitching", "Evaluator Catching", "Coach Catching", "Flags"];
    const lines = sorted.map((r) => [
      r.evaluation_number ?? "", r.last_name, r.first_name, r.league_age, fmt(r.evaluator_overall), r.evaluator_skills_rated, r.evaluator_evaluations,
      fmt(r.coach_overall), r.coach_skills_rated, r.coach_evaluations, fmt(r.prior_overall), r.prior_ratings,
      ...SKILLS.flatMap(([c]) => [fmt(r.skill_averages?.evaluator?.[c]), fmt(r.skill_averages?.coach?.[c]), fmt(r.skill_averages?.prior?.[c])]),
      fmt(r.skill_averages?.evaluator?.pitching), fmt(r.skill_averages?.coach?.pitching), fmt(r.skill_averages?.evaluator?.catching), fmt(r.skill_averages?.coach?.catching),
      flags(r, administrator).join("; "),
    ].map((v) => safeCsvCell(String(v === "—" ? "" : v))).join(","));
    const blob = new Blob([[head.map((h) => safeCsvCell(h)).join(","), ...lines].join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const overallCell = (value: number | null, skills: number, raters: number, who: string) => (
    <td className="px-3 py-2 text-right">
      <div className="font-mono text-sm font-bold">{fmt(value)}</div>
      {raters > 0 && (
        <div className={`text-[10px] ${skills < 5 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"} print:text-black`}>
          {skills < 5 ? `${skills} of 5 skills · ` : ""}{raters} {raters === 1 ? who : who === "coach" ? "coaches" : `${who}s`}
        </div>
      )}
    </td>
  );

  return (
    <section className="space-y-3">
      <style>{"@media print { @page { size: landscape; margin: 0.4in; } }"}</style>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-foreground print:text-black">{title}</h2>
        <div className="flex gap-2 print:hidden">
          <Button type="button" variant="outline" size="sm" onClick={downloadCsv}><Download className="mr-1 h-4 w-4" /> CSV</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" /> Print</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground print:hidden">{rows.length} players. Click a column heading to sort; click a player to see each skill.</p>

      <div className="overflow-x-auto rounded-lg border border-border print:overflow-visible print:border-black">
        <table className="w-full text-left text-sm print:text-[10px] print:text-black">
          <thead className="border-b border-border bg-background text-xs uppercase tracking-wide text-muted-foreground print:text-black">
            <tr>
              {header("evaluation_number", "Bib", false)}
              {header("name", "Player", false)}
              {header("evaluator_overall", "Evaluator Overall", true, "text-right")}
              {header("coach_overall", "Coach Overall", true, "text-right")}
              {header("prior_overall", "Prior-Year", true, "text-right")}
              {header("pitching", "Pitching", true, "text-right")}
              {header("catching", "Catching", true, "text-right")}
              <th scope="col" className="px-3 py-2">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border print:divide-black">
            {sorted.map((r) => {
              const expanded = open.has(r.player_season_id);
              const toggle = () => setOpen((s) => { const n = new Set(s); if (n.has(r.player_season_id)) n.delete(r.player_season_id); else n.add(r.player_season_id); return n; });
              return (
                <Fragment key={r.player_season_id}>
                  <tr className="cursor-pointer hover:bg-accent/50 print:break-inside-avoid" onClick={toggle}>
                    <td className="px-3 py-2 font-mono">{r.evaluation_number ?? "—"}</td>
                    <td className="px-3 py-2">
                      <button type="button" className="flex items-center gap-1 text-left font-medium text-foreground print:text-black" aria-expanded={expanded} onClick={(e) => { e.stopPropagation(); toggle(); }}>
                        <span className="print:hidden">{expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</span>
                        {r.last_name}, {r.first_name}
                        {notesFor.has(r.player_season_id) && <StickyNote className="ml-1 h-3.5 w-3.5 text-amber-600 dark:text-amber-400 print:hidden" aria-label="Has notes" />}
                      </button>
                    </td>
                    {overallCell(num(r.evaluator_overall), r.evaluator_skills_rated, r.evaluator_evaluations, "evaluator")}
                    {overallCell(num(r.coach_overall), r.coach_skills_rated, r.coach_evaluations, "coach")}
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.prior_overall)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{bestOptional(r, "pitching") === null ? "—" : `E ${fmt(r.skill_averages?.evaluator?.pitching)} · C ${fmt(r.skill_averages?.coach?.pitching)}`}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{bestOptional(r, "catching") === null ? "—" : `E ${fmt(r.skill_averages?.evaluator?.catching)} · C ${fmt(r.skill_averages?.coach?.catching)}`}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex flex-wrap gap-1">
                        {flags(r, administrator).map((f) => (
                          <span key={f} className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-800 dark:text-amber-300 print:bg-transparent print:p-0 print:text-black">{f}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="bg-background/60 print:hidden">
                      <td colSpan={8} className="px-3 py-3">
                        <table className="text-xs">
                          <thead className="text-muted-foreground">
                            <tr>
                              <th className="pr-6 text-left font-medium">Skill</th>
                              <th className="pr-6 text-right font-medium">Evaluators</th>
                              <th className="pr-6 text-right font-medium">Coaches</th>
                              <th className="pr-6 text-right font-medium">Prior-Year</th>
                              {r.my_evaluation && <th className="text-right font-medium">Your rating{r.my_evaluation.status !== "submitted" ? ` (${r.my_evaluation.status === "draft" ? "draft, not counted" : "not evaluated"})` : ""}</th>}
                            </tr>
                          </thead>
                          <tbody className="font-mono">
                            {[...SKILLS, ...OPTIONAL].map(([code, label]) => (
                              <tr key={code}>
                                <td className="pr-6 font-sans">{label}</td>
                                <td className="pr-6 text-right">{fmt(r.skill_averages?.evaluator?.[code])}</td>
                                <td className="pr-6 text-right">{fmt(r.skill_averages?.coach?.[code])}</td>
                                <td className="pr-6 text-right">{fmt(r.skill_averages?.prior?.[code])}</td>
                                {r.my_evaluation && (
                                  <td className="text-right">
                                    {code === "pitching" ? fmt(myAverage(r.my_evaluation.ratings, MY_PITCH))
                                      : code === "catching" ? fmt(myAverage(r.my_evaluation.ratings, MY_CATCH))
                                      : r.my_evaluation.ratings[code] ?? "—"}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <PlayerNotes
                          playerSeasonId={r.player_season_id}
                          notes={notesFor.get(r.player_season_id) ?? []}
                          canWritePrivate={canWritePrivate}
                          returnTo={returnTo}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hidden text-[9px] print:block">E = independent evaluators, C = coaches. Averages use submitted evaluations only; blank skills are not counted as zero.</p>
    </section>
  );
}

function PlayerNotes({ playerSeasonId, notes, canWritePrivate, returnTo }: { playerSeasonId: number; notes: ReportNote[]; canWritePrivate: boolean; returnTo: string }) {
  const shared = notes.filter((n) => n.kind === "shared");
  const mine = notes.find((n) => n.kind === "private");
  if (shared.length === 0 && !canWritePrivate) return null;
  return (
    <div className="mt-4 grid gap-4 text-xs md:grid-cols-2">
      <div className="space-y-2">
        <h4 className="flex items-center gap-1.5 font-semibold text-foreground"><MessageSquare className="h-3.5 w-3.5" /> Independent evaluator notes</h4>
        {shared.length === 0 ? (
          <p className="text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-2">
            {shared.map((n, i) => (
              <li key={i} className="rounded border border-border bg-card p-2">
                <p className="whitespace-pre-wrap text-foreground">{n.note_text}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{n.author_label}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
      {canWritePrivate && (
        <form action={saveNote} className="space-y-2">
          <input type="hidden" name="kind" value="private" />
          <input type="hidden" name="playerSeasonId" value={playerSeasonId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <label htmlFor={`private-note-${playerSeasonId}`} className="flex items-center gap-1.5 font-semibold text-foreground">
            <Lock className="h-3.5 w-3.5" /> Your private note <span className="font-normal text-muted-foreground">(only you can see it)</span>
          </label>
          <textarea
            id={`private-note-${playerSeasonId}`}
            name="note"
            defaultValue={mine?.note_text ?? ""}
            maxLength={2000}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 sm:text-xs"
          />
          <Button type="submit" size="sm">Save note</Button>
        </form>
      )}
    </div>
  );
}
