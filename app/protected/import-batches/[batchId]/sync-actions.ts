"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const back = (batchId: number, kind: "syncMessage" | "syncError", text: string): never =>
  redirect(`/protected/import-batches/${batchId}?${kind}=${encodeURIComponent(text)}#registered`);

function batchOf(formData: FormData) {
  const batchId = Number(formData.get("batchId"));
  if (!Number.isSafeInteger(batchId) || batchId < 1) redirect("/protected/import-batches");
  return batchId;
}

// Apply every ticked change ("rowId:field"). Rows with no ticks are left waiting.
export async function applyTickedChanges(formData: FormData) {
  const batchId = batchOf(formData);
  const reason = String(formData.get("reason") ?? "").trim();
  const byRow = new Map<number, string[]>();
  for (const value of formData.getAll("change")) {
    const [row, field] = String(value).split(":");
    const rowId = Number(row);
    if (!Number.isSafeInteger(rowId) || !field) continue;
    byRow.set(rowId, [...(byRow.get(rowId) ?? []), field]);
  }
  if (byRow.size === 0) back(batchId, "syncError", "Tick at least one change to apply.");
  const supabase = await createClient();
  let applied = 0;
  for (const [rowId, fields] of byRow) {
    const { data, error } = await supabase.rpc("apply_import_row_changes", { p_row_id: rowId, p_fields: fields, p_reason: reason });
    if (error) {
      revalidatePath(`/protected/import-batches/${batchId}`);
      back(batchId, "syncError", `${applied ? `${applied} change(s) applied, then: ` : ""}${error.message}`);
    }
    applied += Number(data ?? 0);
  }
  revalidatePath(`/protected/import-batches/${batchId}`);
  revalidatePath("/protected/players");
  back(batchId, "syncMessage", `${applied} change(s) applied for ${byRow.size} player(s). Unticked changes on those players keep the app's values.`);
}

// Keep the app's values for one player (the row id is bound by the button).
export async function keepAppValues(rowId: number, formData: FormData) {
  const batchId = batchOf(formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_import_row_changes", {
    p_row_id: rowId, p_fields: [], p_reason: String(formData.get("reason") ?? "").trim(),
  });
  if (error) back(batchId, "syncError", error.message);
  revalidatePath(`/protected/import-batches/${batchId}`);
  back(batchId, "syncMessage", "Kept the app's values for that player.");
}
