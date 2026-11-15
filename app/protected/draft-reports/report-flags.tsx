"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// One scorer's evaluation of a player that needs a look (admins only): a draft, a Not Evaluated mark,
// or a saved evaluation with core skills left blank. Loaded by the page; links to View / correct.
export type ScoreIssue = {
  id: number;
  player_season_id: number;
  scorer: string;
  evaluator_type: "coach" | "independent_evaluator";
  status: "draft" | "submitted" | "not_evaluated";
  blank: number;
};

export type ReportFlag = {
  key: string;
  label: string;
  explain: string;
  fixes: { href: string; label: string }[];
};

type FlagRow = {
  player_season_id: number;
  evaluation_number: number | null;
  coach_evaluations: number;
  evaluator_evaluations: number;
  blank_core_skills: number;
  not_evaluated_marks: number;
  drafts_excluded: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const who = (i: ScoreIssue) => `${i.scorer} (${i.evaluator_type === "coach" ? "coach" : "evaluator"})`;
const open = (i: ScoreIssue, what: string) => ({ href: `/protected/evaluation-review/${i.id}`, label: `${who(i)}: ${what}` });

export type FlagContext = {
  /** Admins: the evaluations behind draft, blank-skill and not-evaluated flags. */
  issues?: ScoreIssue[];
  /** Players the announcer called in this age group; null when calling wasn't used (no "Not called" flags). */
  called?: Set<number> | null;
  /** Players exempt from being evaluated (never flagged as not called). */
  exemptFromEvaluation?: Set<number>;
};

// What each flag means, and for admins where to fix it. CSV, print and PDF use only the label.
export function reportFlags(r: FlagRow, administrator: boolean, ctx: FlagContext = {}): ReportFlag[] {
  const mine = (ctx.issues ?? []).filter((i) => i.player_season_id === r.player_season_id);
  const playerPage = { href: `/protected/players/${r.player_season_id}`, label: "Open the player's page" };
  const out: ReportFlag[] = [];
  if (r.evaluation_number === null) {
    out.push({
      key: "bib", label: "No bib",
      explain: "This player has no evaluation number (bib) this season, so scorers can't find them by bib.",
      fixes: administrator ? [{ href: playerPage.href, label: "Set the bib on the player's page" }] : [],
    });
  }
  if (r.coach_evaluations + r.evaluator_evaluations === 0) {
    out.push({
      key: "unrated", label: "Not rated",
      explain: "Nobody has a saved score for this player. If they missed evaluation day they may need a makeup; if the league excused them, record an exemption on their page.",
      fixes: administrator ? [{ href: "/protected/progress", label: "See who is scoring this age group" }, playerPage] : [],
    });
  }
  if (ctx.called && !ctx.called.has(r.player_season_id) && !ctx.exemptFromEvaluation?.has(r.player_season_id)) {
    out.push({
      key: "not-called", label: "Not called",
      explain: "The announcer never called this player up on evaluation day, so they may not have been seen by every scorer. Check the scores before the draft.",
      fixes: administrator ? [{ href: "/protected/end-of-day", label: "Open the End-of-day check" }, playerPage] : [],
    });
  }
  if (r.blank_core_skills > 0) {
    out.push({
      key: "blank", label: plural(r.blank_core_skills, "blank skill"),
      explain: "A scorer saved without rating every core skill. Averages use only the skills that were rated; a blank never counts as zero.",
      fixes: mine.filter((i) => i.status === "submitted" && i.blank > 0).map((i) => open(i, `${plural(i.blank, "blank skill")}, view or correct`)),
    });
  }
  if (r.not_evaluated_marks > 0) {
    out.push({
      key: "not-evaluated", label: `${r.not_evaluated_marks} not evaluated`,
      explain: "A scorer marked this player Not Evaluated (absent, injured, or not seen). Those marks are left out of the averages.",
      fixes: mine.filter((i) => i.status === "not_evaluated").map((i) => open(i, "view or correct")),
    });
  }
  if (administrator && r.drafts_excluded > 0) {
    out.push({
      key: "draft", label: plural(r.drafts_excluded, "unsubmitted draft"),
      explain: "A scorer started this player but didn't save, so it doesn't count in the report. Ask them to open the player and tap Save (unlock the age group first if it's locked), or open the scores and correct them yourself.",
      fixes: mine.filter((i) => i.status === "draft").map((i) => open(i, "draft, view or correct")),
    });
  }
  return out;
}

// A flag on the draft report: tap it for what it means and, for admins, where to fix it.
export function FlagChip({ flag, administrator }: { flag: ReportFlag; administrator: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="whitespace-nowrap rounded bg-amber-500/15 px-1.5 py-0.5 text-left text-amber-800 underline decoration-dotted underline-offset-2 hover:bg-amber-500/25 dark:text-amber-300 print:bg-transparent print:p-0 print:text-black print:no-underline"
        title="What does this mean?"
        onClick={(e) => e.stopPropagation()}
      >
        {flag.label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-sm">{flag.label}</DropdownMenuLabel>
        <p className="px-2 pb-2 text-xs leading-relaxed text-muted-foreground">{flag.explain}</p>
        {flag.fixes.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">To fix it</DropdownMenuLabel>
            {flag.fixes.map((f) => (
              <DropdownMenuItem key={f.href} asChild>
                <Link href={f.href} className="min-h-9 gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  <ArrowRight className="h-3.5 w-3.5 shrink-0" /> {f.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </>
        )}
        {!administrator && (
          <p className="px-2 pb-2 pt-1 text-[11px] text-muted-foreground">A league admin can fix this.</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
