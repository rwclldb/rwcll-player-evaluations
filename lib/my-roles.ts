import type { SupabaseClient } from "@supabase/supabase-js";

type Season = { id: number; name: string };

export type MyRoles = {
  isAdmin: boolean;
  /** Coach or independent evaluator in some season. */
  scores: boolean;
  /** The open season this person is registrar for (latest first), if any. */
  registrarSeason: Season | null;
  /** The open season this person is announcer for (latest first), if any. */
  announcerSeason: Season | null;
};

// The latest open season among these ids.
async function latestOpen(supabase: SupabaseClient, ids: number[]): Promise<Season | null> {
  if (!ids.length) return null;
  const { data } = await supabase.from("seasons").select("id, name, start_date").in("id", ids).eq("is_closed", false)
    .order("start_date", { ascending: false }).limit(1);
  return data?.[0] ? { id: data[0].id as number, name: data[0].name as string } : null;
}

// What the signed-in person is, for menus and page access. The database still checks every action.
export async function getMyRoles(supabase: SupabaseClient): Promise<MyRoles> {
  const [{ data: isAdmin }, { data: roles }] = await Promise.all([supabase.rpc("is_admin"), supabase.rpc("my_season_roles")]);
  const rows = (roles ?? []) as { role_name: string; season_id: number | null }[];
  const idsFor = (role: string) => rows.filter((r) => r.role_name === role && r.season_id).map((r) => r.season_id as number);
  const [registrarSeason, announcerSeason] = await Promise.all([
    latestOpen(supabase, idsFor("registrar")), latestOpen(supabase, idsFor("announcer")),
  ]);
  return {
    isAdmin: isAdmin === true,
    scores: rows.some((r) => r.role_name === "coach" || r.role_name === "independent_evaluator"),
    registrarSeason,
    announcerSeason,
  };
}

/** Evaluation-day staff (registrar or announcer) who don't also coach or evaluate: no scoring, notes or draft reports. */
export const onlyEventStaff = (r: MyRoles) => !r.isAdmin && !r.scores && (r.registrarSeason !== null || r.announcerSeason !== null);

/** Admins and registrars run evaluation day: check-in, walk-ups, rosters and the timetable. */
export const runsEvaluationDay = (r: MyRoles) => r.isAdmin || r.registrarSeason !== null;

/** Admins, registrars and announcers call players (the announcer screen) and see Who scores when. */
export const callsPlayers = (r: MyRoles) => r.isAdmin || r.registrarSeason !== null || r.announcerSeason !== null;

/** The season an announcer or registrar calls players for. */
export const callingSeason = (r: MyRoles) => r.announcerSeason ?? r.registrarSeason;
