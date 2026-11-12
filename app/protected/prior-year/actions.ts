"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readUploadedCsv } from "@/lib/csv-upload";
import { parsePriorYear, type RatingCategory } from "@/lib/prior-year-csv";

const id = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
const go = (path: string, kind: "message" | "error", text: string): never =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`);

export async function stagePriorYearUpload(formData: FormData) {
  const back = "/protected/prior-year";
  const seasonId = id(formData.get("seasonId"));
  const defaultSeason = String(formData.get("seasonLabel") ?? "").trim();
  const { table, name, error: fileError } = await readUploadedCsv(formData);
  if (!table) return go(back, "error", fileError ?? "Could not read the file.");

  const supabase = await createClient();
  const { data: categories } = await supabase.from("rating_categories").select("code, name");
  const parsed = parsePriorYear(table, (categories ?? []) as RatingCategory[], defaultSeason);
  if ("error" in parsed) return go(back, "error", parsed.error);
  const { rows, unrated, ignoredColumns } = parsed;
  if (rows.length === 0) return go(back, "error", `None of the ${unrated} players in the file have ratings, so there is nothing to import.`);

  const { data, error } = await supabase.rpc("stage_prior_year_import", { p_season_id: seasonId, p_file_name: name ?? "prior-year.csv", p_rows: rows });
  if (error) go(back, "error", error.message);
  go(`/protected/prior-year/${data}`, "message",
    `Read ${rows.length} rated player${rows.length === 1 ? "" : "s"}` +
    (unrated ? `; skipped ${unrated} with no ratings` : "") +
    (ignoredColumns.length ? `; not used: ${ignoredColumns.join(", ")}` : "") +
    ". Check the matches, then import.");
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
