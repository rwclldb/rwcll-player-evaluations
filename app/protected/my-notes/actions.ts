"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function readPositiveId(value: FormDataEntryValue | null): number {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

// Only return to pages inside the app.
function back(returnTo: string, parameter: "message" | "error", value: string): never {
  const path = returnTo.startsWith("/protected/") ? returnTo : "/protected/my-notes";
  const join = path.includes("?") ? "&" : "?";
  redirect(`${path}${join}${parameter}=${encodeURIComponent(value)}`);
}

// Save one note from My Notes or the draft report. Blank text deletes the note.
// The database decides who may write which kind (coach private / independent-evaluator shared).
export async function saveNote(formData: FormData) {
  const kind = String(formData.get("kind") ?? "");
  const playerSeasonId = readPositiveId(formData.get("playerSeasonId"));
  const sessionId = readPositiveId(formData.get("sessionId"));
  const note = String(formData.get("note") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/protected/my-notes");

  if (!playerSeasonId || (kind !== "private" && kind !== "shared") || (kind === "shared" && !sessionId)) {
    back(returnTo, "error", "That note could not be identified.");
  }

  const supabase = await createClient();
  const { error } = kind === "private"
    ? await supabase.rpc("save_private_note", { p_player_season_id: playerSeasonId, p_note_text: note })
    : await supabase.rpc("save_shared_note", { p_session_id: sessionId, p_player_season_id: playerSeasonId, p_note_text: note });

  if (error) back(returnTo, "error", `Could not save the note: ${error.message}`);

  revalidatePath("/protected/my-notes");
  revalidatePath("/protected/draft-reports");
  revalidatePath("/protected/evaluations");
  back(returnTo, "message", note.trim() ? "Note saved." : "Note deleted.");
}
