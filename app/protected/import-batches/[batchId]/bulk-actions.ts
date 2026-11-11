"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const back = (batchId: number, kind: "bulkMessage" | "bulkError", text: string): never =>
  redirect(`/protected/import-batches/${batchId}?${kind}=${encodeURIComponent(text)}`);

async function run(formData: FormData, fn: "bulk_commit_clean_import_rows" | "bulk_ignore_out_of_scope_import_rows", done: (n: number) => string) {
  const batchId = Number(formData.get("batchId"));
  if (!Number.isSafeInteger(batchId) || batchId < 1) redirect("/protected/import-batches");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, { p_batch_id: batchId, p_reason: String(formData.get("reason") ?? "") });
  if (error) back(batchId, "bulkError", error.message);
  revalidatePath(`/protected/import-batches/${batchId}`);
  revalidatePath("/protected/players");
  back(batchId, "bulkMessage", done(Number(data)));
}

export async function bulkCommitClean(formData: FormData) {
  await run(formData, "bulk_commit_clean_import_rows", (n) => `${n} clean row(s) approved as new players and committed.`);
}

export async function bulkIgnoreOutOfScope(formData: FormData) {
  await run(formData, "bulk_ignore_out_of_scope_import_rows", (n) => `${n} out-of-scope row(s) ignored.`);
}
