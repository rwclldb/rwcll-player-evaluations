
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createSeason(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const startDate = String(formData.get("start_date") ?? "");
  const endDate = String(formData.get("end_date") ?? "");

  if (!name) {
    throw new Error("Please enter a season name.");
  }

  if (startDate && endDate && startDate > endDate) {
    throw new Error("The end date must be on or after the start date.");
  }

  const supabase = await createClient();

  const { error } = await supabase.from("seasons").insert({
    name,
    start_date: startDate || null,
    end_date: endDate || null,
  });

  if (error) {
    throw new Error(`Could not create season: ${error.message}`);
  }

  revalidatePath("/");
}
