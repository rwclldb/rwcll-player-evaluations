// Team maker: balanced teams for a division, made in the browser (draft step 5; docs/DRAFT-SPEC.md section 4).
// Pure functions, deterministic for a given seed, so they can be tested on their own.
//
// Rules:
// * Players already on a team stay there. Coach's kids go to their parent's team. Siblings stay together (a sibling
//   group moves as one unit, and follows a member who is already placed or is a coach's kid).
// * Rating = the mean of the ticked sources the player has (evaluator, coach, prior-year overall). A player with
//   none of them gets the group's median, so unrated players don't pile onto one team. Nothing ticked = random.
// * Team sizes are as even as possible (they differ by at most one; teams with more players already placed get the
//   extra spots first).
// * Building: fixed units first, then the rest from the highest rated down, each to the team with room and the lowest
//   rating total. Then pairs of single players are swapped between teams while that makes team averages (and, if
//   ticked, the age mix) more even.

export type TMPlayer = {
  player_season_id: number; first_name: string; last_name: string; league_age: number | null; bib: number | null; is_coach_kid?: boolean;
  team_id: number | null; evaluator_overall: number | null; coach_overall: number | null; prior_overall: number | null;
  sibling_group: number | null; kid_team_id: number | null;
};
export type TMTeam = { id: number; name: string; staff: { name: string; role: string }[] };
export type Sources = { evaluator: boolean; coach: boolean; prior: boolean };
export type TMOptions = { sources: Sources; balanceAges: boolean; seed: number };
export type TMResult = {
  teamOf: Record<number, number>;      // every player -> team
  fixed: Record<number, string>;       // player -> why they can't move (already placed, coach's kid, sibling of ...)
  rating: Record<number, number>;      // the number used to balance (median filled in)
  random: boolean;
};
export type TeamStat = { id: number; count: number; size: number; average: number | null; ages: Record<number, number> };

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export function ratingOf(p: TMPlayer, s: Sources): number | null {
  const vals = [s.evaluator && num(p.evaluator_overall), s.coach && num(p.coach_overall), s.prior && num(p.prior_overall)]
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function rng(seed: number) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Team sizes as even as possible; the extra spots go first to teams with more players already fixed. */
export function targetSizes(teams: TMTeam[], total: number, fixedCount: Record<number, number>): Record<number, number> {
  const base = Math.floor(total / Math.max(teams.length, 1));
  let extra = total - base * teams.length;
  const order = [...teams].sort((a, b) => (fixedCount[b.id] ?? 0) - (fixedCount[a.id] ?? 0) || a.name.localeCompare(b.name));
  const out: Record<number, number> = {};
  for (const t of order) { out[t.id] = base + (extra > 0 ? 1 : 0); if (extra > 0) extra--; }
  return out;
}

export function makeTeams(players: TMPlayer[], teams: TMTeam[], opts: TMOptions): TMResult {
  const rand = rng(opts.seed);
  const random = !opts.sources.evaluator && !opts.sources.coach && !opts.sources.prior;
  const raw = new Map(players.map((p) => [p.player_season_id, ratingOf(p, opts.sources)]));
  const known = [...raw.values()].filter((v): v is number => v !== null).sort((a, b) => a - b);
  const median = known.length ? (known.length % 2 ? known[(known.length - 1) / 2] : (known[known.length / 2 - 1] + known[known.length / 2]) / 2) : 3;
  const rating: Record<number, number> = {};
  for (const p of players) rating[p.player_season_id] = random ? 0 : raw.get(p.player_season_id) ?? median;
  const teamIds = new Set(teams.map((t) => t.id));
  const byId = new Map(players.map((p) => [p.player_season_id, p]));

  // Units: a sibling group moves together; anyone else alone.
  const groups = new Map<string, TMPlayer[]>();
  for (const p of players) {
    const key = p.sibling_group !== null && p.sibling_group !== undefined ? `g${p.sibling_group}` : `p${p.player_season_id}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const teamOf: Record<number, number> = {};
  const fixed: Record<number, string> = {};
  type Unit = { ids: number[]; team: number | null; score: number; ages: (number | null)[] };
  const units: Unit[] = [];
  for (const members of groups.values()) {
    // Members already on a team stay; the rest follow the first placed member, or a coach's kid's team.
    const placed = members.filter((m) => m.team_id !== null && teamIds.has(m.team_id));
    for (const m of placed) { teamOf[m.player_season_id] = m.team_id!; fixed[m.player_season_id] = "Already on this team"; }
    const free = members.filter((m) => !placed.includes(m));
    if (!free.length) continue;
    const kid = free.find((m) => m.kid_team_id !== null && teamIds.has(m.kid_team_id));
    const team = placed[0]?.team_id ?? kid?.kid_team_id ?? null;
    const why = placed[0] ? `Sibling of ${placed[0].first_name}` : kid ? (members.length > 1 ? "Coach's kid (with sibling)" : "Coach's kid") : null;
    if (team !== null) for (const m of free) fixed[m.player_season_id] = m === kid ? "Coach's kid" : why ?? "Sibling";
    else if (free.length > 1) for (const m of free) fixed[m.player_season_id] = "";  // marked below as a sibling unit
    units.push({ ids: free.map((m) => m.player_season_id), team, score: free.reduce((s, m) => s + rating[m.player_season_id], 0), ages: free.map((m) => m.league_age) });
  }

  // Sizes.
  const fixedCount: Record<number, number> = {};
  for (const id of Object.keys(teamOf)) fixedCount[teamOf[Number(id)]] = (fixedCount[teamOf[Number(id)]] ?? 0) + 1;
  for (const u of units) if (u.team !== null) fixedCount[u.team] = (fixedCount[u.team] ?? 0) + u.ids.length;
  const size = targetSizes(teams, players.length, fixedCount);
  const count: Record<number, number> = {};
  const sum: Record<number, number> = {};
  for (const t of teams) { count[t.id] = 0; sum[t.id] = 0; }
  const put = (u: Unit, team: number) => { for (const id of u.ids) { teamOf[id] = team; count[team]++; sum[team] += rating[id]; } };
  for (const id of Object.keys(teamOf)) { const t = teamOf[Number(id)]; count[t]++; sum[t] += rating[Number(id)]; }
  for (const u of units.filter((u) => u.team !== null)) put(u, u.team!);

  // The rest: highest rated first (random order when nothing is ticked), each to a team with room and the lowest total.
  const rest = units.filter((u) => u.team === null).map((u) => ({ u, r: rand() }));
  rest.sort((a, b) => (random ? a.r - b.r : b.u.score / b.u.ids.length - a.u.score / a.u.ids.length || b.u.ids.length - a.u.ids.length || a.r - b.r));
  for (const { u } of rest) {
    const room = (t: TMTeam) => size[t.id] - count[t.id];
    let options = teams.filter((t) => room(t) >= u.ids.length);
    if (!options.length) { const most = Math.max(...teams.map(room)); options = teams.filter((t) => room(t) === most); }
    const tie = new Map(options.map((t) => [t.id, rand()]));
    options.sort((a, b) => (random ? count[a.id] - count[b.id] : sum[a.id] - sum[b.id] || count[a.id] - count[b.id]) || tie.get(a.id)! - tie.get(b.id)!);
    put(u, options[0].id);
  }
  for (const u of units.filter((u) => u.team === null && u.ids.length > 1)) for (const id of u.ids) fixed[id] = "Sibling group";

  // Swaps between single players (not fixed, not in a sibling group) while the teams get more even.
  if (!random && teams.length > 1) {
    const ages = [...new Set(players.map((p) => p.league_age).filter((a): a is number => a !== null))];
    const ageCount: Record<number, Record<number, number>> = {};
    for (const t of teams) ageCount[t.id] = Object.fromEntries(ages.map((a) => [a, 0]));
    for (const p of players) { const a = p.league_age; if (a !== null) ageCount[teamOf[p.player_season_id]][a]++; }
    const ageMean = Object.fromEntries(ages.map((a) => [a, players.filter((p) => p.league_age === a).length / teams.length]));
    const RATING_WEIGHT = 400;
    const teamCost = (t: number) => {
      const avg = count[t] ? sum[t] / count[t] : 0;
      let c = 0;
      if (opts.balanceAges) for (const a of ages) c += (ageCount[t][a] - ageMean[a]) ** 2;
      return { avg, c };
    };
    const overall = players.reduce((s, p) => s + rating[p.player_season_id], 0) / Math.max(players.length, 1);
    const cost = (t: number) => { const { avg, c } = teamCost(t); return RATING_WEIGHT * (avg - overall) ** 2 + c; };
    const movable = (id: number) => !(id in fixed);
    for (let pass = 0; pass < 40; pass++) {
      let improved = false;
      for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) {
        const a = teams[i].id, b = teams[j].id;
        const inA = players.filter((p) => teamOf[p.player_season_id] === a && movable(p.player_season_id));
        const inB = players.filter((p) => teamOf[p.player_season_id] === b && movable(p.player_season_id));
        for (const x of inA) for (const y of inB) {
          if (teamOf[x.player_season_id] !== a || teamOf[y.player_season_id] !== b) continue;
          const before = cost(a) + cost(b);
          const swap = () => {
            const dx = rating[x.player_season_id], dy = rating[y.player_season_id];
            sum[a] += dy - dx; sum[b] += dx - dy;
            if (x.league_age !== null) { ageCount[a][x.league_age]--; ageCount[b][x.league_age]++; }
            if (y.league_age !== null) { ageCount[b][y.league_age]--; ageCount[a][y.league_age]++; }
            const ta = teamOf[x.player_season_id]; teamOf[x.player_season_id] = teamOf[y.player_season_id]; teamOf[y.player_season_id] = ta;
          };
          swap();
          if (cost(a) + cost(b) < before - 1e-9) improved = true;
          else { // undo: swap back (x is now on b, y on a)
            const dx = rating[x.player_season_id], dy = rating[y.player_season_id];
            sum[a] += dx - dy; sum[b] += dy - dx;
            if (x.league_age !== null) { ageCount[b][x.league_age]--; ageCount[a][x.league_age]++; }
            if (y.league_age !== null) { ageCount[a][y.league_age]--; ageCount[b][y.league_age]++; }
            teamOf[x.player_season_id] = a; teamOf[y.player_season_id] = b;
          }
        }
      }
      if (!improved) break;
    }
  }
  void byId;
  return { teamOf, fixed, rating, random };
}

/** Per team: players, average rating (players with a real rating only), and how many of each age. */
export function teamStats(players: TMPlayer[], teams: TMTeam[], teamOf: Record<number, number>, sources: Sources): TeamStat[] {
  return teams.map((t) => {
    const mine = players.filter((p) => teamOf[p.player_season_id] === t.id);
    const rated = mine.map((p) => ratingOf(p, sources)).filter((v): v is number => v !== null);
    const ages: Record<number, number> = {};
    for (const p of mine) if (p.league_age !== null) ages[p.league_age] = (ages[p.league_age] ?? 0) + 1;
    return { id: t.id, count: mine.length, size: mine.length, average: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null, ages };
  });
}

/** How far apart the team averages are (highest minus lowest), for the summary line. */
export function spread(stats: TeamStat[]): number | null {
  const avgs = stats.map((s) => s.average).filter((v): v is number => v !== null);
  return avgs.length > 1 ? Math.max(...avgs) - Math.min(...avgs) : null;
}
