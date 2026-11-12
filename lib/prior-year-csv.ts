// Reads a prior-year (end-of-season) coach ratings CSV into rows for stage_prior_year_import.
// Built around the Sports Connect enrollment export the league uses (2026-11-12 sample):
//   Division Name ("AA Ball - Little League Baseball"), Player Id, Player First Name, Player Last Name,
//   Player Birth Date, User Email, Team Name ("AA 01 - De Leon"), Order No, Easy Rating,
//   DR Hitting, DR Throwing, DR Grounders, DR Fly Balls, DR Running-Awareness, DR Total
// Rules:
// * Rating columns match a skill by name or code, with or without a "DR " prefix ("DR Fly Balls", "Fly Balls", "fly_balls").
// * Players with no ratings at all are skipped (most of a team when the coach didn't rate).
// * Totals and averages (DR Total, Easy Rating) are ignored; the app works out its own averages.
// * Contact and order columns (User Email, Order No, ...) are never stored. Only the columns below are kept.
// * Division is shortened to the league division (AA, AAA, Majors, Juniors, Seniors) when recognisable.
// * Coach name comes from a Coach Name column, else from the team name after the last " - " ("De Leon").
import { COLUMN_ALIASES, findHeader, isoDateOrNull, type CsvTable } from "@/lib/csv-upload";

export type RatingCategory = { code: string; name: string };
export type PriorYearRow = {
  player_id: string; first_name: string; last_name: string; birth_date: string | null;
  season: string; division: string; team: string; coach_name: string;
  ratings: Record<string, number | string>; source: Record<string, string>;
};
export type PriorYearParse =
  | { error: string }
  | { rows: PriorYearRow[]; unrated: number; ratingColumns: string[]; ignoredColumns: string[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const ratingKey = (header: string) => norm(header.replace(/^\s*DR[\s_-]+/i, ""));
const DIVISIONS = ["AAA", "AA", "Majors", "Juniors", "Seniors"];

export function shortDivision(value: string) {
  const v = value.trim();
  const hit = DIVISIONS.find((d) => new RegExp(`^${d}\\b`, "i").test(v));
  return hit ?? v;
}

export function coachFromTeam(team: string) {
  const i = team.lastIndexOf(" - ");
  return i >= 0 ? team.slice(i + 3).trim() : "";
}

export function parsePriorYear(table: CsvTable, categories: RatingCategory[], defaultSeason: string): PriorYearParse {
  const ratingColumns = categories
    .map((c) => ({ code: c.code, header: table.headers.find((h) => ratingKey(h) === norm(c.code) || ratingKey(h) === norm(c.name)) }))
    .filter((c): c is { code: string; header: string } => Boolean(c.header));

  const h = {
    playerId: findHeader(table.headers, COLUMN_ALIASES.playerId),
    first: findHeader(table.headers, COLUMN_ALIASES.firstName),
    last: findHeader(table.headers, COLUMN_ALIASES.lastName),
    birth: findHeader(table.headers, COLUMN_ALIASES.birthDate),
    season: findHeader(table.headers, COLUMN_ALIASES.season),
    division: findHeader(table.headers, COLUMN_ALIASES.division),
    team: findHeader(table.headers, COLUMN_ALIASES.team),
    coach: findHeader(table.headers, COLUMN_ALIASES.coachName),
  };
  if (!h.first || !h.last) return { error: "The file needs Player First Name and Player Last Name columns." };
  if (ratingColumns.length === 0) {
    return { error: "No rating columns found. Use skill names such as DR Hitting, DR Throwing, DR Grounders, DR Fly Balls, DR Running-Awareness (the \"DR \" is optional)." };
  }
  if (!h.season && !defaultSeason) return { error: "The file has no Season column. Type the season the ratings are from (for example Spring 2026)." };

  const kept = new Set([...Object.values(h).filter((x): x is string => Boolean(x)), ...ratingColumns.map((c) => c.header)]);
  const ignoredColumns = table.headers.filter((x) => x && !kept.has(x));

  let unrated = 0;
  const rows: PriorYearRow[] = [];
  for (const r of table.rows) {
    const ratings: Record<string, number | string> = {};
    for (const c of ratingColumns) {
      const v = (r[c.header] ?? "").trim();
      if (v === "") continue;
      // Non-numbers go through as text so the database rejects the row with a clear message.
      ratings[c.code] = /^\d+$/.test(v) ? Number(v) : v;
    }
    if (Object.keys(ratings).length === 0) { unrated++; continue; }
    const team = h.team ? r[h.team] ?? "" : "";
    rows.push({
      player_id: h.playerId ? r[h.playerId] ?? "" : "",
      first_name: r[h.first] ?? "",
      last_name: r[h.last] ?? "",
      birth_date: h.birth ? isoDateOrNull(r[h.birth]) : null,
      season: (h.season ? r[h.season] : "") || defaultSeason,
      division: h.division ? shortDivision(r[h.division] ?? "") : "",
      team,
      coach_name: (h.coach ? r[h.coach] : "") || coachFromTeam(team),
      ratings,
      source: Object.fromEntries([...kept].map((k) => [k, r[k] ?? ""])),
    });
  }
  return { rows, unrated, ratingColumns: ratingColumns.map((c) => c.header), ignoredColumns };
}
