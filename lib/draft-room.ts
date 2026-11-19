// The draft room: shapes returned by draft_board() and draft_players(), and the sorting and rules the screen uses.
// Pure functions so they can be tested on their own.

export type BoardPick = {
  player_season_id: number; first_name: string; last_name: string; league_age: number | null; bib: number | null;
  kind: "pick" | "coach_kid" | "sibling"; made_at: string; override: boolean; override_note: string | null; moved_to?: string | null;
};
export type Slot = { overall: number; round: number; pick_in_round: number; team_id: number; marked: boolean; pick: BoardPick | null };
export type BoardTeam = { team_id: number; name: string; position: number | null; roster_size: number; manager: string | null; coach: string | null };
export type Board = {
  draft: {
    id: number; status: "setup" | "live" | "paused" | "done"; order_type: string; age_order: "open" | "oldest_first"; coach_kid_rule: string;
    pick_timer_seconds: number | null; started_at: string | null; finished_at: string | null; clock_started_at: string | null; updated_at: string;
    season_division_id: number; division: string; season: string;
  };
  can_run: boolean;
  now: string;
  my_team_ids: number[];
  teams: BoardTeam[];
  slots: Slot[];
  next: { overall: number; round: number; pick_in_round: number; team_id: number; must_only: boolean } | null;
  tier_age: number | null;
  available: number[];
  must_left: number;
  reserved: Record<string, number>;
  queued: { player_season_id: number; team_id: number }[];
  asks: { player_season_id: number; first_name: string; last_name: string; league_age: number | null; bib: number | null; team_id: number;
    because_of: { first_name: string; last_name: string } | null }[];
};
export type RoomPlayer = {
  player_season_id: number; first_name: string; last_name: string; league_age: number | null; bib: number | null; is_coach_kid: boolean;
  reason: string; must_draft: boolean; requested: string | null;
  evaluator_overall: number | null; coach_overall: number | null; coach_trimmed_overall: number | null; prior_overall: number | null;
  my_overall: number | null; evaluations: number; sibling_group: number | null; starred: boolean; my_note: string | null;
};

export type SortKey = "evaluator" | "coach" | "trimmed" | "prior" | "mine";
export const SORTS: { key: SortKey; label: string; short: string }[] = [
  { key: "evaluator", label: "Evaluator average", short: "Eval" },
  { key: "coach", label: "Coach average", short: "Coach" },
  { key: "trimmed", label: "Coach (high/low dropped)", short: "Coach*" },
  { key: "prior", label: "Prior year", short: "Prior" },
  { key: "mine", label: "My scores", short: "Mine" },
];
export const sortValue = (p: RoomPlayer, key: SortKey): number | null => {
  const v = key === "evaluator" ? p.evaluator_overall : key === "coach" ? p.coach_overall
    : key === "trimmed" ? (p.coach_trimmed_overall ?? p.coach_overall) : key === "prior" ? p.prior_overall : p.my_overall;
  return v === null || v === undefined ? null : Number(v);
};
/** Highest first; players without a number go last, then by bib. */
export function sortPlayers(list: RoomPlayer[], key: SortKey): RoomPlayer[] {
  return [...list].sort((a, b) => {
    const x = sortValue(a, key), y = sortValue(b, key);
    if (x === null && y === null) return (a.bib ?? 9999) - (b.bib ?? 9999);
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || (a.bib ?? 9999) - (b.bib ?? 9999);
  });
}

/** Can this player be picked for the team on the clock, and does it need an override note? */
export function pickRule(board: Board, p: RoomPlayer): { allowed: boolean; needsNote: boolean; why: string | null } {
  if (!board.next) return { allowed: false, needsNote: false, why: "Every pick has been made." };
  const reservedFor = board.reserved[String(p.player_season_id)];
  if (reservedFor && reservedFor !== board.next.team_id) {
    const team = board.teams.find((t) => t.team_id === reservedFor)?.name ?? "another team";
    return { allowed: false, needsNote: false, why: `Coach's kid of ${team}: only that team can take them.` };
  }
  if (reservedFor) return { allowed: true, needsNote: false, why: null };
  if (board.draft.age_order === "open" && board.next.must_only && !p.must_draft) {
    return { allowed: true, needsNote: true, why: "Only must-draft players can be picked now." };
  }
  if (board.draft.age_order === "oldest_first" && board.tier_age !== null && p.league_age !== board.tier_age) {
    return { allowed: true, needsNote: true, why: `This draft takes the ${board.tier_age}-year-olds first.` };
  }
  return { allowed: true, needsNote: false, why: null };
}

/** Seconds left on the pick clock (negative when over), allowing for the gap between server and device clocks. */
export function clockLeft(board: Board, skewMs: number, nowMs = Date.now()): number | null {
  if (!board.draft.pick_timer_seconds || !board.draft.clock_started_at || board.draft.status !== "live") return null;
  const started = Date.parse(board.draft.clock_started_at);
  return Math.round(board.draft.pick_timer_seconds - (nowMs + skewMs - started) / 1000);
}
