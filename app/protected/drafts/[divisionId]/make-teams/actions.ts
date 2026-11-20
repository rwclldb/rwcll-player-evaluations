"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Place the team maker's result: [{player_season_id, team_id}] for players not yet on a team.
export async function saveTeams(divisionId: number, assignments: { player_season_id: number; team_id: number }[], settings: Record<string, unknown>):
  Promise<{ ok: true; placed: number } | { ok: false; message: string }> {
  if (!Array.isArray(assignments) || assignments.length === 0 || assignments.length > 2000) return { ok: false, message: "Nothing to place." };
  const rows = assignments.map((a) => ({ player_season_id: Number(a.player_season_id), team_id: Number(a.team_id) }))
    .filter((a) => Number.isSafeInteger(a.player_season_id) && Number.isSafeInteger(a.team_id));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_place_players", { p_season_division_id: Number(divisionId), p_assignments: rows, p_settings: settings ?? {} });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/protected/team-rosters");
  return { ok: true, placed: Number(data) };
}
