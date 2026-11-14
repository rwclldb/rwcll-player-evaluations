"use server";

import { createClient } from "@/lib/supabase/server";
import type { SavePayload } from "@/lib/offline-queue";

const EXPERIENCE_CODES = ["pitched_before", "caught_before", "interested_in_pitching", "interested_in_catching"] as const;

const RATING_CODES = [
  "hitting", "throwing", "grounders", "fly_balls", "running_awareness",
  "pitching_mechanics", "pitching_accuracy_control", "pitching_arm_strength",
  "catching_receiving", "catching_blocking", "catching_throwing",
] as const;

export type SaveResult =
  | { ok: true }
  /** retry: true when the save should stay on the phone and be sent again (for example after signing in again). */
  | { ok: false; error: string; retry: boolean };

const positive = (n: unknown) => (Number.isSafeInteger(n) && (n as number) > 0 ? (n as number) : 0);

// Saves one player's scores (and the notes box). Called by the scoring screen, and again later for saves
// that were kept on the phone while there was no signal. Returns a result instead of redirecting.
// Save stores status "submitted"; Not Evaluated clears ratings. ("draft" is no longer offered; decided 2026-11-11.)
export async function saveScores(input: SavePayload): Promise<SaveResult> {
  const sessionId = positive(input?.sessionId);
  const playerSeasonId = positive(input?.playerSeasonId);
  if (!sessionId || !playerSeasonId) return { ok: false, error: "Unknown player or age group.", retry: false };
  const intent = input.intent === "not_evaluated" ? "not_evaluated" : "submitted";

  const ratings: Record<string, number> = {};
  for (const code of RATING_CODES) {
    const score = input.ratings?.[code];
    if (score === undefined || score === null) continue;
    if (!Number.isInteger(score) || score < 1 || score > 5) return { ok: false, error: "Ratings must be between 1 and 5.", retry: false };
    ratings[code] = score;
  }
  const answers: Record<string, string> = {};
  for (const code of EXPERIENCE_CODES) {
    const answer = String(input.answers?.[code] ?? "unknown");
    if (!["yes", "no", "unknown"].includes(answer)) return { ok: false, error: "Invalid experience answer.", retry: false };
    answers[code] = answer;
  }

  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims) {
    return { ok: false, error: "Your sign-in has expired. Sign in again; your scores stay on this phone until then.", retry: true };
  }

  const { error } = await supabase.rpc("save_evaluation", {
    p_session_id: sessionId,
    p_player_season_id: playerSeasonId,
    p_ratings: intent === "not_evaluated" ? {} : ratings,
    p_experience_answers: answers,
    p_status: intent,
  });
  if (error) return { ok: false, error: `Could not save: ${error.message}`, retry: false };

  // The notes box: a coach's private note or an independent evaluator's shared note. The database checks the role.
  if (input.note !== null && input.note !== undefined && (input.noteKind === "private" || input.noteKind === "shared")) {
    const note = String(input.note).slice(0, 2000);
    const { error: noteError } = input.noteKind === "private"
      ? await supabase.rpc("save_private_note", { p_player_season_id: playerSeasonId, p_note_text: note })
      : await supabase.rpc("save_shared_note", { p_session_id: sessionId, p_player_season_id: playerSeasonId, p_note_text: note });
    if (noteError) return { ok: false, error: `Ratings saved, but the note was not: ${noteError.message}`, retry: false };
  }

  // No revalidatePath: it would make the scoring screen download the whole age group again after every save,
  // which is slow on weak signal. The screen keeps its own copy; other pages read fresh data when opened.
  return { ok: true };
}
