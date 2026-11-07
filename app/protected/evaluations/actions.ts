
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

function returnToSession(
  sessionId: number,
  parameter: "message" | "error",
  value: string,
): never {
  redirect(
    `/protected/evaluations?sessionId=${sessionId}&${parameter}=${encodeURIComponent(value)}`,
  );
}

export async function saveEvaluationDraft(formData: FormData) {
  const sessionId = readPositiveId(formData.get("sessionId"));
  const playerSeasonId = readPositiveId(formData.get("playerSeasonId"));

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
      returnToSession(sessionId, "error", "Ratings must be between 1 and 5.");
    }

    ratings[code] = score;
  }

  const experienceAnswers: Record<string, string> = {};

  for (const code of EXPERIENCE_CODES) {
    const answer = String(formData.get(`experience_${code}`) ?? "unknown");

    if (!["yes", "no", "unknown"].includes(answer)) {
      returnToSession(sessionId, "error", "Invalid experience answer.");
    }

    experienceAnswers[code] = answer;
  }

  const { error } = await supabase.rpc("save_evaluation_draft", {
    p_session_id: sessionId,
    p_player_season_id: playerSeasonId,
    p_ratings: ratings,
    p_experience_answers: experienceAnswers,
  });

  if (error) {
    returnToSession(
      sessionId,
      "error",
      `Could not save draft: ${error.message}`,
    );
  }

  revalidatePath("/protected/evaluations");

  returnToSession(sessionId, "message", "Evaluation draft saved.");
}
