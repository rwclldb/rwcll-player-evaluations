"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Check a player in at their age group's event, or undo it. The database checks who may do this.
export async function toggleCheckIn(playerSeasonId: number, eventId: number): Promise<{ checkedIn?: boolean; error?: string }> {
  if (!Number.isSafeInteger(playerSeasonId) || !Number.isSafeInteger(eventId)) return { error: "Unknown player or event." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("toggle_checkin", { p_player_season_id: playerSeasonId, p_event_id: eventId });
  if (error) return { error: error.message };
  revalidatePath("/protected/check-in");
  return { checkedIn: data === true };
}

export async function setBib(playerSeasonId: number, bib: string): Promise<{ error?: string }> {
  const n = Number(bib.trim());
  if (!/^\d{1,9}$/.test(bib.trim()) || n < 1) return { error: "A bib is a whole number." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_registration_bib", { p_player_season_id: playerSeasonId, p_bib: n });
  if (error) return { error: error.message };
  revalidatePath("/protected/check-in");
  revalidatePath("/protected/roster");
  return {};
}
