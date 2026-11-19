// Team rosters: the shape season_rosters() returns, and how a placement reads on screen and in the CSV.

export type Placement =
  | { how: "drafted" | "coach_kid" | "sibling"; round: number; overall: number; override: boolean }
  | { how: "moved"; note: string; at: string; from: string | null }
  | { how: "placed" };
export type RosterPlayer = {
  player_season_id: number; first_name: string; last_name: string; league_age: number | null; bib: number | null; is_coach_kid: boolean;
  placement: Placement; sibling_group: number | null;
};
export type RosterTeam = {
  id: number; name: string; roster_size: number | null;
  staff: { name: string; role: "manager" | "coach" | "assistant_coach"; email: string | null }[];
  players: RosterPlayer[];
};
export type RosterDivision = {
  season_division_id: number; name: string; min_age: number | null; max_age: number | null;
  released_at: string | null; draft_status: string | null; teams: RosterTeam[];
};
export type Unplaced = { player_season_id: number; first_name: string; last_name: string; league_age: number | null; bib: number | null; pools: string[] | null };
export type Move = { player_season_id: number; first_name: string; last_name: string; from: string | null; to: string | null; note: string; by: string; at: string; pick_removed: boolean };
export type SeasonRosters = { divisions: RosterDivision[]; unplaced: Unplaced[]; moves: Move[] };

export function placementLabel(p: Placement): string {
  switch (p.how) {
    case "drafted": return `Round ${p.round} (pick ${p.overall})${p.override ? ", override" : ""}`;
    case "coach_kid": return `Coach's kid (round ${p.round})`;
    case "sibling": return `Sibling (round ${p.round})`;
    case "moved": return p.from ? `Moved from ${p.from}` : "Placed by admin";
    default: return "Placed by admin";
  }
}

export const ROLE_LABEL: Record<string, string> = { manager: "Manager", coach: "Coach", assistant_coach: "Assistant" };

/** Teams to offer in a Move menu: this division first, then the rest, oldest division first. */
export function moveTargets(divisions: RosterDivision[], currentDivisionId: number | null) {
  const order = [...divisions].sort((a, b) => (a.season_division_id === currentDivisionId ? -1 : b.season_division_id === currentDivisionId ? 1 : 0));
  return order.map((d) => ({ division: d.name, teams: d.teams.map((t) => ({ id: t.id, name: t.name, count: t.players.length, size: t.roster_size })) }));
}
