"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TeamRow } from "@/lib/teams-csv";

const id = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
const uuid = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return /^[0-9a-f-]{36}$/i.test(s) ? s : null;
};
const go = (path: string, kind: "message" | "error", text: string): never =>
  redirect(`${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(text)}`);
const teamsPage = (formData: FormData) => {
  const season = id(formData.get("seasonId"));
  const anchor = String(formData.get("anchor") ?? "").replace(/[^a-z0-9-]/gi, "");
  return { path: `/protected/teams?season=${season}`, anchor: anchor ? `#${anchor}` : "" };
};

// ---------- teams ----------
export async function addTeam(formData: FormData) {
  const { path, anchor } = teamsPage(formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_team", {
    p_team_id: null, p_season_division_id: id(formData.get("seasonDivisionId")), p_name: String(formData.get("name") ?? ""),
  });
  if (error) go(path, "error", error.message);
  revalidatePath("/protected/teams");
  redirect(`${path}&message=${encodeURIComponent("Team added.")}${anchor}`);
}

// Rename (when the name changed) and set the whole staff in one save.
export async function saveTeam(formData: FormData) {
  const { path } = teamsPage(formData);
  const teamId = id(formData.get("teamId"));
  const anchor = `#team-${teamId}`;
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  if (name && name !== String(formData.get("oldName") ?? "")) {
    const { error } = await supabase.rpc("admin_save_team", { p_team_id: teamId, p_season_division_id: null, p_name: name });
    if (error) go(path, "error", error.message);
  }
  const keep = formData.getAll("assistant").map(uuid).filter((x): x is string => !!x);
  const added = uuid(formData.get("addAssistant"));
  const assistants = [...new Set(added ? [...keep, added] : keep)];
  const { error } = await supabase.rpc("admin_set_team_staff", {
    p_team_id: teamId, p_manager: uuid(formData.get("manager")), p_coach: uuid(formData.get("coach")), p_assistants: assistants,
  });
  if (error) go(path, "error", error.message);
  revalidatePath("/protected/teams");
  redirect(`${path}&message=${encodeURIComponent(`Saved ${name || "the team"}.`)}${anchor}`);
}

export async function deleteTeam(formData: FormData) {
  const { path } = teamsPage(formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_team", { p_team_id: id(formData.get("teamId")) });
  if (error) go(path, "error", error.message);
  revalidatePath("/protected/teams");
  go(path, "message", "Team deleted.");
}

export type TeamImportResult = { line: number; division: string; team: string; status: "new" | "changed" | "same" | "error"; message: string };

// Teams CSV: apply = false is a preview (the database runs the same steps and rolls them back).
export async function importTeams(input: { seasonId: number; rows: TeamRow[]; apply: boolean }): Promise<{ ok: true; results: TeamImportResult[] } | { ok: false; message: string }> {
  if (!input || !Number.isSafeInteger(input.seasonId) || !Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 500) {
    return { ok: false, message: "Choose a season and a file with 1 to 500 teams." };
  }
  const rows = input.rows.map((r) => ({
    line: Number(r.line), division: String(r.division ?? "").slice(0, 100), team: String(r.team ?? "").slice(0, 100),
    manager: String(r.manager ?? "").slice(0, 320), coach: String(r.coach ?? "").slice(0, 320),
    assistants: (Array.isArray(r.assistants) ? r.assistants : []).slice(0, 20).map((a) => String(a).slice(0, 320)),
  }));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_import_teams", { p_season_id: input.seasonId, p_rows: rows, p_apply: input.apply === true });
  if (error) return { ok: false, message: error.message };
  if (input.apply) revalidatePath("/protected/teams");
  return { ok: true, results: (data ?? []) as TeamImportResult[] };
}

// ---------- coach's kids and siblings ----------
const familiesPage = (formData: FormData) => `/protected/teams/families?season=${id(formData.get("seasonId"))}`;

export async function linkCoachKid(formData: FormData) {
  const back = familiesPage(formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_link_coach_kid", {
    p_player_season_id: id(formData.get("playerSeasonId")), p_parent_user_id: uuid(formData.get("parentUserId")),
  });
  if (error) go(back, "error", error.message);
  revalidatePath("/protected/teams");
  go(back, "message", "Linked to their parent.");
}

export async function unlinkCoachKid(formData: FormData) {
  const back = familiesPage(formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_unlink_coach_kid", {
    p_player_season_id: id(formData.get("playerSeasonId")), p_parent_user_id: uuid(formData.get("parentUserId")),
  });
  if (error) go(back, "error", error.message);
  revalidatePath("/protected/teams");
  go(back, "message", "Link removed. The \"Coach's kid\" label stays until you change it on the player's page.");
}

export async function groupSiblings(formData: FormData) {
  const back = familiesPage(formData);
  const ids = [...new Set(formData.getAll("playerSeasonId").map(id).filter(Boolean))];
  if (ids.length < 2) go(back, "error", "Choose at least two players.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_group_siblings", { p_player_season_ids: ids });
  if (error) go(back, "error", error.message);
  revalidatePath("/protected/teams");
  go(back, "message", "Siblings grouped.");
}

export async function removeSibling(formData: FormData) {
  const back = familiesPage(formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_remove_sibling", { p_player_season_id: id(formData.get("playerSeasonId")) });
  if (error) go(back, "error", error.message);
  revalidatePath("/protected/teams");
  go(back, "message", "Removed from the sibling group.");
}

export type FamilySuggestionChoice = { kind: "siblings" | "coach_kid"; key: string; playerSeasonIds: number[]; parentUserId: string | null; label: string };
export type FamilySuggestionResult = { ok: true; done: number; failed: { key: string; label: string; message: string }[] } | { ok: false; message: string };

// Accept or dismiss many suggestions at once (the checkboxes on Coach's kids and siblings). Each one goes through the same
// audited function as the single buttons; one that's refused doesn't stop the rest, and comes back with the reason.
export async function applyFamilySuggestions(input: { seasonId: number; action: "accept" | "dismiss"; items: FamilySuggestionChoice[] }): Promise<FamilySuggestionResult> {
  if (!input || !Number.isSafeInteger(input.seasonId) || input.seasonId <= 0 || !["accept", "dismiss"].includes(input.action)
    || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 500) {
    return { ok: false, message: "Choose at least one suggestion." };
  }
  const supabase = await createClient();
  let done = 0;
  const failed: { key: string; label: string; message: string }[] = [];
  for (const raw of input.items) {
    const kind = raw?.kind === "coach_kid" ? "coach_kid" : raw?.kind === "siblings" ? "siblings" : null;
    const key = String(raw?.key ?? "").slice(0, 200);
    const label = String(raw?.label ?? "").slice(0, 200);
    const ids = [...new Set((Array.isArray(raw?.playerSeasonIds) ? raw.playerSeasonIds : []).map((v) => id(String(v))).filter(Boolean))];
    if (!kind || !key) { failed.push({ key, label, message: "Not a suggestion." }); continue; }
    let error: { message: string } | null = null;
    if (input.action === "dismiss") {
      ({ error } = await supabase.rpc("admin_dismiss_family_suggestion", { p_season_id: input.seasonId, p_kind: kind, p_key: key }));
    } else if (kind === "siblings") {
      if (ids.length < 2) { failed.push({ key, label, message: "Needs at least two players." }); continue; }
      ({ error } = await supabase.rpc("admin_group_siblings", { p_player_season_ids: ids }));
    } else {
      const parent = uuid(raw?.parentUserId ?? null);
      if (!ids[0] || !parent) { failed.push({ key, label, message: "Missing the player or the parent." }); continue; }
      ({ error } = await supabase.rpc("admin_link_coach_kid", { p_player_season_id: ids[0], p_parent_user_id: parent }));
    }
    if (error) failed.push({ key, label, message: error.message });
    else done++;
  }
  revalidatePath("/protected/teams");
  return { ok: true, done, failed };
}

export async function dismissSuggestion(formData: FormData) {
  const back = familiesPage(formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_dismiss_family_suggestion", {
    p_season_id: id(formData.get("seasonId")), p_kind: String(formData.get("kind") ?? ""), p_key: String(formData.get("key") ?? ""),
  });
  if (error) go(back, "error", error.message);
  revalidatePath("/protected/teams");
  go(back, "message", "Suggestion dismissed.");
}
