"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const EXPERIENCE_CODES = ["pitched_before", "caught_before", "interested_in_pitching", "interested_in_catching"];

// Admin correction of one evaluation's scores (admin_save_evaluation_correction checks admin, reason, season).
export async function saveCorrection(formData: FormData) {
  const evaluationId = Number(formData.get("evaluationId"));
  if (!Number.isSafeInteger(evaluationId) || evaluationId < 1) redirect("/protected/evaluation-review");
  const back = (kind: "message" | "error", text: string): never =>
    redirect(`/protected/evaluation-review/${evaluationId}?${kind}=${encodeURIComponent(text)}`);

  const status = String(formData.get("status") ?? "");
  const notEvaluated = status === "not_evaluated";
  const supabase = await createClient();
  const { data: categories } = await supabase.from("rating_categories").select("code");

  const ratings: Record<string, number | null> = {};
  for (const { code } of categories ?? []) {
    const raw = String(formData.get(`rating_${code}`) ?? "").trim();
    if (notEvaluated || raw === "") { ratings[code] = null; continue; }
    const score = Number(raw);
    if (!Number.isInteger(score) || score < 1 || score > 5) back("error", "Scores must be whole numbers from 1 to 5.");
    ratings[code] = score;
  }
  const answers: Record<string, string> = {};
  for (const code of EXPERIENCE_CODES) {
    const answer = String(formData.get(`experience_${code}`) ?? "unknown");
    answers[code] = ["yes", "no", "unknown"].includes(answer) ? answer : "unknown";
  }

  const { data, error } = await supabase.rpc("admin_save_evaluation_correction", {
    p_evaluation_id: evaluationId,
    p_ratings: ratings,
    p_answers: answers,
    p_status: status,
    p_reason: String(formData.get("reason") ?? ""),
  });
  if (error) back("error", error.message);
  revalidatePath("/protected/evaluation-review");
  revalidatePath("/protected/draft-reports");
  back("message", data ? "Correction saved. The draft report uses the new scores." : "Nothing changed, so nothing was saved.");
}
