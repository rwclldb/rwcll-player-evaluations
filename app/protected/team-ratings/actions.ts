"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SaveRatingResult =
  | { ok: true; status: "rated" | "not_rated"; ratings: Record<string, number>; savedAt: string }
  | { ok: false; message: string };

/** A manager's (or an admin's) end-of-season rating of one player. Returns a result; the sheet keeps its own state. */
export async function saveTeamRating(teamId: number, playerSeasonId: number, ratings: Record<string, number | null>, notRated: boolean): Promise<SaveRatingResult> {
  const clean: Record<string, number> = {};
  for (const [code, value] of Object.entries(ratings ?? {})) {
    if (value === null || value === undefined) continue;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 5 || !/^[a-z_]{1,40}$/.test(code)) return { ok: false, message: "Scores are whole numbers from 1 to 5." };
    clean[code] = n;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_team_rating", {
    p_team_id: Number(teamId), p_player_season_id: Number(playerSeasonId), p_ratings: notRated ? {} : clean, p_not_rated: Boolean(notRated),
  });
  if (error) return { ok: false, message: error.message };
  const r = data as { status: "rated" | "not_rated"; saved_at: string; ratings: Record<string, number> };
  return { ok: true, status: r.status, ratings: r.ratings ?? {}, savedAt: r.saved_at };
}

function back(seasonId: string, key: "message" | "error", text: string): never {
  redirect(`/protected/team-ratings?season=${encodeURIComponent(seasonId)}&${key}=${encodeURIComponent(text)}`);
}

export async function openTeamRatings(formData: FormData) {
  const seasonId = String(formData.get("seasonId") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_open_team_ratings", { p_season_id: Number(seasonId) });
  if (error) back(seasonId, "error", error.message);
  revalidatePath("/protected/team-ratings");
  back(seasonId, "message", "End-of-season ratings are open. Each team's manager now sees Rate your players on their home page.");
}

export async function closeTeamRatings(formData: FormData) {
  const seasonId = String(formData.get("seasonId") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_close_team_ratings", { p_season_id: Number(seasonId) });
  if (error) back(seasonId, "error", error.message);
  revalidatePath("/protected/team-ratings");
  back(seasonId, "message", "End-of-season ratings are closed. Managers can still look at what they saved; you can open them again.");
}
