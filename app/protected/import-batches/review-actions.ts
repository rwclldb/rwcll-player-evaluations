"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const decisions = new Set(["needs_review", "ready_for_match_review", "approved_new", "approved_match", "ignored"]);

export type ReviewRowResult = { ok: true } | { ok: false; message: string };

export async function saveImportRowReview(formData: FormData): Promise<ReviewRowResult> {
  const rowId = Number(formData.get("rowId"));
  const batchId = Number(formData.get("batchId"));
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const matchedRaw = String(formData.get("matchedPlayerId") ?? "").trim();
  const matchedPlayerId = matchedRaw ? Number(matchedRaw) : null;

  if (!Number.isSafeInteger(rowId) || rowId < 1 || !Number.isSafeInteger(batchId) || batchId < 1)
    return { ok: false, message: "Invalid import row or batch." };
  if (!decisions.has(decision)) return { ok: false, message: "Choose a supported review decision." };
  if (reason.length < 5 || reason.length > 1000) return { ok: false, message: "Enter a reason between 5 and 1,000 characters." };
  if (decision === "approved_match") {
    if (!Number.isSafeInteger(matchedPlayerId) || (matchedPlayerId ?? 0) < 1)
      return { ok: false, message: "Choose an existing player for an approved match." };
  } else if (matchedPlayerId !== null) {
    return { ok: false, message: "An existing player can only be selected for an approved match." };
  }

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims) return { ok: false, message: "Sign in before reviewing staged rows." };
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
  if (roleError || isAdmin !== true) return { ok: false, message: "Administrator access is required." };

  // Confirm the row belongs to the requested batch; the database RPC remains the write boundary.
  const { data: row, error: rowError } = await supabase.from("sports_connect_import_rows")
    .select("id, import_batch_id, review_state").eq("id", rowId).maybeSingle();
  if (rowError || !row || Number(row.import_batch_id) !== batchId)
    return { ok: false, message: "This row was not found in the selected batch." };
  if (row.review_state === "committed") return { ok: false, message: "Committed rows cannot be changed." };

  const { error } = await supabase.rpc("review_sports_connect_import_row", {
    p_row_id: rowId, p_decision: decision, p_matched_player_id: matchedPlayerId, p_reason: reason,
  });
  if (error) return { ok: false, message: error.message || "Could not save review decision." };
  revalidatePath(`/protected/import-batches/${batchId}`);
  revalidatePath(`/protected/import-batches/${batchId}/review`);
  return { ok: true };
}


export type CommitImportRowResult =
  | { ok: true; playerSeasonId: string; alreadyCommitted: boolean }
  | { ok: false; message: string };

export async function commitImportRow(formData: FormData): Promise<CommitImportRowResult> {
  const rowId = Number(formData.get("rowId"));
  const batchId = Number(formData.get("batchId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (
    !Number.isSafeInteger(rowId) || rowId < 1 ||
    !Number.isSafeInteger(batchId) || batchId < 1
  ) {
    return { ok: false, message: "Invalid import row or batch." };
  }

  if (reason.length < 5 || reason.length > 1000) {
    return {
      ok: false,
      message: "Enter a commit reason between 5 and 1,000 characters.",
    };
  }

  const supabase = await createClient();

  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims) {
    return { ok: false, message: "Sign in before committing a staged row." };
  }

  const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
  if (roleError || isAdmin !== true) {
    return { ok: false, message: "Administrator access is required." };
  }

  const { data: row, error: rowError } = await supabase
    .from("sports_connect_import_rows")
    .select("id, import_batch_id, review_state, committed_player_season_id")
    .eq("id", rowId)
    .maybeSingle();

  if (rowError || !row || Number(row.import_batch_id) !== batchId) {
    return { ok: false, message: "This row was not found in the selected batch." };
  }

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .select("id, import_type")
    .eq("id", batchId)
    .maybeSingle();

  if (batchError || !batch || batch.import_type !== "players") {
    return { ok: false, message: "This is not an available player import batch." };
  }

  const alreadyCommitted = row.review_state === "committed";

  if (
    !alreadyCommitted &&
    row.review_state !== "approved_new" &&
    row.review_state !== "approved_match"
  ) {
    return {
      ok: false,
      message: "Approve this row as new or as a verified match before committing.",
    };
  }

  // The database function performs the authoritative validation and writes.
  // It also safely returns the existing registration ID for a committed row.
  const { data, error } = await supabase.rpc("commit_sports_connect_import_row", {
    p_row_id: rowId,
    p_reason: reason,
  });

  if (error) {
    return {
      ok: false,
      message: error.message || "Could not commit the staged row.",
    };
  }

  if (data == null) {
    return { ok: false, message: "The database returned no registration ID." };
  }

  revalidatePath(`/protected/import-batches/${batchId}`);
  revalidatePath(`/protected/import-batches/${batchId}/review`);
  revalidatePath("/protected/import-batches");

  return {
    ok: true,
    playerSeasonId: String(data),
    alreadyCommitted,
  };
}
