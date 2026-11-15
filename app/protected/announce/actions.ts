"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Mark a player called at their age group's event, or undo it. The database checks who may do this.
export async function toggleCall(playerSeasonId: number, eventId: number): Promise<{ called?: boolean; error?: string }> {
  if (!Number.isSafeInteger(playerSeasonId) || !Number.isSafeInteger(eventId)) return { error: "Unknown player or event." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("toggle_call", { p_player_season_id: playerSeasonId, p_event_id: eventId });
  if (error) return { error: error.message };
  revalidatePath("/protected/announce");
  return { called: data === true };
}
