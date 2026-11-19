import { findHeader, type CsvTable } from "@/lib/csv-upload";

// Teams upload. Two layouts are accepted:
// * one row per team: Division, Team, Manager Email, Coach Email, Assistant Emails (separated by ; or ,)
// * the Sports Connect volunteer report, one row per person: Division Name, Team Name, Volunteer Role,
//   Volunteer Email Address. "Team Manager"/"Manager" is the manager, "Coach"/"Head Coach" the coach,
//   "Assistant Coach" an assistant. Rows with no team yet ("Unallocated" or blank) and other roles are skipped.

export type TeamRow = { line: number; division: string; team: string; manager: string; coach: string; assistants: string[] };
export type TeamsParse = { rows: TeamRow[]; problems: { line: number; division: string; team: string; message: string }[]; skipped: { line: number; reason: string }[] };

export const TEAM_HEADERS = {
  division: ["Division", "Division Name"],
  team: ["Team", "Team Name"],
  manager: ["Manager Email", "Manager", "Team Manager Email", "Team Manager"],
  coach: ["Coach Email", "Coach", "Head Coach Email", "Head Coach"],
  assistants: ["Assistant Emails", "Assistant Coach Emails", "Assistants", "Assistant Coaches"],
  role: ["Volunteer Role", "Role"],
  email: ["Volunteer Email Address", "Volunteer Email", "Email", "Email Address"],
};

const NO_TEAM = new Set(["", "unallocated", "unassigned", "tbd", "none"]);
const emails = (v: string) => v.split(/[;,\s]+/).map((e) => e.trim()).filter(Boolean);

export function roleFromVolunteerRole(role: string): "manager" | "coach" | "assistant_coach" | null {
  const r = role.trim().toLowerCase();
  if (r.includes("assistant")) return "assistant_coach";
  if (r === "manager" || r === "team manager") return "manager";
  if (r === "coach" || r === "head coach") return "coach";
  return null;
}

export function parseTeamsCsv(table: CsvTable): TeamsParse | { error: string } {
  const h = (k: keyof typeof TEAM_HEADERS) => findHeader(table.headers, TEAM_HEADERS[k]);
  const division = h("division");
  const team = h("team");
  if (!division || !team) return { error: "The file needs a Division column and a Team (or Team Name) column." };
  const role = h("role");
  const email = h("email");
  const line = (i: number) => table.lines?.[i] ?? i + 2;
  const out: TeamsParse = { rows: [], problems: [], skipped: [] };

  // One row per person: group into teams.
  if (role && email) {
    const teams = new Map<string, TeamRow>();
    table.rows.forEach((r, i) => {
      const t = r[team] ?? "";
      if (NO_TEAM.has(t.trim().toLowerCase())) { out.skipped.push({ line: line(i), reason: "No team yet" }); return; }
      const job = roleFromVolunteerRole(r[role] ?? "");
      if (!job) { out.skipped.push({ line: line(i), reason: `Role "${r[role] ?? ""}" isn't manager, coach or assistant` }); return; }
      const who = (r[email] ?? "").trim();
      if (!who) { out.skipped.push({ line: line(i), reason: "No email" }); return; }
      const key = `${(r[division] ?? "").trim().toLowerCase()}|${t.trim().toLowerCase()}`;
      const row = teams.get(key) ?? { line: line(i), division: (r[division] ?? "").trim(), team: t.trim(), manager: "", coach: "", assistants: [] };
      teams.set(key, row);
      if (job === "assistant_coach") { if (!row.assistants.includes(who)) row.assistants.push(who); return; }
      if (row[job] && row[job].toLowerCase() !== who.toLowerCase()) {
        out.problems.push({ line: line(i), division: row.division, team: row.team, message: `Two ${job === "manager" ? "managers" : "coaches"} listed for this team (${row[job]} and ${who}). Make one an assistant.` });
        return;
      }
      row[job] = who;
    });
    out.rows = [...teams.values()];
    return out;
  }

  // One row per team.
  const manager = h("manager");
  const coach = h("coach");
  const assistants = h("assistants");
  table.rows.forEach((r, i) => {
    const t = (r[team] ?? "").trim();
    if (!t && !(r[division] ?? "").trim()) return;
    out.rows.push({
      line: line(i), division: (r[division] ?? "").trim(), team: t,
      manager: manager ? (r[manager] ?? "").trim() : "", coach: coach ? (r[coach] ?? "").trim() : "",
      assistants: assistants ? emails(r[assistants] ?? "") : [],
    });
  });
  return out;
}
