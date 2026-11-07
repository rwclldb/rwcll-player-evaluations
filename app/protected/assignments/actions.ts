
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type EvaluatorType = "coach" | "independent_evaluator";

async function requireAdministrator() {
  const supabase = await createClient();

  const { data: claims, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claims?.claims) {
    redirect("/auth/login");
  }

  const { data: isAdmin, error } = await supabase.rpc("is_admin");

  if (error || isAdmin !== true) {
    redirect("/protected");
  }

  return {
    supabase,
    userId: String(claims.claims.sub),
  };
}

function finish(message: string): never {
  revalidatePath("/protected/assignments");
  revalidatePath("/protected");
  redirect(`/protected/assignments?message=${encodeURIComponent(message)}`);
}

function fail(message: string): never {
  redirect(`/protected/assignments?error=${encodeURIComponent(message)}`);
}

function readPositiveId(value: FormDataEntryValue | null): number {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function readEvaluatorType(value: FormDataEntryValue | null): EvaluatorType | null {
  return value === "coach" || value === "independent_evaluator"
    ? value
    : null;
}

export async function grantEvaluatorRole(formData: FormData) {
  const { supabase, userId } = await requireAdministrator();
  const seasonId = readPositiveId(formData.get("seasonId"));
  const evaluatorUserId = String(formData.get("evaluatorUserId") ?? "");
  const roleName = readEvaluatorType(formData.get("roleName"));

  if (!seasonId || !evaluatorUserId || !roleName) {
    fail("Choose a season, account, and valid evaluator role.");
  }

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, is_closed")
    .eq("id", seasonId)
    .maybeSingle();

  if (seasonError || !season) fail("Season not found.");
  if (season.is_closed) fail("Cannot grant roles for a closed season.");

  const { data: account, error: accountError } = await supabase
    .rpc("admin_list_evaluator_candidates");

  if (accountError) fail(accountError.message);

 type EvaluatorCandidate = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  email_confirmed: boolean;
};

const candidates = (account ?? []) as EvaluatorCandidate[];

if (!candidates.some(
  (candidate: EvaluatorCandidate) =>
    candidate.user_id === evaluatorUserId
)) {
  fail("The selected account could not be verified.");
}

  const { error: insertError } = await supabase
    .from("user_roles")
    .insert({
      user_id: evaluatorUserId,
      role_name: roleName,
      season_id: seasonId,
      created_by: userId,
    });

  if (insertError) {
    if (insertError.code === "23505") {
      fail("That evaluator role is already granted for this season.");
    }
    fail(insertError.message);
  }

  finish("Evaluator role granted.");
}

export async function revokeEvaluatorRole(formData: FormData) {
  const { supabase } = await requireAdministrator();
  const seasonId = readPositiveId(formData.get("seasonId"));
  const evaluatorUserId = String(formData.get("evaluatorUserId") ?? "");
  const roleName = readEvaluatorType(formData.get("roleName"));

  if (!seasonId || !evaluatorUserId || !roleName) {
    fail("Invalid evaluator role selection.");
  }

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, is_closed")
    .eq("id", seasonId)
    .maybeSingle();

  if (seasonError || !season) fail("Season not found.");
  if (season.is_closed) fail("Cannot change roles for a closed season.");

  const { data: assignments, error: assignmentError } = await supabase
    .from("evaluator_assignments")
    .select("id")
    .eq("evaluator_user_id", evaluatorUserId)
    .eq("evaluator_type", roleName)
    .in(
      "evaluation_session_id",
      (
        await supabase
          .from("evaluation_sessions")
          .select("id")
          .eq("season_id", seasonId)
      ).data?.map((session) => session.id) ?? [],
    );

  if (assignmentError) fail(assignmentError.message);

  if ((assignments ?? []).length > 0) {
    fail("Remove this evaluator's session assignments before revoking the role.");
  }

  const { error: deleteError } = await supabase
    .from("user_roles")
    .delete()
    .eq("user_id", evaluatorUserId)
    .eq("role_name", roleName)
    .eq("season_id", seasonId);

  if (deleteError) fail(deleteError.message);

  finish("Evaluator role revoked.");
}

export async function assignEvaluatorToSession(formData: FormData) {
  const { supabase, userId } = await requireAdministrator();
  const sessionId = readPositiveId(formData.get("sessionId"));
  const evaluatorUserId = String(formData.get("evaluatorUserId") ?? "");
  const evaluatorType = readEvaluatorType(formData.get("evaluatorType"));

  if (!sessionId || !evaluatorUserId || !evaluatorType) {
    fail("Choose a session, account, and evaluator type.");
  }

  const { data: session, error: sessionError } = await supabase
    .from("evaluation_sessions")
    .select("id, season_id, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError || !session) fail("Session not found.");
  if (session.status !== "setup") {
    fail("Assignments can only be changed while a session is in setup.");
  }

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("is_closed")
    .eq("id", session.season_id)
    .maybeSingle();

  if (seasonError || !season) fail("Season not found.");
  if (season.is_closed) fail("Cannot assign evaluators to a closed season.");

  const { data: role, error: roleError } = await supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", evaluatorUserId)
    .eq("season_id", session.season_id)
    .eq("role_name", evaluatorType)
    .maybeSingle();

  if (roleError) fail(roleError.message);
  if (!role) fail("The account does not have this evaluator role for the season.");

  const { error: insertError } = await supabase
    .from("evaluator_assignments")
    .insert({
      evaluation_session_id: sessionId,
      evaluator_user_id: evaluatorUserId,
      evaluator_type: evaluatorType,
      assigned_by: userId,
    });

  if (insertError) {
    if (insertError.code === "23505") {
      fail("This account is already assigned to the selected session.");
    }
    fail(insertError.message);
  }

  finish("Evaluator assigned to session.");
}

export async function removeEvaluatorFromSession(formData: FormData) {
  const { supabase } = await requireAdministrator();
  const assignmentId = readPositiveId(formData.get("assignmentId"));

  if (!assignmentId) fail("Invalid assignment.");

  const { data: assignment, error: lookupError } = await supabase
    .from("evaluator_assignments")
    .select("id, evaluation_session_id")
    .eq("id", assignmentId)
    .maybeSingle();

  if (lookupError || !assignment) fail("Assignment not found.");

  const { data: session, error: sessionError } = await supabase
    .from("evaluation_sessions")
    .select("season_id, status")
    .eq("id", assignment.evaluation_session_id)
    .maybeSingle();

  if (sessionError || !session) fail("Session not found.");
  if (session.status !== "setup") {
    fail("Assignments can only be changed while a session is in setup.");
  }

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("is_closed")
    .eq("id", session.season_id)
    .maybeSingle();

  if (seasonError || !season) fail("Season not found.");
  if (season.is_closed) fail("Cannot change assignments for a closed season.");

  const { error: deleteError } = await supabase
    .from("evaluator_assignments")
    .delete()
    .eq("id", assignmentId);

  if (deleteError) fail(deleteError.message);

  finish("Evaluator removed from session.");
}
