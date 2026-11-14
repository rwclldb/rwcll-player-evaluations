"use server";

import { createClient } from "@/lib/supabase/server";

// Star or unstar a player for the signed-in user. Returns the new state, or an error message.
export async function toggleStar(playerSeasonId: number): Promise<{ starred?: boolean; error?: string }> {
  if (!Number.isSafeInteger(playerSeasonId) || playerSeasonId < 1) return { error: "Unknown player." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("toggle_player_star", { p_player_season_id: playerSeasonId });
  if (error) return { error: error.message };
  return { starred: data === true };
}
