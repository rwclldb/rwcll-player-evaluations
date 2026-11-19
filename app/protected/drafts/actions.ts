"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const id = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
const intOrNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return /^\d+$/.test(s) ? Number(s) : null;
};
const setupPage = (formData: FormData) => `/protected/drafts/${id(formData.get("divisionId"))}`;
const back = (path: string, kind: "message" | "error", text: string, anchor = ""): never =>
  redirect(`${path}?${kind}=${encodeURIComponent(text)}${anchor ? `#${anchor}` : ""}`);

async function rpc(name: string, args: Record<string, unknown>, path: string, ok: string, anchor = "") {
  const supabase = await createClient();
  const { error } = await supabase.rpc(name, args);
  if (error) back(path, "error", error.message, anchor);
  revalidatePath("/protected/drafts");
  back(path, "message", ok, anchor);
}

export async function createDraft(formData: FormData) {
  const divisionId = id(formData.get("divisionId"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_draft", { p_season_division_id: divisionId });
  const from = String(formData.get("from") ?? "");
  if (error) back(from === "list" ? "/protected/drafts" : `/protected/drafts/${divisionId}`, "error", error.message);
  revalidatePath("/protected/drafts");
  back(`/protected/drafts/${divisionId}`, "message", "Draft set up. Check the rules below.");
}

export async function deleteDraft(formData: FormData) {
  await rpc("admin_delete_draft", { p_draft_id: id(formData.get("draftId")) }, setupPage(formData), "Draft setup removed.");
}

export async function saveSettings(formData: FormData) {
  const rounds = String(formData.get("coachKidRounds") ?? "").split(/[^\d]+/).filter(Boolean).map(Number);
  const timer = String(formData.get("pickTimer") ?? "");
  const settings = {
    pool_by_age_only: formData.get("poolByAgeOnly") === "on",
    must_draft_ages: formData.getAll("mustDraftAge").map(Number).filter((n) => Number.isInteger(n)),
    roster_size: intOrNull(formData.get("rosterSize")) ?? 12,
    order_type: String(formData.get("orderType") ?? "snake"),
    age_order: String(formData.get("ageOrder") ?? "open"),
    coach_kid_rule: String(formData.get("coachKidRule") ?? "fixed_rounds"),
    coach_kid_rounds: rounds.length ? rounds : [1],
    coach_kid_by_round: intOrNull(formData.get("coachKidByRound")) ?? 2,
    siblings_together: formData.get("siblingsTogether") === "on",
    sibling_optional: String(formData.get("siblingOptional") ?? "ask"),
    pick_timer_seconds: timer === "" ? null : Number(timer),
  };
  const path = setupPage(formData);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_save_draft_settings", { p_draft_id: id(formData.get("draftId")), p_settings: settings });
  if (error) back(path, "error", error.message, "rules");
  revalidatePath("/protected/drafts");
  back(path, "message", data ? "Rules saved." : "No changes to save.", "rules");
}

export async function setRosterSize(formData: FormData) {
  await rpc("admin_set_draft_roster_size",
    { p_draft_id: id(formData.get("draftId")), p_team_id: id(formData.get("teamId")), p_size: intOrNull(formData.get("rosterSize")) },
    setupPage(formData), "Roster size saved.", "order");
}

export async function drawOrder(formData: FormData) {
  await rpc("admin_draw_draft_order", { p_draft_id: id(formData.get("draftId")) }, setupPage(formData), "Order drawn.", "order");
}

export async function setOrder(formData: FormData) {
  const teams = formData.getAll("position").map(id);
  await rpc("admin_set_draft_order", { p_draft_id: id(formData.get("draftId")), p_team_ids: teams }, setupPage(formData), "Order saved.", "order");
}

export async function setKidRound(formData: FormData) {
  const round = formData.get("clear") ? null : intOrNull(formData.get("round"));
  await rpc("admin_set_kid_round",
    { p_draft_id: id(formData.get("draftId")), p_player_season_id: id(formData.get("playerSeasonId")), p_round: round },
    setupPage(formData), round === null ? "Round set back to the default." : "Round saved.", "kids");
}

// In, out or clear (mode "") for this division's pool; or move to another division's pool.
export async function poolOverride(formData: FormData) {
  const divisionId = id(formData.get("divisionId"));
  const player = id(formData.get("playerSeasonId"));
  const note = String(formData.get("note") ?? "");
  const moveTo = id(formData.get("moveTo"));
  const path = setupPage(formData);
  if (moveTo) {
    await rpc("admin_move_pool", { p_player_season_id: player, p_from_season_division_id: divisionId, p_to_season_division_id: moveTo, p_note: note },
      path, "Moved to the other division's pool.", "pool");
  }
  const mode = String(formData.get("mode") ?? "");
  await rpc("admin_set_pool_override", { p_season_division_id: divisionId, p_player_season_id: player, p_mode: mode || null, p_note: note },
    path, mode === "in" ? "Added to the pool." : mode === "out" ? "Taken out of the pool." : "Override cleared.", "pool");
}
