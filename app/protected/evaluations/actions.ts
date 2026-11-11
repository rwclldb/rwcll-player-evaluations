
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const EXPERIENCE_CODES = [
  "pitched_before",
  "caught_before",
  "interested_in_pitching",
  "interested_in_catching",
] as const;

const RATING_CODES = [
  "hitting",
  "throwing",
  "grounders",
  "fly_balls",
  "running_awareness",
  "pitching_mechanics",
  "pitching_accuracy_control",
  "pitching_arm_strength",
  "catching_receiving",
  "catching_blocking",
  "catching_throwing",
] as const;

function readPositiveId(value: FormDataEntryValue | null): number {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

// Back to a player's scoring page (or the list when playerSeasonId is 0).
function returnToSession(
  sessionId: number,
  playerSeasonId: number,
  parameter: "message" | "error",
  value: string,
): never {
  const player = playerSeasonId ? `&player=${playerSeasonId}` : "";
  redirect(
    `/protected/evaluations?sessionId=${sessionId}${player}&${parameter}=${encodeURIComponent(value)}`,
  );
}

const INTENTS = {
  draft: "Draft saved. It does not count in reports until you choose Save.",
  submitted: "Saved. You can still change it until the session is locked.",
  not_evaluated: "Marked Not Evaluated. Any ratings for this player were cleared.",
} as const;
type Intent = keyof typeof INTENTS;

// One form, several buttons (button name="intent"): Save (submitted) / Save & Next / Not evaluated.
// "draft" is still accepted for older drafts, but the screen no longer offers it (decided 2026-11-11).
export async function saveEvaluation(formData: FormData) {
  const sessionId = readPositiveId(formData.get("sessionId"));
  const playerSeasonId = readPositiveId(formData.get("playerSeasonId"));
  const nextPlayerSeasonId = readPositiveId(formData.get("nextPlayerSeasonId"));
  const rawIntent = String(formData.get("intent") ?? "draft");
  const goNext = rawIntent === "submitted_next" && nextPlayerSeasonId > 0;
  const normalized = rawIntent === "submitted_next" ? "submitted" : rawIntent;
  const intent: Intent = normalized in INTENTS ? (normalized as Intent) : "draft";

  if (!sessionId || !playerSeasonId) {
    redirect("/protected/evaluations");
  }

  const supabase = await createClient();

  const { data: claims, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claims?.claims) {
    redirect("/auth/login");
  }

  const ratings: Record<string, number> = {};

  for (const code of RATING_CODES) {
    const rawValue = String(formData.get(`rating_${code}`) ?? "").trim();

    // An empty selection means that category is not scored.
    if (!rawValue) continue;

    const score = Number(rawValue);

    if (!Number.isInteger(score) || score < 1 || score > 5) {
      returnToSession(sessionId, playerSeasonId, "error", "Ratings must be between 1 and 5.");
    }

    ratings[code] = score;
  }

  const experienceAnswers: Record<string, string> = {};

  for (const code of EXPERIENCE_CODES) {
    const answer = String(formData.get(`experience_${code}`) ?? "unknown");

    if (!["yes", "no", "unknown"].includes(answer)) {
      returnToSession(sessionId, playerSeasonId, "error", "Invalid experience answer.");
    }

    experienceAnswers[code] = answer;
  }

  // Not Evaluated never carries ratings; the button label tells the evaluator they are cleared.
  const { error } = await supabase.rpc("save_evaluation", {
    p_session_id: sessionId,
    p_player_season_id: playerSeasonId,
    p_ratings: intent === "not_evaluated" ? {} : ratings,
    p_experience_answers: experienceAnswers,
    p_status: intent,
  });

  if (error) {
    returnToSession(sessionId, playerSeasonId, "error", `Could not save: ${error.message}`);
  }

  revalidatePath("/protected/evaluations");

  returnToSession(sessionId, goNext ? nextPlayerSeasonId : playerSeasonId, "message", goNext ? `${INTENTS[intent]} Showing the next player.` : INTENTS[intent]);
}
