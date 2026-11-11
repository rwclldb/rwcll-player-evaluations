"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { COLUMN_ALIASES, findHeader, isoDateOrNull, readUploadedCsv } from "@/lib/csv-upload";

const id = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
const go = (path: string, kind: "message" | "error", text: string): never =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function stagePriorYearUpload(formData: FormData) {
  const back = "/protected/prior-year";
  const seasonId = id(formData.get("seasonId"));
  const defaultSeason = String(formData.get("seasonLabel") ?? "").trim();
  const { table, name, error: fileError } = await readUploadedCsv(formData);
  if (!table) return go(back, "error", fileError ?? "Could not read the file.");

  const supabase = await createClient();
  const { data: categories } = await supabase.from("rating_categories").select("code, name");
  // A rating column may be named by code ("fly_balls") or by name ("Fly Balls").
  const ratingColumns = (categories ?? []).map((c) => ({
    code: c.code as string,
    header: table.headers.find((h) => norm(h) === norm(c.code) || norm(h) === norm(c.name)),
  })).filter((c): c is { code: string; header: string } => Boolean(c.header));

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
  if (!h.first || !h.last) go(back, "error", "The file needs player first and last name columns.");
  if (ratingColumns.length === 0) go(back, "error", "No rating columns found. Use skill names (Hitting, Throwing, Grounders, Fly Balls, Running / Awareness, ...) or codes (hitting, fly_balls, ...).");
  if (!h.season && !defaultSeason) go(back, "error", "The file has no Season column. Type the season the ratings are from (for example Spring 2026).");

  const rows = table.rows.map((r) => {
    const ratings: Record<string, number | string> = {};
    for (const c of ratingColumns) {
      const v = r[c.header];
      if (v === "" || v === undefined) continue;
      // Send non-numbers as text so the database rejects the row with a clear message.
      ratings[c.code] = /^\d+$/.test(v) ? Number(v) : v;
    }
    return {
      player_id: h.playerId ? r[h.playerId] : "",
      first_name: r[h.first!],
      last_name: r[h.last!],
      birth_date: h.birth ? isoDateOrNull(r[h.birth]) : null,
      season: (h.season ? r[h.season] : "") || defaultSeason,
      division: h.division ? r[h.division] : "",
      team: h.team ? r[h.team] : "",
      coach_name: h.coach ? r[h.coach] : "",
      ratings,
      source: r,
    };
  });

  const { data, error } = await supabase.rpc("stage_prior_year_import", { p_season_id: seasonId, p_file_name: name ?? "prior-year.csv", p_rows: rows });
  if (error) go(back, "error", error.message);
  go(`/protected/prior-year/${data}`, "message", `Read ${rows.length} rows. Check the matches, then import.`);
}

export async function recheckPriorYear(formData: FormData) {
  const batchId = id(formData.get("batchId"));
  const back = `/protected/prior-year/${batchId}`;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recheck_prior_year_import", { p_batch_id: batchId });
  if (error) go(back, "error", error.message);
  go(back, "message", data ? `${data} held row(s) now have a match.` : "No held rows match a player yet.");
}

// Matched rows: checkbox "import" (row id), player is the single candidate (hidden "player_<row>").
// Review rows: radio "pick_<row>" with a player id, or "" to leave it.
export async function importPriorYear(formData: FormData) {
  const batchId = id(formData.get("batchId"));
  const back = `/protected/prior-year/${batchId}`;
  const selections: { row_id: number; player_id: number }[] = [];
  for (const rowId of formData.getAll("import").map((v) => id(v)).filter(Boolean)) {
    const playerId = id(formData.get(`player_${rowId}`));
    if (playerId) selections.push({ row_id: rowId, player_id: playerId });
  }
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("pick_")) continue;
    const rowId = id(key.slice(5));
    const playerId = id(value);
    if (rowId && playerId) selections.push({ row_id: rowId, player_id: playerId });
  }
  if (selections.length === 0) go(back, "error", "Nothing selected to import.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_prior_year_rows", { p_batch_id: batchId, p_selections: selections });
  if (error) go(back, "error", error.message);
  revalidatePath("/protected/draft-reports");
  go(back, "message", `${data} prior-year rating(s) imported.`);
}

export async function dismissPriorYear(formData: FormData) {
  const batchId = id(formData.get("batchId"));
  const back = `/protected/prior-year/${batchId}`;
  const rowIds = formData.getAll("dismiss").map((v) => id(v)).filter(Boolean);
  if (rowIds.length === 0) go(back, "error", "Tick the held rows to dismiss.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dismiss_prior_year_rows", {
    p_batch_id: batchId, p_row_ids: rowIds, p_reason: String(formData.get("reason") ?? ""),
  });
  if (error) go(back, "error", error.message);
  go(back, "message", `${data} row(s) dismissed.`);
}
