
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

const LEAGUE_AGES = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const;

async function getAdministratorClient() {
  const supabase = await createClient();

  const { data: claims, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claims?.claims) {
    return { error: "Sign in before managing evaluation sessions." } as const;
  }

  const { data: isAdmin, error: roleError } =
    await supabase.rpc("is_admin");

  if (roleError || isAdmin !== true) {
    return { error: "Administrator access is required." } as const;
  }

  return { supabase, userId: String(claims.claims.sub) } as const;
}

export async function createMissingAgeSessions(formData: FormData) {
  const seasonId = Number(formData.get("seasonId"));

  if (!Number.isSafeInteger(seasonId) || seasonId < 1) {
    redirect("/protected/sessions?error=Invalid%20season.");
  }

  const auth = await getAdministratorClient();

  if ("error" in auth && auth.error) {
    redirect(
      `/protected/sessions?error=${encodeURIComponent(auth.error)}`,
    );
  }

  const { supabase, userId } = auth;

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, name, is_closed")
    .eq("id", seasonId)
    .maybeSingle();

  if (seasonError || !season) {
    redirect("/protected/sessions?error=Season%20not%20found.");
  }

  if (season.is_closed) {
    redirect(
      "/protected/sessions?error=Cannot%20add%20sessions%20to%20a%20closed%20season.",
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("evaluation_sessions")
    .select("league_age")
    .eq("season_id", seasonId)
    .is("season_division_id", null)
    .in("league_age", [...LEAGUE_AGES]);

  if (existingError) {
    redirect(
      `/protected/sessions?error=${encodeURIComponent(existingError.message)}`,
    );
  }

  const existingAges = new Set(
    (existing ?? []).map((session) => session.league_age),
  );

  const missingAges = LEAGUE_AGES.filter(
    (age) => !existingAges.has(age),
  );

  if (missingAges.length === 0) {
    revalidatePath("/protected/sessions");
    redirect("/protected/sessions?message=All%20ten%20age%20sessions%20already%20exist.");
  }

  // Insert only missing ages. The unique index protects against duplicates.
  // If another request creates an age concurrently, report the database error
  // rather than silently treating an incomplete operation as successful.
  const { error: insertError } = await supabase
    .from("evaluation_sessions")
    .insert(
      missingAges.map((league_age) => ({
        season_id: seasonId,
        league_age,
        season_division_id: null,
        status: "setup",
        created_by: userId,
      })),
    );

  if (insertError) {
    redirect(
      `/protected/sessions?error=${encodeURIComponent(insertError.message)}`,
    );
  }

  revalidatePath("/protected/sessions");
  revalidatePath("/protected");

  redirect(
    `/protected/sessions?message=${encodeURIComponent(
      `Created ${missingAges.length} age session(s) for ${season.name}.`,
    )}`,
  );
}

export async function advanceEvaluationSessionStatus(formData: FormData) {
  const sessionId = Number(formData.get("sessionId"));
  const requestedStatus = String(formData.get("status") ?? "");

  if (
    !Number.isSafeInteger(sessionId) ||
    sessionId < 1 ||
    !["open", "locked"].includes(requestedStatus)
  ) {
    redirect("/protected/sessions?error=Invalid%20session%20or%20status.");
  }

  const auth = await getAdministratorClient();

  if ("error" in auth && auth.error) {
    redirect(
      `/protected/sessions?error=${encodeURIComponent(auth.error)}`,
    );
  }

  const { supabase } = auth;

  const { data: session, error: sessionError } = await supabase
    .from("evaluation_sessions")
    .select("id, season_id, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError || !session) {
    redirect("/protected/sessions?error=Session%20not%20found.");
  }

  const allowed =
    (session.status === "setup" && requestedStatus === "open") ||
    (session.status === "open" && requestedStatus === "locked");

  if (!allowed) {
    redirect(
      "/protected/sessions?error=Only%20setup%20to%20open%20and%20open%20to%20locked%20transitions%20are%20allowed.",
    );
  }

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("is_closed")
    .eq("id", session.season_id)
    .maybeSingle();

  if (seasonError || !season) {
    redirect("/protected/sessions?error=Season%20not%20found.");
  }

  if (season.is_closed) {
    redirect(
      "/protected/sessions?error=Cannot%20change%20sessions%20in%20a%20closed%20season.",
    );
  }

  if (requestedStatus === "open") {
    const { data: primaryEvent, error: eventError } = await supabase
      .from("evaluation_session_events")
      .select("id")
      .eq("evaluation_session_id", sessionId)
      .eq("event_type", "primary")
      .maybeSingle();

    if (eventError) {
      redirect(`/protected/sessions?error=${encodeURIComponent(eventError.message)}`);
    }
    if (!primaryEvent) {
      redirect("/protected/sessions?error=Schedule%20a%20primary%20event%20before%20opening%20this%20session.");
    }

    const { data: evaluator, error: assignmentError } = await supabase
      .from("evaluator_assignments")
      .select("id")
      .eq("evaluation_session_id", sessionId)
      .limit(1)
      .maybeSingle();

    if (assignmentError) {
      redirect(`/protected/sessions?error=${encodeURIComponent(assignmentError.message)}`);
    }
    if (!evaluator) {
      redirect("/protected/sessions?error=Assign%20at%20least%20one%20evaluator%20before%20opening%20this%20session.");
    }
  }

  const { error: updateError } = await supabase
    .from("evaluation_sessions")
    .update({ status: requestedStatus })
    .eq("id", sessionId);

  if (updateError) {
    redirect(
      `/protected/sessions?error=${encodeURIComponent(updateError.message)}`,
    );
  }

  revalidatePath("/protected/sessions");
  revalidatePath("/protected");

  redirect(
    `/protected/sessions?message=${encodeURIComponent(
      `Session status updated to ${requestedStatus}.`,
    )}`,
  );
}

export async function saveEvaluationSessionEvent(formData: FormData) {
  const sessionId = Number(formData.get("sessionId"));
  const eventIdRaw = String(formData.get("eventId") ?? "").trim();
  const eventId = eventIdRaw ? Number(eventIdRaw) : null;
  const eventType = String(formData.get("eventType") ?? "");
  const eventDate = String(formData.get("eventDate") ?? "").trim();
  const startTime = String(formData.get("startTime") ?? "").trim();
  const endTime = String(formData.get("endTime") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (
    !Number.isSafeInteger(sessionId) || sessionId < 1 ||
    (eventId !== null && (!Number.isSafeInteger(eventId) || eventId < 1)) ||
    !["primary", "makeup"].includes(eventType) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
    endTime <= startTime ||
    !location
  ) {
    redirect("/protected/sessions?error=Enter%20a%20valid%20event%20date%2C%20time%20range%2C%20and%20location.");
  }

  const auth = await getAdministratorClient();
  if ("error" in auth && auth.error) {
    redirect(`/protected/sessions?error=${encodeURIComponent(auth.error)}`);
  }

  const { supabase, userId } = auth;
  const { data: session, error: sessionError } = await supabase
    .from("evaluation_sessions")
    .select("id, season_id, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError || !session) {
    redirect("/protected/sessions?error=Session%20not%20found.");
  }
  if (session.status !== "setup") {
    redirect("/protected/sessions?error=Event%20schedules%20can%20only%20be%20changed%20during%20setup.");
  }

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("is_closed")
    .eq("id", session.season_id)
    .maybeSingle();
  if (seasonError || !season) {
    redirect("/protected/sessions?error=Season%20not%20found.");
  }
  if (season.is_closed) {
    redirect("/protected/sessions?error=Cannot%20schedule%20events%20for%20a%20closed%20season.");
  }

  const eventValues = {
    event_type: eventType,
    event_date: eventDate,
    start_time: startTime,
    end_time: endTime,
    location,
    notes: notes || null,
  };

  const result = eventId === null
    ? await supabase.from("evaluation_session_events").insert({
        ...eventValues,
        evaluation_session_id: sessionId,
        created_by: userId,
      })
    : await supabase
        .from("evaluation_session_events")
        .update(eventValues)
        .eq("id", eventId)
        .eq("evaluation_session_id", sessionId);

  if (result.error) {
    redirect(`/protected/sessions?error=${encodeURIComponent(result.error.message)}`);
  }

  revalidatePath("/protected/sessions");
  revalidatePath("/protected/evaluations");
  redirect(`/protected/sessions?message=${encodeURIComponent(eventId === null ? "Event scheduled." : "Event schedule updated.")}`);
}

export async function deleteEvaluationSessionEvent(formData: FormData) {
  const sessionId = Number(formData.get("sessionId"));
  const eventId = Number(formData.get("eventId"));
  if (!Number.isSafeInteger(sessionId) || sessionId < 1 || !Number.isSafeInteger(eventId) || eventId < 1) {
    redirect("/protected/sessions?error=Invalid%20session%20or%20event.");
  }

  const auth = await getAdministratorClient();
  if ("error" in auth && auth.error) {
    redirect(`/protected/sessions?error=${encodeURIComponent(auth.error)}`);
  }

  const { supabase } = auth;
  const { data: session, error: sessionError } = await supabase
    .from("evaluation_sessions")
    .select("id, season_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError || !session) {
    redirect("/protected/sessions?error=Session%20not%20found.");
  }
  if (session.status !== "setup") {
    redirect("/protected/sessions?error=Events%20can%20only%20be%20removed%20during%20setup.");
  }

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("is_closed")
    .eq("id", session.season_id)
    .maybeSingle();
  if (seasonError || !season || season.is_closed) {
    redirect("/protected/sessions?error=Cannot%20change%20events%20for%20a%20closed%20season.");
  }

  const { error } = await supabase
    .from("evaluation_session_events")
    .delete()
    .eq("id", eventId)
    .eq("evaluation_session_id", sessionId);
  if (error) {
    redirect(`/protected/sessions?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/protected/sessions");
  redirect("/protected/sessions?message=Event%20removed.");
}
