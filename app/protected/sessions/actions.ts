
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
    !["open", "setup"].includes(requestedStatus)
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

  // Lock, unlock, release, and unrelease go through changeSessionStage (audited).
  const allowed =
    (session.status === "setup" && requestedStatus === "open") ||
    (session.status === "open" && requestedStatus === "setup");

  if (!allowed) {
    redirect(
      "/protected/sessions?error=Only%20setup%20to%20open%20and%20open%20to%20setup%20use%20this%20action.",
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

  if (requestedStatus === "setup") {
    // Reopening setup is allowed only before any evaluation work exists. Nothing
    // is deleted; existing scheduled events and evaluator assignments are retained.
    const { count, error: evaluationCountError } = await supabase
      .from("evaluations")
      .select("id", { count: "exact", head: true })
      .eq("evaluation_session_id", sessionId);

    if (evaluationCountError) {
      redirect(`/protected/sessions?error=${encodeURIComponent(evaluationCountError.message)}`);
    }
    if ((count ?? 0) > 0) {
      redirect("/protected/sessions?error=This%20session%20has%20evaluation%20records.%20It%20cannot%20return%20to%20Setup%20until%20that%20work%20is%20reviewed.");
    }
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

const STAGE_MESSAGES = {
  lock: "Session locked. Scoring has stopped. Coaches still cannot see reports.",
  unlock: "Session unlocked. Evaluators can change scores again.",
  release: "Reports released. Coaches can now see this age group's draft report.",
  unrelease: "Reports unreleased. Coaches can no longer see this age group's draft report.",
} as const;

// Lock / unlock / release / unrelease. The database function checks the admin role, the
// allowed transitions, and the reason for stepping back, and writes the audit log.
export async function changeSessionStage(formData: FormData) {
  const sessionId = Number(formData.get("sessionId"));
  const action = String(formData.get("stageAction") ?? "") as keyof typeof STAGE_MESSAGES;
  const reason = String(formData.get("reason") ?? "").trim();

  if (!Number.isSafeInteger(sessionId) || sessionId < 1 || !(action in STAGE_MESSAGES)) {
    redirect("/protected/sessions?error=Invalid%20session%20or%20action.");
  }

  const auth = await getAdministratorClient();
  if ("error" in auth && auth.error) {
    redirect(`/protected/sessions?error=${encodeURIComponent(auth.error)}`);
  }
  const { supabase } = auth;

  const { error } = await supabase.rpc("change_evaluation_session_stage", {
    p_session_id: sessionId,
    p_action: action,
    p_reason: reason || null,
  });

  if (error) {
    redirect(`/protected/sessions?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/protected/sessions");
  revalidatePath("/protected");
  redirect(`/protected/sessions?message=${encodeURIComponent(STAGE_MESSAGES[action])}`);
}

// League board decision: show prior-year ratings to coaches and evaluators while they score.
export async function setPriorYearVisibility(formData: FormData) {
  const seasonId = Number(formData.get("seasonId"));
  const visible = formData.get("visible") === "true";
  if (!Number.isSafeInteger(seasonId) || seasonId < 1) {
    redirect("/protected/sessions?error=Invalid%20season.");
  }

  const auth = await getAdministratorClient();
  if ("error" in auth && auth.error) {
    redirect(`/protected/sessions?error=${encodeURIComponent(auth.error)}`);
  }
  const { supabase } = auth;

  const { error } = await supabase.rpc("set_prior_year_visibility", { p_season_id: seasonId, p_visible: visible });
  if (error) {
    redirect(`/protected/sessions?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/protected/sessions");
  revalidatePath("/protected/evaluations");
  redirect(`/protected/sessions?message=${encodeURIComponent(
    visible
      ? "Prior-year ratings are now shown to coaches and evaluators while they score."
      : "Prior-year ratings are now hidden while scoring. They still appear in draft reports.",
  )}`);
}

export async function applyGlobalPrimaryEventSchedule(formData: FormData) {
  const seasonId = Number(formData.get("seasonId"));
  const eventDate = String(formData.get("eventDate") ?? "").trim();
  const startTime = String(formData.get("startTime") ?? "").trim();
  const endTime = String(formData.get("endTime") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (
    !Number.isSafeInteger(seasonId) || seasonId < 1 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
    endTime <= startTime || !location
  ) {
    redirect("/protected/sessions?error=Enter%20a%20valid%20global%20schedule%20including%20location.");
  }

  const auth = await getAdministratorClient();
  if ("error" in auth && auth.error) {
    redirect(`/protected/sessions?error=${encodeURIComponent(auth.error)}`);
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
    redirect("/protected/sessions?error=Cannot%20schedule%20events%20for%20a%20closed%20season.");
  }

  const { data: sessions, error: sessionsError } = await supabase
    .from("evaluation_sessions")
    .select("id, status")
    .eq("season_id", seasonId)
    .is("season_division_id", null)
    .in("league_age", [...LEAGUE_AGES]);
  if (sessionsError) {
    redirect(`/protected/sessions?error=${encodeURIComponent(sessionsError.message)}`);
  }

  const setupIds = (sessions ?? []).filter((session) => session.status === "setup").map((session) => session.id);
  if (setupIds.length === 0) {
    redirect("/protected/sessions?error=No%20Setup%20sessions%20are%20eligible%20for%20the%20global%20schedule.");
  }

  const { data: existingPrimary, error: primaryError } = await supabase
    .from("evaluation_session_events")
    .select("evaluation_session_id")
    .in("evaluation_session_id", setupIds)
    .eq("event_type", "primary");
  if (primaryError) {
    redirect(`/protected/sessions?error=${encodeURIComponent(primaryError.message)}`);
  }

  const alreadyScheduled = new Set((existingPrimary ?? []).map((event) => event.evaluation_session_id));
  const eligibleIds = setupIds.filter((id) => !alreadyScheduled.has(id));
  if (eligibleIds.length === 0) {
    redirect("/protected/sessions?error=All%20Setup%20sessions%20already%20have%20a%20primary%20event.%20Existing%20schedules%20were%20left%20unchanged.");
  }

  const { error: insertError } = await supabase
    .from("evaluation_session_events")
    .insert(eligibleIds.map((evaluation_session_id) => ({
      evaluation_session_id,
      event_type: "primary",
      event_date: eventDate,
      start_time: startTime,
      end_time: endTime,
      location,
      notes: notes || null,
      created_by: userId,
    })));
  if (insertError) {
    redirect(`/protected/sessions?error=${encodeURIComponent(insertError.message)}`);
  }

  revalidatePath("/protected/sessions");
  revalidatePath("/protected/evaluations");
  redirect(`/protected/sessions?message=${encodeURIComponent(`Applied the global primary schedule to ${eligibleIds.length} Setup session(s) in ${season.name}. Existing primary schedules and non-Setup sessions were not changed.`)}`);
}

export async function applyGlobalMakeupEventSchedule(formData: FormData) {
  const seasonId = Number(formData.get("seasonId"));
  const eventDate = String(formData.get("eventDate") ?? "").trim();
  const startTime = String(formData.get("startTime") ?? "").trim();
  const endTime = String(formData.get("endTime") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (
    !Number.isSafeInteger(seasonId) || seasonId < 1 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) ||
    endTime <= startTime || !location
  ) {
    redirect("/protected/sessions?error=Enter%20a%20valid%20global%20makeup%20schedule%20including%20location.");
  }

  const auth = await getAdministratorClient();
  if ("error" in auth && auth.error) {
    redirect(`/protected/sessions?error=${encodeURIComponent(auth.error)}`);
  }
  const { supabase, userId } = auth;

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, name, is_closed")
    .eq("id", seasonId)
    .maybeSingle();
  if (seasonError || !season) redirect("/protected/sessions?error=Season%20not%20found.");
  if (season.is_closed) redirect("/protected/sessions?error=Cannot%20schedule%20events%20for%20a%20closed%20season.");

  const { data: sessions, error: sessionsError } = await supabase
    .from("evaluation_sessions")
    .select("id, status")
    .eq("season_id", seasonId)
    .is("season_division_id", null)
    .in("league_age", [...LEAGUE_AGES]);
  if (sessionsError) redirect(`/protected/sessions?error=${encodeURIComponent(sessionsError.message)}`);

  const setupIds = (sessions ?? []).filter((session) => session.status === "setup").map((session) => session.id);
  if (setupIds.length === 0) redirect("/protected/sessions?error=No%20Setup%20sessions%20are%20eligible%20for%20a%20global%20makeup%20event.");

  const { data: primaryEvents, error: primaryError } = await supabase
    .from("evaluation_session_events")
    .select("evaluation_session_id")
    .in("evaluation_session_id", setupIds)
    .eq("event_type", "primary");
  if (primaryError) redirect(`/protected/sessions?error=${encodeURIComponent(primaryError.message)}`);
  const hasPrimary = new Set((primaryEvents ?? []).map((event) => event.evaluation_session_id));
  const eligibleIds = setupIds.filter((id) => hasPrimary.has(id));
  if (eligibleIds.length === 0) redirect("/protected/sessions?error=No%20Setup%20sessions%20have%20a%20primary%20event.%20Schedule%20primary%20events%20first.");

  const { error: insertError } = await supabase.from("evaluation_session_events").insert(
    eligibleIds.map((evaluation_session_id) => ({
      evaluation_session_id,
      event_type: "makeup",
      event_date: eventDate,
      start_time: startTime,
      end_time: endTime,
      location,
      notes: notes || null,
      created_by: userId,
    })),
  );
  if (insertError) redirect(`/protected/sessions?error=${encodeURIComponent(insertError.message)}`);

  revalidatePath("/protected/sessions");
  revalidatePath("/protected/evaluations");
  redirect(`/protected/sessions?message=${encodeURIComponent(`Added the global makeup schedule to ${eligibleIds.length} Setup session(s) in ${season.name}. Existing events and non-Setup sessions were not changed.`)}`);
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
