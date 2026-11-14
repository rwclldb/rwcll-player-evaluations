"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const go = (path: string, kind: "message" | "error", text: string): never =>
  redirect(`${path}?${kind}=${encodeURIComponent(text)}`);

async function changeStatus(formData: FormData, rpc: "admin_close_season" | "admin_reopen_season", done: string) {
  const seasonId = Number(formData.get("seasonId"));
  if (!Number.isSafeInteger(seasonId) || seasonId <= 0) go("/protected", "error", "Season not found.");
  const back = `/protected/seasons/${seasonId}`;
  const supabase = await createClient();
  const { error } = await supabase.rpc(rpc, {
    p_season_id: seasonId,
    p_reason: String(formData.get("reason") ?? ""),
    p_confirm_name: String(formData.get("confirmName") ?? ""),
  });
  if (error) go(back, "error", error.message);
  revalidatePath("/protected", "layout");
  go(back, "message", done);
}

export async function closeSeason(formData: FormData) {
  await changeStatus(formData, "admin_close_season", "The season is closed. Nothing in it can be changed until it is reopened.");
}

export async function reopenSeason(formData: FormData) {
  await changeStatus(formData, "admin_reopen_season", "The season is open again. Close it again when the fix is done.");
}
