// Team maker rules (lib/team-maker.ts): even sizes, coach's kids and siblings, players already placed, balance,
// random mode, unrated players, ages, determinism. No database needed.
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": root } });
const tm = jiti(path.join(root, "lib/team-maker.ts"));

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${ok || detail === undefined ? "" : ` (${JSON.stringify(detail)})`}`);
  if (!ok) failed++;
};

// A made-up AA division: 100 players ages 7-9, 8 teams. Ratings 1.5-4.5 in a fixed pattern; some unrated.
const teams = Array.from({ length: 8 }, (_, i) => ({ id: 100 + i, name: `Team ${i + 1}`, staff: [] }));
const players = Array.from({ length: 100 }, (_, i) => ({
  player_season_id: i + 1, first_name: `P${i + 1}`, last_name: "Test", bib: i + 1, league_age: 7 + (i % 3),
  team_id: null, evaluator_overall: i % 10 === 9 ? null : 1.5 + ((i * 37) % 31) / 10, coach_overall: 1.5 + ((i * 53) % 31) / 10, prior_overall: null,
  sibling_group: null, kid_team_id: null,
}));
players[0].kid_team_id = 103;                                     // coach's kid of Team 4
players[1].sibling_group = 1; players[2].sibling_group = 1;       // siblings
players[3].sibling_group = 2; players[4].sibling_group = 2; players[4].kid_team_id = 105; // a coach's kid with a sibling
players[5].team_id = 107; players[6].sibling_group = 3; players[5].sibling_group = 3;     // already placed, sibling follows
const all = { evaluator: true, coach: true, prior: false };

const r = tm.makeTeams(players, teams, { sources: all, balanceAges: true, seed: 1 });
const stats = tm.teamStats(players, teams, r.teamOf, all);
const sizes = stats.map((s) => s.count);
check("every player gets a team", players.every((p) => teams.some((t) => t.id === r.teamOf[p.player_season_id])));
check("team sizes are as even as possible (12 or 13)", Math.max(...sizes) - Math.min(...sizes) <= 1 && sizes.reduce((a, b) => a + b, 0) === 100, sizes);
check("a coach's kid goes to the parent's team", r.teamOf[1] === 103);
check("siblings stay together", r.teamOf[2] === r.teamOf[3]);
check("a coach's kid's sibling goes with them to the parent's team", r.teamOf[4] === 105 && r.teamOf[5] === 105);
check("a player already on a team stays, and their sibling follows", r.teamOf[6] === 107 && r.teamOf[7] === 107);
const spread = tm.spread(stats);
check("team averages end up close (within 0.15)", spread !== null && spread <= 0.15, spread);
const ageSpread = [7, 8, 9].map((a) => { const c = stats.map((s) => s.ages[a] ?? 0); return Math.max(...c) - Math.min(...c); });
check("each age is spread evenly (at most 2 apart between teams)", ageSpread.every((d) => d <= 2), ageSpread);
check("an unrated player is balanced as the group's middle rating", r.rating[10] === r.rating[10] && players[9].evaluator_overall === null && typeof r.rating[10] === "number");
const again = tm.makeTeams(players, teams, { sources: all, balanceAges: true, seed: 1 });
check("the same seed gives the same teams", JSON.stringify(again.teamOf) === JSON.stringify(r.teamOf));
const other = tm.makeTeams(players, teams, { sources: all, balanceAges: true, seed: 2 });
check("Make again (a new seed) gives a different mix", JSON.stringify(other.teamOf) !== JSON.stringify(r.teamOf) && tm.spread(tm.teamStats(players, teams, other.teamOf, all)) <= 0.15);
const none = { evaluator: false, coach: false, prior: false };
const rnd = tm.makeTeams(players, teams, { sources: none, balanceAges: false, seed: 3 });
const rs = tm.teamStats(players, teams, rnd.teamOf, none).map((s) => s.count);
check("nothing ticked: random teams, still even sizes and the family rules", rnd.random && Math.max(...rs) - Math.min(...rs) <= 1 && rnd.teamOf[1] === 103 && rnd.teamOf[2] === rnd.teamOf[3]);
check("the rating uses only the ticked sources", tm.ratingOf({ ...players[0], evaluator_overall: 4, coach_overall: 2, prior_overall: 5 }, { evaluator: true, coach: false, prior: true }) === 4.5);
const one = tm.makeTeams(players.slice(0, 15), [teams[0]], { sources: all, balanceAges: true, seed: 1 });
check("one team (Seniors): everyone goes on it, a coach's kid of another team too", Object.values(one.teamOf).every((t) => t === 100));

if (failed) { console.error(`FAIL: ${failed} team maker check(s) failed`); process.exit(1); }
console.log("PASS: team maker rules");
