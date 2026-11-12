import { normalizeDate, parseCsv } from "@/lib/sports-connect-preview";

// Spreadsheet uploads with flexible column names ("Player Id", "player_id", "PlayerID" all work).
const key = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

export type CsvTable = { headers: string[]; rows: Record<string, string>[] };

export function readCsv(text: string): CsvTable {
  const grid = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (grid[0] ?? []).map((h) => h.trim());
  const rows = grid.slice(1).map((cells) => Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()])));
  return { headers, rows };
}

// The header that matches one of the aliases, if any. Earlier aliases win, so a file with both
// "Evaluation Number" and "Registration Number" uses Evaluation Number for the bib.
export function findHeader(headers: string[], aliases: string[]): string | undefined {
  for (const alias of aliases) {
    const hit = headers.find((h) => key(h) === key(alias));
    if (hit) return hit;
  }
  return undefined;
}

export const COLUMN_ALIASES = {
  playerId: ["Player Id", "Sports Connect Player Id", "PlayerID", "Player_Id"],
  firstName: ["Player First Name", "First Name", "First"],
  lastName: ["Player Last Name", "Last Name", "Last"],
  birthDate: ["Player Birth Date", "Birth Date", "Birthdate", "Date of Birth", "DOB"],
  // Sports Connect's "Registration Number" field is where the league keeps the bib.
  bib: ["Evaluation Number", "Bib", "Bib Number", "Eval Number", "Evaluation #", "Registration Number", "Registration #", "Reg Number"],
  // Sports Connect exports name the season in "Program Name" (e.g. "2026 Spring Baseball").
  season: ["Season", "Program Name", "Program"],
  division: ["Division", "Division Name"],
  team: ["Team", "Team Name"],
  coachName: ["Coach Name", "Coach"],
  email: ["Email", "Email Address", "Volunteer Email", "Volunteer Email Address", "Account Email"],
  role: ["Role", "Volunteer Role"],
};

export function isoDateOrNull(value: string | undefined): string | null {
  return value ? normalizeDate(value)?.iso ?? null : null;
}

// Server actions accept up to 1 MB by default; these spreadsheets are a few KB.
export const MAX_UPLOAD_BYTES = 900 * 1024;

// Read an uploaded CSV file from a form, with friendly errors.
export async function readUploadedCsv(formData: FormData, field = "file"): Promise<{ table?: CsvTable; name?: string; error?: string }> {
  const file = formData.get(field);
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file to upload." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That file is larger than 900 KB." };
  const table = readCsv(await file.text());
  if (table.rows.length === 0) return { error: "The file has no data rows." };
  return { table, name: file.name };
}
