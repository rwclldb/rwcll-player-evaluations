"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { modeLabel, TEST_DATE_MODES, testToolsEnabled } from "@/lib/test-tools";

function back(seasonId: string, key: "message" | "error", text: string): never {
  redirect(`/protected/test-dates?season=${encodeURIComponent(seasonId)}&${key}=${encodeURIComponent(text)}`);
}

export async function setTestDates(formData: FormData) {
  const seasonId = String(formData.get("seasonId") ?? "");
  const mode = String(formData.get("mode") ?? "");
  if (!testToolsEnabled()) redirect("/protected");
  if (!TEST_DATE_MODES.some((m) => m.mode === mode)) back(seasonId, "error", "Unknown test date.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_test_set_dates", { p_season_id: Number(seasonId), p_mode: mode });
  if (error) back(seasonId, "error", error.message);
  revalidatePath("/protected", "layout");
  const days = Number(data);
  back(seasonId, "message", `Dates moved: ${modeLabel(mode)} (${days === 0 ? "no change from the real dates" : `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ${days > 0 ? "later" : "earlier"} than the real dates`}).`);
}

export async function restoreTestDates(formData: FormData) {
  const seasonId = String(formData.get("seasonId") ?? "");
  if (!testToolsEnabled()) redirect("/protected");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_test_restore_dates", { p_season_id: Number(seasonId) });
  if (error) back(seasonId, "error", error.message);
  revalidatePath("/protected", "layout");
  back(seasonId, "message", "The real dates are back.");
}
