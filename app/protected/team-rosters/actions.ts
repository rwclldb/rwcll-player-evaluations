"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SeasonRosters } from "@/lib/team-rosters";

type Result = { ok: true; data: SeasonRosters } | { ok: false; message: string };
const num = (n: unknown) => (Number.isSafeInteger(Number(n)) && Number(n) > 0 ? Number(n) : 0);

async function fresh(seasonId: number, error: { message: string } | null): Promise<Result> {
  if (error) return { ok: false, message: error.message };
  revalidatePath("/protected/team-rosters");
  const supabase = await createClient();
  const { data, error: e2 } = await supabase.rpc("season_rosters", { p_season_id: num(seasonId) });
  return e2 ? { ok: false, message: e2.message } : { ok: true, data: data as SeasonRosters };
}

// Move to a team, or back to the pool (teamId null). Returns the updated rosters.
export async function movePlayer(seasonId: number, playerSeasonId: number, teamId: number | null, note: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_move_player", {
    p_player_season_id: num(playerSeasonId), p_to_team_id: teamId === null ? null : num(teamId), p_note: String(note ?? "").slice(0, 500),
  });
  return fresh(seasonId, error);
}

export async function releaseRosters(seasonId: number, seasonDivisionId: number, release: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_release_rosters", { p_season_division_id: num(seasonDivisionId), p_release: release === true });
  return fresh(seasonId, error);
}
