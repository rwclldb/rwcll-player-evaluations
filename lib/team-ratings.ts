// End-of-season ratings by team managers: shapes from the database and the screen's small rules.
// Pure functions (no React, no Supabase) so they can be tested on their own.

export const CORE_CODES = ["hitting", "throwing", "grounders", "fly_balls", "running_awareness"] as const;

export type RatingTeam = { team_id: number; team: string; division: string; season_id: number; season: string; is_open: boolean; players: number; rated: number; not_rated: number };
export type SheetStatus = "todo" | "rated" | "not_rated";
export type SheetPlayer = {
  player_season_id: number; first_name: string; last_name: string; bib: number | null; league_age: number | null;
  status: SheetStatus; saved_at: string | null; ratings: Record<string, number>;
};
export type RatingSheet = {
  team_id: number; team: string; division: string; season_id: number; season: string; manager: string | null;
  is_open: boolean; can_save: boolean; players: SheetPlayer[];
};

/** Core-skill average of a saved rating (blank skills left out), or null. */
export function coreAverage(ratings: Record<string, number>): number | null {
  const s = CORE_CODES.map((c) => ratings[c]).filter((v): v is number => typeof v === "number");
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
}

/** Core skills left blank in a saved rating (flagged, not blocking). */
export function blankCore(ratings: Record<string, number>): number {
  return CORE_CODES.filter((c) => typeof ratings[c] !== "number").length;
}

/** After saving a player: the next player still to do after them in list order (wrapping), else the next in the list, else null. */
export function nextAfter(players: SheetPlayer[], id: number): number | null {
  const i = players.findIndex((p) => p.player_season_id === id);
  if (i < 0) return null;
  const order = [...players.slice(i + 1), ...players.slice(0, i)];
  return (order.find((p) => p.status === "todo") ?? players[i + 1] ?? null)?.player_season_id ?? null;
}

/** Players done (rated or marked Not rated) of all. */
export function sheetProgress(players: SheetPlayer[]) {
  return { done: players.filter((p) => p.status !== "todo").length, total: players.length };
}
