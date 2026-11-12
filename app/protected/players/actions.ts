"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { COLUMN_ALIASES, findHeader, isoDateOrNull, readUploadedCsv } from "@/lib/csv-upload";

const id = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
const optionalInt = (v: FormDataEntryValue | null): number | null | "bad" => {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  return /^\d+$/.test(s) ? Number(s) : "bad";
};
const go = (path: string, kind: "message" | "error", text: string): never =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`);

// ---------- edit one registration ----------
export async function saveRegistration(formData: FormData) {
  const psId = id(formData.get("playerSeasonId"));
  const back = `/protected/players/${psId}`;
  if (!psId) go("/protected/players", "error", "Player not found.");

  const age = optionalInt(formData.get("leagueAge"));
  const bib = optionalInt(formData.get("bib"));
  if (age === "bad") go(back, "error", "League age must be a whole number.");
  if (bib === "bad") go(back, "error", "Bib must be a whole number.");
  const dobRaw = String(formData.get("birthDate") ?? "").trim();
  const dob = dobRaw ? isoDateOrNull(dobRaw) : null;
  if (dobRaw && !dob) go(back, "error", "Birthdate must be a real date (MM/DD/YYYY or YYYY-MM-DD).");

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_registration", {
    p_player_season_id: psId,
    p_first_name: String(formData.get("firstName") ?? ""),
    p_last_name: String(formData.get("lastName") ?? ""),
    p_date_of_birth: dob,
    p_league_age: age,
    p_evaluation_number: bib,
    p_reason: String(formData.get("reason") ?? ""),
  });
  if (error) go(back, "error", error.message);
  revalidatePath("/protected/players");
  go(back, "message", "Saved.");
}

// ---------- add a player on site ----------
export async function addOnSitePlayer(formData: FormData) {
  const seasonId = id(formData.get("seasonId"));
  const back = `/protected/players/new?first=${encodeURIComponent(String(formData.get("firstName") ?? ""))}&last=${encodeURIComponent(String(formData.get("lastName") ?? ""))}`;
  const age = optionalInt(formData.get("leagueAge"));
  const bib = optionalInt(formData.get("bib"));
  if (age === "bad" || age === null) go(back, "error", "Choose the age group.");
  if (bib === "bad") go(back, "error", "Bib must be a whole number.");
  const dobRaw = String(formData.get("birthDate") ?? "").trim();
  const dob = dobRaw ? isoDateOrNull(dobRaw) : null;
  if (dobRaw && !dob) go(back, "error", "Birthdate must be a real date (MM/DD/YYYY or YYYY-MM-DD).");
  const existing = String(formData.get("existingPlayerId") ?? "new");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_add_onsite_registration", {
    p_season_id: seasonId,
    p_player_id: existing === "new" ? null : id(existing) || null,
    p_first_name: String(formData.get("firstName") ?? ""),
    p_last_name: String(formData.get("lastName") ?? ""),
    p_date_of_birth: dob,
    p_league_age: age,
    p_evaluation_number: bib,
    p_reason: String(formData.get("reason") ?? ""),
  });
  if (error) go(back, "error", error.message);
  revalidatePath("/protected/players");
  go(`/protected/players/${data}`, "message", "Player added on site. Link them to Sports Connect later by approving the match during registration import review.");
}

// ---------- bib upload ----------
export async function stageBibUpload(formData: FormData) {
  const back = "/protected/players/bibs";
  const seasonId = id(formData.get("seasonId"));
  const { table, name, error: fileError } = await readUploadedCsv(formData);
  if (!table) return go(back, "error", fileError ?? "Could not read the file.");

  const h = {
    playerId: findHeader(table.headers, COLUMN_ALIASES.playerId),
    first: findHeader(table.headers, COLUMN_ALIASES.firstName),
    last: findHeader(table.headers, COLUMN_ALIASES.lastName),
    birth: findHeader(table.headers, COLUMN_ALIASES.birthDate),
    bib: findHeader(table.headers, COLUMN_ALIASES.bib),
  };
  if (!h.bib) go(back, "error", "The file needs a bib column (\"Evaluation Number\", \"Bib\" or \"Registration Number\").");
  if (!h.playerId && !(h.first && h.last && h.birth)) {
    go(back, "error", "The file needs a \"Player Id\" column, or first name, last name, and birthdate columns.");
  }
  const rows = table.rows.map((r) => ({
    player_id: h.playerId ? r[h.playerId] : "",
    first_name: h.first ? r[h.first] : "",
    last_name: h.last ? r[h.last] : "",
    birth_date: h.birth ? isoDateOrNull(r[h.birth]) : null,
    bib: r[h.bib!],
    source: r,
  }));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stage_bib_import", { p_season_id: seasonId, p_file_name: name ?? "bibs.csv", p_rows: rows });
  if (error) go(back, "error", error.message);
  go(`/protected/players/bibs/${data}`, "message", `Read ${rows.length} rows. Review the changes, then apply.`);
}

export async function recheckBibUpload(formData: FormData) {
  const batchId = id(formData.get("batchId"));
  const back = `/protected/players/bibs/${batchId}`;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recheck_bib_import", { p_batch_id: batchId });
  if (error) go(back, "error", error.message);
  go(back, "message", data ? `${data} held row(s) now match a player.` : "No held rows match a player yet.");
}

export async function applyBibUpload(formData: FormData) {
  const batchId = id(formData.get("batchId"));
  const back = `/protected/players/bibs/${batchId}`;
  const accept = formData.getAll("acceptChange").map((v) => id(v)).filter(Boolean);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_bib_import", { p_batch_id: batchId, p_accept_change_row_ids: accept });
  if (error) go(back, "error", error.message);
  revalidatePath("/protected/players");
  go(back, "message", `${data} bib(s) set.`);
}
