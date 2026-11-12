import ageChart2027 from "./data/age-chart-2027.json";

type AgeEntry = { birth_year: number; birth_month: number; league_age: number };
export type PreviewRow = {
  line: number;
  playerId: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  program: string;
  division: string;
  registrationNumber: string;
  paymentStatus: string;
  leagueAge: number | null;
  issues: string[];
};

export const REQUIRED_HEADERS = [
  "Program Name", "Division Name", "Player Id", "Registration Number",
  "Player First Name", "Player Last Name", "Player Birth Date", "Order Payment Status",
];
export const ACTIVE_DIVISIONS = new Set(["AA", "AAA", "MAJORS", "JUNIORS", "SENIORS"]);
const ALLOWED_PAYMENT_STATUSES = new Set([
  "PAID",
  "PENDING",
  "UNPAID",
  "COMPLETED",
]);
const chartByBirthMonth = new Map<string, number>(
  (ageChart2027 as AgeEntry[]).map((entry) => [`${entry.birth_year}-${entry.birth_month}`, entry.league_age]),
);

export function parseCsv(text: string): string[][] {
  return parseCsvLines(text).map((r) => r.cells);
}

/** Non-blank records with their spreadsheet row number (blank rows are skipped but still counted). */
export function parseCsvLines(text: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = [];
  let line = 0;
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      line += 1;
      if (row.some((value) => value.trim() !== "")) rows.push({ cells: row, line });
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    line += 1;
    if (row.some((value) => value.trim() !== "")) rows.push({ cells: row, line });
  }
  return rows;
}

export function normalizeDate(value: string): { iso: string; year: number; month: number } | null {
  const raw = value.trim();
  let year: number; let month: number; let day: number;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (us) { month = Number(us[1]); day = Number(us[2]); year = Number(us[3]); }
  else if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]); }
  else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { iso: `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`, year, month };
}

// League age from the 2027 age chart (by birth year and month), or null when the chart has no entry.
export function leagueAgeForBirthDate(value: string | null | undefined): number | null {
  const date = value ? normalizeDate(value) : null;
  return date ? chartByBirthMonth.get(`${date.year}-${date.month}`) ?? null : null;
}

export function makePreview(text: string): { rows: PreviewRow[]; missingHeaders: string[] } {
  const records = parseCsvLines(text);
  const parsed = records.map((r) => r.cells);
  if (parsed.length < 2) throw new Error("The file must include a header row and at least one registration.");
  const headers = parsed[0].map((header) => header.trim());
  const indexes = new Map(headers.map((header, index) => [header, index]));
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !indexes.has(header));
  if (missingHeaders.length) return { rows: [], missingHeaders };
  const get = (cells: string[], header: string) => (cells[indexes.get(header)!] ?? "").trim();
  const rows = parsed.slice(1).map((cells, index): PreviewRow => {
    const playerId = get(cells, "Player Id");
    const firstName = get(cells, "Player First Name");
    const lastName = get(cells, "Player Last Name");
    const birthDateRaw = get(cells, "Player Birth Date");
    const date = normalizeDate(birthDateRaw);
    const division = get(cells, "Division Name");
    const paymentStatus = get(cells, "Order Payment Status");
    const registrationNumber = get(cells, "Registration Number");
    const issues: string[] = [];
    if (!playerId) issues.push("Missing Player ID");
    if (!firstName || !lastName) issues.push("Missing player name");
    if (!date) issues.push("Invalid or missing birthdate");
    if (!paymentStatus || !ALLOWED_PAYMENT_STATUSES.has(paymentStatus.toUpperCase())) issues.push("Payment status needs review");
    if (!ACTIVE_DIVISIONS.has(division.toUpperCase())) issues.push("Division needs review");
    const leagueAge = date ? chartByBirthMonth.get(`${date.year}-${date.month}`) ?? null : null;
    if (date && leagueAge === null) issues.push("No reviewed age-chart entry");
    return {
      line: records[index + 1].line,
      playerId,
      firstName,
      lastName,
      birthDate: date?.iso ?? birthDateRaw,
      program: get(cells, "Program Name"),
      division,
      registrationNumber,
      paymentStatus,
      leagueAge,
      issues,
    };
  });
  const counts = new Map<string, number>();
  for (const row of rows) if (row.playerId) counts.set(row.playerId, (counts.get(row.playerId) ?? 0) + 1);
  const registrationCounts = new Map<string, number>();
  for (const row of rows) if (row.registrationNumber) registrationCounts.set(row.registrationNumber, (registrationCounts.get(row.registrationNumber) ?? 0) + 1);
  for (const row of rows) {
    if (row.playerId && (counts.get(row.playerId) ?? 0) > 1) row.issues.push("Duplicate Player ID in file");
    if (row.registrationNumber && (registrationCounts.get(row.registrationNumber) ?? 0) > 1) row.issues.push("Duplicate Registration Number in file");
  }
  return { rows, missingHeaders };
}


/** Escape a CSV cell for spreadsheet safety. Values that spreadsheet apps may
 * interpret as formulas are prefixed with an apostrophe before CSV quoting. */
export function safeCsvCell(value: string): string {
  const spreadsheetSafe = /^[\s\u0000-\u001f]*[=+@\-]/.test(value) ? `'${value}` : value;
  return `"${spreadsheetSafe.replaceAll('"', '""')}"`;
}
