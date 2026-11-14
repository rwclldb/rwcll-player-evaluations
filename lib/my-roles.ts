import type { SupabaseClient } from "@supabase/supabase-js";

export type MyRoles = {
  isAdmin: boolean;
  /** Coach or independent evaluator in some season. */
  scores: boolean;
  /** The open season this person is registrar for (latest first), if any. */
  registrarSeason: { id: number; name: string } | null;
};

// What the signed-in person is, for menus and page access. The database still checks every action.
export async function getMyRoles(supabase: SupabaseClient): Promise<MyRoles> {
  const [{ data: isAdmin }, { data: roles }] = await Promise.all([supabase.rpc("is_admin"), supabase.rpc("my_season_roles")]);
  const rows = (roles ?? []) as { role_name: string; season_id: number | null }[];
  const registrarIds = rows.filter((r) => r.role_name === "registrar" && r.season_id).map((r) => r.season_id as number);
  let registrarSeason: MyRoles["registrarSeason"] = null;
  if (registrarIds.length) {
    const { data } = await supabase.from("seasons").select("id, name, start_date").in("id", registrarIds).eq("is_closed", false)
      .order("start_date", { ascending: false }).limit(1);
    if (data?.[0]) registrarSeason = { id: data[0].id as number, name: data[0].name as string };
  }
  return {
    isAdmin: isAdmin === true,
    scores: rows.some((r) => r.role_name === "coach" || r.role_name === "independent_evaluator"),
    registrarSeason,
  };
}

/** A registrar who doesn't also coach or evaluate: no scoring, notes or draft reports. */
export const onlyRegistrar = (r: MyRoles) => !r.isAdmin && !r.scores && r.registrarSeason !== null;

/** Admins and registrars run evaluation day: check-in, walk-ups, rosters and the timetable. */
export const runsEvaluationDay = (r: MyRoles) => r.isAdmin || r.registrarSeason !== null;
