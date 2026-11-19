import { createClient } from "@/lib/supabase/server";

// Team rosters as a CSV (admins and registrars): one row per player on a team, plain column names to rename for
// Sports Connect. Coach emails only for admins (season_roster_rows decides). Cells that a spreadsheet could read as a
// formula get a leading apostrophe.
const HEADERS: [string, string][] = [
  ["season", "Season"], ["division", "Division"], ["team", "Team"], ["manager", "Manager"], ["manager_email", "Manager Email"],
  ["coach", "Coach"], ["coach_email", "Coach Email"], ["player_first_name", "Player First Name"], ["player_last_name", "Player Last Name"],
  ["sports_connect_player_id", "Player Id"], ["registration_number", "Registration Number"], ["bib", "Bib"], ["league_age", "League Age"],
  ["coach_kid", "Coach's Kid"], ["sibling_group", "Sibling Group"], ["placed_by", "Placed By"], ["requested_division", "Requested Division"],
];
const cell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request: Request) {
  const seasonId = Number(new URL(request.url).searchParams.get("season"));
  if (!Number.isSafeInteger(seasonId) || seasonId <= 0) return new Response("Season not found.", { status: 404 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return new Response("Please sign in again.", { status: 401 });
  const { data, error } = await supabase.rpc("season_roster_rows", { p_season_id: seasonId });
  if (error) return new Response(error.message, { status: error.code === "42501" ? 403 : 500 });
  const rows = (data ?? []) as Record<string, unknown>[];
  const season = String(rows[0]?.season ?? `season-${seasonId}`);
  const csv = [HEADERS.map(([, h]) => cell(h)).join(","), ...rows.map((r) => HEADERS.map(([k]) => cell(r[k])).join(","))].join("\r\n") + "\r\n";
  return new Response(String.fromCharCode(0xfeff) + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="team-rosters-${season.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
