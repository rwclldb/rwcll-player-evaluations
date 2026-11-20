"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ChartEntry } from "@/lib/age-chart";

export async function saveAgeChart(seasonId: number, entries: ChartEntry[], fileName: string): Promise<{ ok: true; rows: number } | { ok: false; message: string }> {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 600) return { ok: false, message: "The chart has no rows." };
  const rows = entries.map((e) => ({ birth_year: Number(e.birth_year), birth_month: Number(e.birth_month), league_age: Number(e.league_age) }));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_save_age_chart", { p_season_id: Number(seasonId), p_rows: rows, p_file_name: String(fileName ?? "").slice(0, 200) });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/protected/age-chart");
  return { ok: true, rows: Number(data) };
}
