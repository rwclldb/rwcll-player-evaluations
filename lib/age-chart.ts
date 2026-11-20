// Little League age charts: the official CSV (JAN..DEC columns of birth years, then AGE) and lookups.
// One row per league age; each month column says which birth year falls in that age for that birth month.
import { parseCsvLines } from "@/lib/sports-connect-preview";

export type ChartEntry = { birth_year: number; birth_month: number; league_age: number };
export const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export type ChartParse = { entries: ChartEntry[]; ages: number[]; problems: string[] };

const monthIndex = (h: string) => {
  const k = h.trim().slice(0, 3).toUpperCase();
  return MONTHS.indexOf(k);
};

/** Read the age chart CSV. Problems are things to fix before saving (the chart isn't saved with any). */
export function parseAgeChart(text: string): ChartParse {
  const lines = parseCsvLines(text.replace(/^﻿/, "")).map((l) => l.cells.map((c) => c.trim()));
  const problems: string[] = [];
  if (lines.length < 2) return { entries: [], ages: [], problems: ["The file needs a heading row and at least one age."] };
  const head = lines[0];
  const ageCol = head.findIndex((h) => /^(age|league age)$/i.test(h));
  const monthCols = head.map((h, i) => [monthIndex(h), i] as const).filter(([m]) => m >= 0);
  if (ageCol < 0) problems.push("No AGE column.");
  if (new Set(monthCols.map(([m]) => m)).size !== 12) problems.push("The headings need all twelve months, JAN to DEC.");
  if (problems.length) return { entries: [], ages: [], problems };

  const entries: ChartEntry[] = [];
  const seen = new Map<string, number>();
  const ages: number[] = [];
  lines.slice(1).forEach((cells, i) => {
    if (cells.every((c) => c === "")) return;
    const age = Number(cells[ageCol]);
    if (!Number.isInteger(age) || age < 4 || age > 18) { problems.push(`Line ${i + 2}: age "${cells[ageCol] ?? ""}" isn't a whole number from 4 to 18.`); return; }
    if (ages.includes(age)) problems.push(`Age ${age} is listed twice.`);
    ages.push(age);
    for (const [m, col] of monthCols) {
      const year = Number(cells[col]);
      if (!Number.isInteger(year) || year < 1990 || year > 2100) { problems.push(`Line ${i + 2}, ${MONTHS[m]}: "${cells[col] ?? ""}" isn't a birth year.`); continue; }
      const key = `${year}-${m + 1}`;
      if (seen.has(key)) problems.push(`${MONTHS[m]} ${year} is in both age ${seen.get(key)} and age ${age}.`);
      seen.set(key, age);
      entries.push({ birth_year: year, birth_month: m + 1, league_age: age });
    }
  });
  // Sanity: in each month, an older age means an earlier birth year.
  for (let m = 1; m <= 12; m++) {
    const col = entries.filter((e) => e.birth_month === m).sort((a, b) => a.league_age - b.league_age);
    for (let i = 1; i < col.length; i++) {
      if (col[i].birth_year >= col[i - 1].birth_year) { problems.push(`${MONTHS[m - 1]}: age ${col[i].league_age} should have an earlier birth year than age ${col[i - 1].league_age}.`); break; }
    }
  }
  return { entries, ages: ages.sort((a, b) => a - b), problems };
}

/** The chart as a grid: one row per age, the birth year for each month. */
export function chartGrid(entries: ChartEntry[]) {
  const ages = [...new Set(entries.map((e) => e.league_age))].sort((a, b) => a - b);
  return ages.map((age) => ({ age, years: MONTHS.map((_, i) => entries.find((e) => e.league_age === age && e.birth_month === i + 1)?.birth_year ?? null) }));
}

/** The chart back in the official CSV layout (for downloading). */
export function chartCsv(entries: ChartEntry[]) {
  return [[...MONTHS, "AGE"].join(","), ...chartGrid(entries).map((r) => [...r.years.map((y) => y ?? ""), r.age].join(","))].join("\r\n") + "\r\n";
}

export function chartLookup(entries: ChartEntry[]) {
  const map = new Map(entries.map((e) => [`${e.birth_year}-${e.birth_month}`, e.league_age]));
  return (year: number, month: number) => map.get(`${year}-${month}`) ?? null;
}
