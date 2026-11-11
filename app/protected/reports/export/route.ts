import { createClient } from "@/lib/supabase/server";

type Registration = {
  id: number; player_id: number; season_id: number; league_age: number | null; evaluation_number: number | null;
  registration_payment_status: string | null; players: { first_name: string; last_name: string } | null;
};
type Session = { id: number; league_age: number | null };
type Evaluation = { id: number; evaluation_session_id: number; player_season_id: number; evaluator_user_id: string; evaluator_type: string; status: string };
type Rating = { evaluation_id: number; rating_category_id: number; score: number };
type Category = { id: number; code: string; name: string };
type Profile = { user_id: string; display_name: string | null };
type HistoricalEvaluation = { id: number; player_id: number; source_season_label: string; source_division_name: string; source_team_label: string | null; source_coach_name: string | null; coverage_note: string | null };
type HistoricalRating = { historical_evaluation_id: number; category_name: string; score: number; rating_category_id: number | null };

function csvCell(value: string | number | null | undefined) {
  const raw = value === null || value === undefined ? "" : String(value);
  // Prevent spreadsheet formula execution from imported names/notes.
  const text = /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(values: Array<string | number | null | undefined>) {
  return values.map(csvCell).join(",");
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims) return new Response("Unauthorized", { status: 401 });
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError || isAdmin !== true) return new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const seasonId = Number(url.searchParams.get("seasonId"));
  if (!Number.isSafeInteger(seasonId) || seasonId <= 0) return new Response("A valid seasonId is required.", { status: 400 });

  const seasonResult = await supabase.from("seasons").select("id, name").eq("id", seasonId).maybeSingle();
  if (seasonResult.error) return new Response("Could not load season.", { status: 500 });
  if (!seasonResult.data) return new Response("Season not found.", { status: 404 });

  const registrationResult = await supabase.from("player_seasons")
    .select("id, player_id, season_id, league_age, evaluation_number, registration_payment_status, players(first_name, last_name)")
    .eq("season_id", seasonId).order("id");
  if (registrationResult.error) return new Response("Could not load registrations.", { status: 500 });
  const registrations = (registrationResult.data ?? []) as unknown as Registration[];
  const playerSeasonIds = registrations.map((row) => row.id);
  const playerIds = [...new Set(registrations.map((row) => row.player_id))];
  const [sessionResult, categoryResult, profileResult, historyResult] = await Promise.all([
    supabase.from("evaluation_sessions").select("id, league_age").eq("season_id", seasonId).is("season_division_id", null),
    supabase.from("rating_categories").select("id, code, name"),
    supabase.from("user_profiles").select("user_id, display_name"),
    playerIds.length ? supabase.from("historical_evaluations").select("id, player_id, source_season_label, source_division_name, source_team_label, source_coach_name, coverage_note").in("player_id", playerIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const initialError = sessionResult.error ?? categoryResult.error ?? profileResult.error ?? historyResult.error;
  if (initialError) return new Response("Could not load report data.", { status: 500 });
  const sessions = (sessionResult.data ?? []) as Session[];
  const categories = (categoryResult.data ?? []) as Category[];
  const profiles = (profileResult.data ?? []) as Profile[];
  const historical = (historyResult.data ?? []) as HistoricalEvaluation[];
  const sessionIds = sessions.map((session) => session.id);
  const [evaluationResult, historyRatingsResult] = await Promise.all([
    playerSeasonIds.length && sessionIds.length ? supabase.from("evaluations")
      .select("id, evaluation_session_id, player_season_id, evaluator_user_id, evaluator_type, status")
      .in("player_season_id", playerSeasonIds).in("evaluation_session_id", sessionIds) : Promise.resolve({ data: [], error: null }),
    historical.length ? supabase.from("historical_ratings").select("historical_evaluation_id, category_name, score, rating_category_id").in("historical_evaluation_id", historical.map((item) => item.id)) : Promise.resolve({ data: [], error: null }),
  ]);
  if (evaluationResult.error || historyRatingsResult.error) return new Response("Could not load evaluation records.", { status: 500 });
  const evaluations = (evaluationResult.data ?? []) as Evaluation[];
  const historyRatings = (historyRatingsResult.data ?? []) as HistoricalRating[];
  const evaluationIds = evaluations.map((item) => item.id);
  const ratingResult = evaluationIds.length ? await supabase.from("ratings").select("evaluation_id, rating_category_id, score").in("evaluation_id", evaluationIds) : { data: [], error: null };
  if (ratingResult.error) return new Response("Could not load current ratings.", { status: 500 });
  const ratings = (ratingResult.data ?? []) as Rating[];
  const nameFor = (playerSeasonId: number) => {
    const row = registrations.find((item) => item.id === playerSeasonId);
    return row?.players ? `${row.players.first_name} ${row.players.last_name}` : `Player #${row?.player_id ?? ""}`;
  };
  const playerForHistory = (playerId: number) => registrations.find((item) => item.player_id === playerId);
  const evaluatorName = (userId: string) => profiles.find((item) => item.user_id === userId)?.display_name ?? "Evaluator";
  const rows: Array<Array<string | number | null | undefined>> = [[
    "record_type", "player_name", "player_id", "season", "league_age", "evaluation_number", "registration_payment_status",
    "evaluator_type", "evaluator_name", "evaluation_status", "rating_category", "score_1_to_5", "rating_count",
    "historical_source_season", "source_coach", "historical_division", "historical_team", "coverage_note",
  ]];

  for (const registration of registrations) {
    const playerName = registration.players ? `${registration.players.first_name} ${registration.players.last_name}` : `Player #${registration.player_id}`;
    const playerEvals = evaluations.filter((item) => item.player_season_id === registration.id);
    if (playerEvals.length === 0) {
      rows.push(["CURRENT", playerName, registration.player_id, seasonResult.data.name, registration.league_age, registration.evaluation_number, registration.registration_payment_status, "", "", "no_evaluation_record", "", "", "", "", "", "", "", ""]);
    } else {
      for (const evaluation of playerEvals) {
        const ownRatings = ratings.filter((rating) => rating.evaluation_id === evaluation.id);
        const base = ["CURRENT", playerName, registration.player_id, seasonResult.data.name, registration.league_age, registration.evaluation_number, registration.registration_payment_status, evaluation.evaluator_type, evaluatorName(evaluation.evaluator_user_id), evaluation.status];
        if (ownRatings.length === 0) rows.push([...base, "", "", "", "", "", "", "", ""]);
        else for (const rating of ownRatings) rows.push([...base, categories.find((item) => item.id === rating.rating_category_id)?.name ?? "Unmapped category", rating.score, 1, "", "", "", "", ""]);
      }
    }
  }

  // Export submitted age-group averages as separate summary records, not player scores.
  for (const session of sessions) {
    const sessionEvaluations = evaluations.filter((item) => item.evaluation_session_id === session.id && item.status === "submitted");
    for (const category of categories) {
      if (!["hitting", "throwing", "grounders", "fly_balls", "running_awareness"].includes(category.code)) continue;
      for (const evaluatorType of ["coach", "independent_evaluator"]) {
        const scores = ratings.filter((rating) => rating.rating_category_id === category.id && sessionEvaluations.some((evaluation) => evaluation.id === rating.evaluation_id && evaluation.evaluator_type === evaluatorType)).map((rating) => rating.score);
        const average = scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : "";
        rows.push(["CURRENT_GROUP_SUMMARY", "Age " + (session.league_age ?? "not set") + " group average", "", seasonResult.data.name, session.league_age, "", "", evaluatorType, "", "submitted_group_average", category.name, average, scores.length, "", "", "", "", ""]);
      }
    }
  }

  for (const historicalEvaluation of historical) {
    const registration = playerForHistory(historicalEvaluation.player_id);
    if (!registration) continue;
    const playerName = registration.players ? `${registration.players.first_name} ${registration.players.last_name}` : `Player #${registration.player_id}`;
    const ownRatings = historyRatings.filter((rating) => rating.historical_evaluation_id === historicalEvaluation.id);
    const base = ["HISTORICAL_PLAYER", playerName, historicalEvaluation.player_id, seasonResult.data.name, registration.league_age, registration.evaluation_number, registration.registration_payment_status, "historical_coach", historicalEvaluation.source_coach_name ?? "", "historical",];
    if (ownRatings.length === 0) rows.push([...base, "", "", "", historicalEvaluation.source_season_label, historicalEvaluation.source_coach_name, historicalEvaluation.source_division_name, historicalEvaluation.source_team_label, historicalEvaluation.coverage_note]);
    else for (const rating of ownRatings) rows.push([...base, categories.find((item) => item.id === rating.rating_category_id)?.name ?? rating.category_name, rating.score, 1, historicalEvaluation.source_season_label, historicalEvaluation.source_coach_name, historicalEvaluation.source_division_name, historicalEvaluation.source_team_label, historicalEvaluation.coverage_note]);
  }

  const csv = rows.map(csvRow).join("\r\n") + "\r\n";
  const safeSeason = String(seasonResult.data.name).replace(/[^a-zA-Z0-9_-]+/g, "-");
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rwcll-player-reports-${safeSeason}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
