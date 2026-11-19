// Draft setup: shapes returned by drafts_overview() and draft_setup(), labels, and the checks the setup page
// shows before a draft can start. Pure functions so they can be tested on their own.

export type DraftOverview = {
  season_division_id: number; name: string; min_age: number | null; max_age: number | null;
  draft: { id: number; status: string; order_set: boolean; roster_size: number } | null;
  teams: number; pool: number; must_draft: number;
};

export type Draft = {
  id: number; status: "setup" | "live" | "paused" | "done"; pool_by_age_only: boolean; must_draft_ages: number[]; roster_size: number;
  order_type: "snake" | "straight"; age_order: "open" | "oldest_first";
  coach_kid_rule: "fixed_rounds" | "round_per_kid" | "by_round" | "before_draft"; coach_kid_rounds: number[]; coach_kid_by_round: number;
  siblings_together: boolean; sibling_optional: "always_take" | "ask" | "send_down"; pick_timer_seconds: number | null;
  order_source: "draw" | "manual" | null; order_set_at: string | null; copied_from: string | null;
};
export type Brief = { player_season_id: number; first_name: string; last_name: string; league_age: number | null; bib: number | null; is_coach_kid?: boolean };
export type PoolPlayer = Brief & {
  reason: "override_in" | "coach_kid" | "must_draft_age" | "by_age" | "requested" | "from_above";
  must_draft: boolean; requested: string | null; from_division: string | null;
  evaluator_overall: number | null; coach_overall: number | null; prior_overall: number | null; evaluations: number; rank: number;
  sibling_group: number | null; note: string | null; also_in: string[] | null;
};
export type SetupTeam = { team_id: number; name: string; position: number | null; roster_size: number | null; manager: string | null; coach: string | null };
export type Kid = Brief & { team_id: number; team: string; parent: string; parent_role: "manager" | "coach"; in_pool: boolean; round: number | null; suggested_round: number | null; kid_order: number };
export type Override = Brief & { mode: "in" | "out"; note: string; by: string; at: string };
export type DraftSetup = {
  division: { season_division_id: number; name: string; min_age: number; max_age: number; season_id: number; season: string; season_closed: boolean };
  draft: Draft | null;
  previous: { season: string } | null;
  teams: SetupTeam[];
  pool: PoolPlayer[];
  kids: Kid[];
  overrides: Override[];
  ages: { league_age: number; status: string; released: boolean }[];
  other_divisions: { season_division_id: number; name: string }[];
  players: Brief[];
};

export const STATUS_LABEL: Record<string, string> = { setup: "Setting up", live: "Live", paused: "Paused", done: "Finished" };
export const REASON_LABEL: Record<PoolPlayer["reason"], string> = {
  override_in: "Added by admin", coach_kid: "Coach's kid", must_draft_age: "Must-draft age", by_age: "By age",
  requested: "Asked for this division", from_above: "Left over",
};
export const KID_RULE_LABEL: Record<Draft["coach_kid_rule"], string> = {
  fixed_rounds: "Fixed rounds", round_per_kid: "A round for each kid", by_round: "Picked by a round", before_draft: "Placed before the draft",
};
/** RWCLL drafts these divisions, oldest first; AA teams are generated and Seniors usually has one team. */
export const DRAFTED_DIVISIONS = ["Juniors", "Majors", "AAA"];

/** The round a coach's kid fills when no round has been set by hand. */
export function defaultKidRound(draft: Draft, kid: Kid): number | null {
  if (draft.coach_kid_rule === "by_round") return null;
  if (draft.coach_kid_rule === "fixed_rounds") return draft.coach_kid_rounds[kid.kid_order - 1] ?? null;
  return kid.suggested_round;
}

export type Check = { level: "block" | "warn" | "ok"; text: string; href?: string };

/** What stands between this setup and starting the draft ("block"), and what's worth a look ("warn"). */
export function setupChecks(s: DraftSetup): Check[] {
  const out: Check[] = [];
  const d = s.draft;
  if (!d) return out;
  const teams = s.teams.length;
  if (teams === 0) out.push({ level: "block", text: "No teams yet. Add the division's teams on the Teams page.", href: `/protected/teams?season=${s.division.season_id}#div-${s.division.season_division_id}` });
  const noStaff = s.teams.filter((t) => !t.manager || !t.coach);
  if (noStaff.length) out.push({ level: "warn", text: `${noStaff.map((t) => `${t.name} (no ${[!t.manager && "manager", !t.coach && "coach"].filter(Boolean).join(" or ")})`).join(", ")}: the Manager and Coach sit in the draft room and their kids follow the coach's-kid rule.`, href: `/protected/teams?season=${s.division.season_id}` });
  if (teams > 0 && s.teams.some((t) => t.position === null)) out.push({ level: "block", text: d.order_set_at ? "A team was added since the order was set. Draw or set the order again." : "The first-round order isn't set. Draw it, or set it by hand." });
  const unreleased = s.ages.filter((a) => !a.released).map((a) => a.league_age);
  if (unreleased.length) out.push({ level: "block", text: `Age${unreleased.length === 1 ? "" : "s"} ${unreleased.join(", ")} ${unreleased.length === 1 ? "isn't" : "aren't"} released to coaches yet. A draft can't start until an admin releases them (Sessions).`, href: "/protected/sessions" });
  const spots = s.teams.reduce((n, t) => n + (t.roster_size ?? d.roster_size), 0);
  const pool = s.pool.length;
  const must = s.pool.filter((p) => p.must_draft).length;
  if (teams > 0 && must > spots) out.push({ level: "block", text: `${must} players must be drafted but there are only ${spots} roster spots. Add a team or raise roster sizes.` });
  else if (teams > 0 && pool > spots) out.push({ level: "warn", text: `${pool} players in the pool and ${spots} roster spots: ${pool - spots} won't be drafted (they drop to the next division if their age fits). Add a team or raise roster sizes if they should all play here.` });
  else if (teams > 0 && pool < spots) out.push({ level: "ok", text: `${pool} players for ${spots} roster spots: the draft ends when the pool is empty.` });
  const unrated = s.pool.filter((p) => p.evaluations === 0).length;
  if (unrated) out.push({ level: "warn", text: `${unrated} ${unrated === 1 ? "player has" : "players have"} no ratings.` });
  const outside = s.kids.filter((k) => !k.in_pool);
  if (outside.length) out.push({ level: "warn", text: `${outside.map((k) => `${k.first_name} ${k.last_name} (age ${k.league_age ?? "?"})`).join(", ")}: coach's ${outside.length === 1 ? "kid isn't" : "kids aren't"} in this pool.` });
  if (d.coach_kid_rule === "fixed_rounds") {
    const crowded = [...new Set(s.kids.filter((k) => k.kid_order > d.coach_kid_rounds.length && k.round === null).map((k) => k.team))];
    if (crowded.length) out.push({ level: "warn", text: `${crowded.join(", ")}: more coach's kids than listed rounds. Set their rounds below.` });
  }
  return out;
}
