// Builds the files in a season backup zip from admin_season_backup (raw tables) and draft_report (averages).
// Pure functions, no database or Next.js: the route in app/protected/seasons/[id]/backup does the loading and zipping,
// and scripts/test-season-backup.cjs checks this file.

export type BackupRow = Record<string, unknown>;
export type Backup = { made_at: string; season_id: number; tables: Record<string, BackupRow[]> };
export type DraftRow = {
  player_season_id: number; evaluation_number: number | null; first_name: string; last_name: string; league_age: number | null;
  coach_overall: number | null; coach_evaluations: number; evaluator_overall: number | null; evaluator_evaluations: number;
  prior_overall: number | null; prior_ratings: number;
  skill_averages: { coach?: Record<string, number>; evaluator?: Record<string, number>; prior?: Record<string, number>;
    coach_trimmed?: Record<string, number>; coach_trimmed_overall?: number } | null;
  blank_core_skills: number; not_evaluated_marks: number; drafts_excluded: number;
};

const CORE: [string, string][] = [
  ["hitting", "Hitting"], ["throwing", "Throwing"], ["grounders", "Grounders"], ["fly_balls", "Fly Balls"], ["running_awareness", "Running / Awareness"],
];
const ANSWERS: [string, string][] = [
  ["pitched_before", "Pitched before"], ["caught_before", "Caught before"],
  ["interested_in_pitching", "Interested in pitching"], ["interested_in_catching", "Interested in catching"],
];
const EXEMPT_LABEL: Record<string, string> = { attendance: "Attendance", evaluation: "Evaluation", both: "Attendance and evaluation" };
const SCORER_LABEL: Record<string, string> = { coach: "Coach", independent_evaluator: "Independent evaluator" };
const ROLE_LABEL: Record<string, string> = {
  administrator: "League admin", coach: "Coach", independent_evaluator: "Independent evaluator", registrar: "Registrar", announcer: "Announcer",
};

// Never written to a backup, whatever a table gains later (birthdates stay out).
const FORBIDDEN_COLUMN = /birth_date|date_of_birth|source_data/;

type Cell = string | number | boolean | null | undefined;

export function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Keep spreadsheets from running a name or note as a formula.
  const text = /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) || text !== raw ? `"${text.replace(/"/g, '""')}"` : text;
}

// UTF-8 BOM so Excel opens names with accents correctly; CRLF line ends.
export function toCsv(head: string[], rows: Cell[][] | unknown[][]) {
  return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// A raw table: columns in the order of the first row, plus any that appear later.
export function tableCsv(rows: BackupRow[]) {
  const columns: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key) && !FORBIDDEN_COLUMN.test(key)) columns.push(key);
  return toCsv(columns, rows.map((row) => columns.map((c) => row[c] as Cell)));
}

const pacific = (iso: unknown) => (typeof iso === "string" && iso
  ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit" })
  : "");
const two = (v: unknown) => (v === null || v === undefined || v === "" ? "" : Number(v).toFixed(2));
const n = (v: unknown) => Number(v);

export function buildBackupFiles(backup: Backup, draft: DraftRow[], madeBy: string): Record<string, string> {
  const t = (name: string) => backup.tables[name] ?? [];
  const season = t("seasons")[0] ?? {};
  const seasonName = String(season.name ?? `Season ${backup.season_id}`);

  const players = new Map(t("players").map((p) => [n(p.id), p]));
  const registrations = [...t("player_seasons")].sort((a, b) =>
    (n(a.league_age) || 99) - (n(b.league_age) || 99) || (n(a.evaluation_number) || 1e9) - (n(b.evaluation_number) || 1e9) || n(a.id) - n(b.id));
  const regById = new Map(registrations.map((r) => [n(r.id), r]));
  const nameOf = (r: BackupRow | undefined) => {
    const p = r ? players.get(n(r.player_id)) : undefined;
    return [String(p?.last_name ?? ""), String(p?.first_name ?? "")];
  };
  const accounts = new Map(t("accounts").map((a) => [String(a.user_id), a]));
  const personName = (id: unknown) => {
    const a = accounts.get(String(id));
    return a ? String(a.display_name || a.email || "") : "";
  };
  const categories = [...t("rating_categories")].sort((a, b) => n(a.sort_order) - n(b.sort_order));
  const categoryById = new Map(categories.map((c) => [n(c.id), c]));
  const sessions = new Map(t("evaluation_sessions").map((s) => [n(s.id), s]));
  const activeExemption = new Map(t("player_exemptions").filter((e) => !e.revoked_at).map((e) => [n(e.player_season_id), String(e.scope)]));
  const count = (rows: BackupRow[], key: string) => {
    const m = new Map<number, number>();
    for (const r of rows) m.set(n(r[key]), (m.get(n(r[key])) ?? 0) + 1);
    return m;
  };
  const checkins = count(t("player_checkins"), "player_season_id");
  const calls = count(t("player_calls"), "player_season_id");
  const submitted = count(t("evaluations").filter((e) => e.status === "submitted"), "player_season_id");

  const files: Record<string, string> = {};

  // Players: one row per registration.
  files["players.csv"] = toCsv(
    ["Age", "Bib", "Last Name", "First Name", "Coach's Kid", "Exempt", "Birthdate on file", "Sports Connect Player Id",
      "Registration Number", "Payment Status", "Added by", "Check-ins", "Times called", "Scores saved", "Registration id", "Player id"],
    registrations.map((r) => {
      const p = players.get(n(r.player_id));
      return [r.league_age as Cell, r.evaluation_number as Cell, ...nameOf(r), r.is_coach_kid ? "Yes" : "",
        EXEMPT_LABEL[activeExemption.get(n(r.id)) ?? ""] ?? "", p?.has_birth_date ? "Yes" : "No", r.external_player_id as Cell,
        r.external_registration_id as Cell, r.registration_payment_status as Cell, r.registration_source === "on_site" ? "On site (walk-up)" : "Import",
        checkins.get(n(r.id)) ?? 0, calls.get(n(r.id)) ?? 0, submitted.get(n(r.id)) ?? 0, r.id as Cell, r.player_id as Cell];
    }),
  );

  // Draft report: the same averages coaches see, every age group in one sheet.
  const draftSorted = [...draft].sort((a, b) =>
    (a.league_age ?? 99) - (b.league_age ?? 99) || (b.evaluator_overall ?? -1) - (a.evaluator_overall ?? -1) || (a.evaluation_number ?? 1e9) - (b.evaluation_number ?? 1e9));
  files["draft-report.csv"] = toCsv(
    ["Age", "Bib", "Last Name", "First Name", "Coach's Kid", "Exempt", "Evaluator Overall", "Evaluators", "Coach Overall",
      "Coach Overall (high/low dropped)", "Coaches", "Prior-Year Overall", "Prior-Year Ratings",
      ...CORE.flatMap(([, l]) => [`Evaluator ${l}`, `Coach ${l}`, `Coach ${l} (high/low dropped)`, `Prior ${l}`]),
      "Evaluator Pitching", "Coach Pitching", "Evaluator Catching", "Coach Catching", "Blank core skills", "Not evaluated marks", "Drafts (not counted)"],
    draftSorted.map((d) => {
      const a = d.skill_averages ?? {};
      const reg = regById.get(d.player_season_id);
      return [d.league_age, d.evaluation_number, d.last_name, d.first_name, reg?.is_coach_kid ? "Yes" : "",
        EXEMPT_LABEL[activeExemption.get(d.player_season_id) ?? ""] ?? "",
        two(d.evaluator_overall), d.evaluator_evaluations, two(d.coach_overall), two(a.coach_trimmed_overall), d.coach_evaluations,
        two(d.prior_overall), d.prior_ratings,
        ...CORE.flatMap(([c]) => [two(a.evaluator?.[c]), two(a.coach?.[c]), two(a.coach_trimmed?.[c]), two(a.prior?.[c])]),
        two(a.evaluator?.pitching), two(a.coach?.pitching), two(a.evaluator?.catching), two(a.coach?.catching),
        d.blank_core_skills, d.not_evaluated_marks, d.drafts_excluded];
    }),
  );

  // Scores: one row per saved evaluation, every category and answer as a column.
  const ratingsBy = new Map<number, Map<number, unknown>>();
  for (const r of t("ratings")) {
    if (!ratingsBy.has(n(r.evaluation_id))) ratingsBy.set(n(r.evaluation_id), new Map());
    ratingsBy.get(n(r.evaluation_id))!.set(n(r.rating_category_id), r.score);
  }
  const answersBy = new Map<number, Map<string, unknown>>();
  for (const r of t("experience_answers")) {
    if (!answersBy.has(n(r.evaluation_id))) answersBy.set(n(r.evaluation_id), new Map());
    answersBy.get(n(r.evaluation_id))!.set(String(r.question_code), r.answer);
  }
  const noteBy = new Map(t("evaluator_notes").map((x) => [n(x.evaluation_id), x.note_text]));
  const evaluations = [...t("evaluations")].sort((a, b) => {
    const ra = regById.get(n(a.player_season_id)), rb = regById.get(n(b.player_season_id));
    return (n(ra?.league_age) || 99) - (n(rb?.league_age) || 99) || (n(ra?.evaluation_number) || 1e9) - (n(rb?.evaluation_number) || 1e9)
      || String(a.evaluator_type).localeCompare(String(b.evaluator_type)) || personName(a.evaluator_user_id).localeCompare(personName(b.evaluator_user_id));
  });
  files["scores.csv"] = toCsv(
    ["Age", "Bib", "Last Name", "First Name", "Scorer", "Scorer type", "Status", "Saved", ...categories.map((c) => String(c.name)),
      ...ANSWERS.map(([, l]) => l), "Evaluator note", "Evaluation id"],
    evaluations.map((e) => {
      const reg = regById.get(n(e.player_season_id));
      const scores = ratingsBy.get(n(e.id));
      const answers = answersBy.get(n(e.id));
      const session = sessions.get(n(e.evaluation_session_id));
      return [(reg?.league_age ?? session?.league_age) as Cell, reg?.evaluation_number as Cell, ...nameOf(reg), personName(e.evaluator_user_id),
        SCORER_LABEL[String(e.evaluator_type)] ?? (e.evaluator_type as Cell),
        e.status === "submitted" ? "Saved" : e.status === "not_evaluated" ? "Not evaluated" : e.status === "draft" ? "Draft (not counted)" : (e.status as Cell),
        pacific(e.submitted_at || e.updated_at), ...categories.map((c) => scores?.get(n(c.id)) as Cell),
        ...ANSWERS.map(([code]) => answers?.get(code) as Cell), noteBy.get(n(e.id)) as Cell, e.id as Cell];
    }),
  );

  // Prior-year coach ratings of this season's players.
  const regByPlayer = new Map(registrations.map((r) => [n(r.player_id), r]));
  const priorBy = new Map<number, Map<string, unknown>>();
  for (const r of t("historical_ratings")) {
    if (!priorBy.has(n(r.historical_evaluation_id))) priorBy.set(n(r.historical_evaluation_id), new Map());
    const code = r.rating_category_id ? String(categoryById.get(n(r.rating_category_id))?.name ?? r.category_name) : String(r.category_name);
    priorBy.get(n(r.historical_evaluation_id))!.set(code, r.score);
  }
  const priorColumns = [...new Set([...categories.map((c) => String(c.name)), ...[...priorBy.values()].flatMap((m) => [...m.keys()])])]
    .filter((c) => [...priorBy.values()].some((m) => m.has(c)));
  files["prior-year.csv"] = toCsv(
    ["Age", "Bib", "Last Name", "First Name", "Season", "Division", "Team", "Coach", ...priorColumns],
    t("historical_evaluations").map((h) => {
      const reg = regByPlayer.get(n(h.player_id));
      return [reg?.league_age as Cell, reg?.evaluation_number as Cell, ...nameOf(reg), h.source_season_label as Cell, h.source_division_name as Cell,
        h.source_team_label as Cell, (h.source_coach_name || personName(h.source_coach_user_id)) as Cell, ...priorColumns.map((c) => priorBy.get(n(h.id))?.get(c) as Cell)];
    }).sort((a, b) => (n(a[0]) || 99) - (n(b[0]) || 99) || (n(a[1]) || 1e9) - (n(b[1]) || 1e9)),
  );

  // People: accounts with a role this season (and admins), their roles, divisions and age groups.
  const divisionName = new Map(t("divisions").map((d) => [n(d.id), String(d.name)]));
  const rolesBy = new Map<string, string[]>();
  for (const r of t("user_roles")) rolesBy.set(String(r.user_id), [...(rolesBy.get(String(r.user_id)) ?? []), ROLE_LABEL[String(r.role_name)] ?? String(r.role_name)]);
  const divisionsBy = new Map<string, string[]>();
  for (const r of t("coach_divisions")) divisionsBy.set(String(r.user_id), [...(divisionsBy.get(String(r.user_id)) ?? []), divisionName.get(n(r.division_id)) ?? ""]);
  const agesBy = new Map<string, number[]>();
  for (const r of t("evaluator_assignments")) {
    const age = n(sessions.get(n(r.evaluation_session_id))?.league_age);
    if (age) agesBy.set(String(r.evaluator_user_id), [...(agesBy.get(String(r.evaluator_user_id)) ?? []), age]);
  }
  files["people.csv"] = toCsv(
    ["Name", "Email", "Roles", "Coach divisions", "Age groups assigned", "Disabled", "Last sign-in", "Account id"],
    t("accounts").map((a) => {
      const id = String(a.user_id);
      return [a.display_name as Cell, a.email as Cell, (rolesBy.get(id) ?? ["(no role; scored or assigned earlier)"]).join(", "),
        (divisionsBy.get(id) ?? []).join(", "), [...new Set(agesBy.get(id) ?? [])].sort((x, y) => x - y).join(", "),
        a.disabled ? "Yes" : "", pacific(a.last_sign_in_at), id];
    }),
  );

  // Schedule: each age group's status and events.
  const events = [...t("evaluation_session_events")].sort((a, b) =>
    n(sessions.get(n(a.evaluation_session_id))?.league_age) - n(sessions.get(n(b.evaluation_session_id))?.league_age)
    || String(a.event_date).localeCompare(String(b.event_date)) || String(a.start_time).localeCompare(String(b.start_time)));
  files["schedule.csv"] = toCsv(
    ["Age", "Age group status", "Event", "Date", "Start", "End", "Location", "Notes"],
    events.map((e) => {
      const s = sessions.get(n(e.evaluation_session_id));
      return [s?.league_age as Cell, s?.status as Cell, e.event_type === "primary" ? "Main" : "Makeup", e.event_date as Cell,
        String(e.start_time ?? "").slice(0, 5), String(e.end_time ?? "").slice(0, 5), e.location as Cell, e.notes as Cell];
    }),
  );

  // Raw tables, column for column, for rebuilding the data later.
  for (const [name, rows] of Object.entries(backup.tables)) files[`tables/${name}.csv`] = tableCsv(rows);

  const counts = Object.entries(backup.tables).sort(([a], [b]) => a.localeCompare(b))
    .map(([name, rows]) => `  tables/${name}.csv`.padEnd(44) + `${rows.length} ${rows.length === 1 ? "row" : "rows"}`).join("\r\n");
  files["README.txt"] = [
    `RWCLL Player Evaluations: season backup`,
    ``,
    `Season:   ${seasonName}`,
    `Made:     ${pacific(backup.made_at)} (Pacific time)`,
    `Made by:  ${madeBy}`,
    ``,
    `This is a copy of everything the app stores for this season, as spreadsheets. Open the files in Excel or Google Sheets.`,
    `If the app is down on draft night, draft-report.csv has the same averages as the Draft Reports page.`,
    ``,
    `Easy to read:`,
    `  draft-report.csv   averages per player (evaluator, coach, coach with high/low dropped, prior-year), by age group`,
    `  scores.csv         every saved score, one row per scorer per player, with experience answers and evaluator notes`,
    `  players.csv        every registration: age, bib, coach's kid, exemptions, check-ins, calls`,
    `  prior-year.csv     last season's coach ratings of this season's players`,
    `  people.csv         accounts, roles, coach divisions and assigned age groups`,
    `  schedule.csv       each age group's status, events, times and places`,
    ``,
    `Raw tables (the database's own columns and ids, for rebuilding the data):`,
    counts,
    ``,
    `Not included, on purpose:`,
    `  - Birthdates. players.csv says only whether one is on file. Sports Connect has them.`,
    `  - Coaches' private notes and private stars. Only their owner can read them.`,
    `  - Import staging rows, the audit log and View-as preview records.`,
    ``,
    `This file holds children's names and coaches' email addresses. Keep it somewhere private and delete old copies.`,
    `The app does not restore from this file. To restore the whole database, see "Back up and restore the whole database" in docs/FAQ.md.`,
    ``,
  ].join("\r\n");

  return files;
}

export const backupFileName = (seasonName: string, madeAt: string) => {
  const day = new Date(madeAt).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const time = new Date(madeAt).toLocaleTimeString("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit" }).replace(":", "");
  return `rwcll-backup-${seasonName.replace(/[^a-zA-Z0-9_-]+/g, "-")}-${day}-${time}.zip`;
};
