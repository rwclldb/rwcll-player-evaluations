"use server";

import { createClient } from "@/lib/supabase/server";

export type BirthdateKind = "registration" | "import_row" | "bib_row" | "prior_row";

// One birthdate, for admins and registrars. The database checks who may see it and logs every reveal.
export async function revealBirthdate(kind: BirthdateKind, id: number, context: string): Promise<{ value?: string | null; error?: string }> {
  if (!Number.isSafeInteger(id) || id < 1) return { error: "Unknown record." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reveal_birthdate", { p_kind: kind, p_id: id, p_context: context.slice(0, 200) });
  if (error) return { error: error.message };
  return { value: (data as string | null) ?? null };
}
