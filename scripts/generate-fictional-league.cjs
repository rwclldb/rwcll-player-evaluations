// Generates the RWCLL fictional test league fixture files.
// Deterministic: the same inputs always produce byte-identical outputs.
//
// Inputs (hand-authored):
//   rwcll-fictional-test-league/fictional_player_roster.csv   45 scenario players with tags
//   rwcll-fictional-test-league/fictional_people.csv          admins, coaches, evaluators (emails)
//   docs/test-fixtures/sports-connect-sample-spring-2027-fake.csv   323 fake Sports Connect rows
//   lib/data/age-chart-2027.json                              official 2027 age chart
//
// Outputs: rwcll-fictional-test-league/generated/  (see README.md there)
//
// Usage: node scripts/generate-fictional-league.cjs [--people <path>]
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pack = path.join(root, "rwcll-fictional-test-league");
const outDir = path.join(pack, "generated");
const peopleIdx = process.argv.indexOf("--people");
const peoplePath = peopleIdx > -1 ? process.argv[peopleIdx + 1] : path.join(pack, "fictional_people.csv");

// ---------- CSV helpers ----------
function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((c) => c !== "")) rows.push(row); }
  const [headers, ...data] = rows;
  return data.map((cells) => Object.fromEntries(headers.map((h, i) => [h.trim(), (cells[i] ?? "").trim()])));
}
const cell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function writeCsv(relPath, headers, rows) {
  const file = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = [headers.map(cell).join(","), ...rows.map((r) => headers.map((h) => cell(r[h])).join(","))].join("\r\n") + "\r\n";
  fs.writeFileSync(file, body);
  console.log(`wrote ${path.relative(root, file)} (${rows.length} rows)`);
}

// ---------- Deterministic randomness ----------
function hashString(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seedText) {
  let a = hashString(`rwcll-2027|${seedText}`);
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (n) => Math.max(1, Math.min(5, n));

// ---------- Reference data ----------
const CORE = ["hitting", "throwing", "grounders", "fly_balls", "running_awareness"];
const PITCH = ["pitching_mechanics", "pitching_accuracy_control", "pitching_arm_strength"];
const CATCH = ["catching_receiving", "catching_blocking", "catching_throwing"];
const ALL = [...CORE, ...PITCH, ...CATCH];
const ACTIVE = new Set(["AA", "AAA", "MAJORS", "JUNIORS", "SENIORS"]);
const SC_HEADERS = ["Program Name", "Division Name", "Player Id", "Registration Number", "Account First Name", "Account Last Name", "Player First Name", "Player Last Name", "Player Gender", "Player Birth Date", "User Email", "Order Date", "Order No", "Order Payment Status"];
const chart = new Map(JSON.parse(fs.readFileSync(path.join(root, "lib/data/age-chart-2027.json"), "utf8")).map((e) => [`${e.birth_year}-${e.birth_month}`, e.league_age]));
const ageFromIso = (iso) => (iso ? chart.get(`${+iso.slice(0, 4)}-${+iso.slice(5, 7)}`) ?? null : null);
const isoToUs = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
const usToIso = (us) => { const m = us.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };
const inPoolAge = (a) => a !== null && a >= 7 && a <= 16;

const people = parseCsv(fs.readFileSync(peoplePath, "utf8"));
const person = Object.fromEntries(people.map((p) => [p.fictional_person_key, p]));
for (const p of people) if (!("email" in p)) throw new Error(`${peoplePath} has no email column (old file still in place?)`);

// ---------- 1. Players ----------
const players = [];
const PAY = { COMPLETED: "Completed", PENDING: "Pending", UNPAID: "Unpaid", UNKNOWN: "" };
const PARENTS = ["Robin", "Casey", "Morgan", "Jesse", "Terry", "Kerry", "Dana", "Shawn", "Pat", "Lee"];
for (const r of parseCsv(fs.readFileSync(path.join(pack, "fictional_player_roster.csv"), "utf8"))) {
  const n = +r.fictional_player_key.slice(4);
  const dob = r.date_of_birth_synthetic || null;
  const intended = +r.league_age_spring_2027;
  if (dob && ageFromIso(dob) !== intended) throw new Error(`${r.fictional_player_key}: birthdate ${dob} gives age ${ageFromIso(dob)}, roster says ${intended}`);
  const division = r.source_requested_division_not_final;
  players.push({
    ref: r.fictional_player_key, source: "scenario", n,
    playerId: r.sports_connect_player_id_synthetic, first: r.first_name, last: r.last_name, dob, age: intended,
    division, payment: PAY[r.spring_2027_registration_status], bib: r.spring_2027_evaluation_number || "",
    tags: r.scenario_tags, notes: r.notes,
    inPool: ACTIVE.has(division.toUpperCase()) && inPoolAge(intended),
    sc: {
      "Program Name": "2027 Spring Season", "Division Name": division, "Player Id": r.sports_connect_player_id_synthetic, "Registration Number": "",
      "Account First Name": PARENTS[n % PARENTS.length], "Account Last Name": r.last_name, "Player First Name": r.first_name, "Player Last Name": r.last_name,
      "Player Gender": n % 2 ? "Male" : "Female", "Player Birth Date": isoToUs(dob), "User Email": `family.${r.last_name.toLowerCase()}${n}@example.com`,
      "Order Date": `07/${String((n % 28) + 1).padStart(2, "0")}/2026 06:00:00 PM`, "Order No": String(92000000 + n), "Order Payment Status": PAY[r.spring_2027_registration_status],
    },
  });
}
const sample = parseCsv(fs.readFileSync(path.join(root, "docs/test-fixtures/sports-connect-sample-spring-2027-fake.csv"), "utf8"));
sample.forEach((r, i) => {
  const dob = usToIso(r["Player Birth Date"]);
  const age = ageFromIso(dob);
  players.push({
    ref: `SMP-${String(i + 1).padStart(3, "0")}`, source: "sample", playerId: r["Player Id"], first: r["Player First Name"], last: r["Player Last Name"],
    dob, age, division: r["Division Name"], payment: r["Order Payment Status"], bib: "", tags: "", notes: "",
    inPool: ACTIVE.has(r["Division Name"].toUpperCase()) && inPoolAge(age), sc: r,
  });
});
// Out-of-scope players never get bibs (they are not evaluated).
for (const p of players) if (!p.inPool) p.bib = "";
// Sample bibs: league-style blocks after the scenario bibs (201-245): 301+ ordered by age, last, first.
let nextBib = 301;
for (const p of players.filter((p) => p.source === "sample" && p.inPool).sort((a, b) => a.age - b.age || a.last.localeCompare(b.last) || a.first.localeCompare(b.first) || a.ref.localeCompare(b.ref))) p.bib = String(nextBib++);
const bibs = players.filter((p) => p.bib).map((p) => p.bib);
if (new Set(bibs).size !== bibs.length) throw new Error("bib numbers are not unique");
const byRef = Object.fromEntries(players.map((p) => [p.ref, p]));
const idCounts = players.reduce((m, p) => m.set(p.playerId, (m.get(p.playerId) ?? 0) + 1), new Map());

// ---------- 2. Sports Connect files + scenario notes ----------
const scenario = players.filter((p) => p.source === "scenario");
writeCsv("sports-connect-spring-2027-scenarios.csv", SC_HEADERS, scenario.map((p) => p.sc));
writeCsv("sports-connect-spring-2027-full.csv", SC_HEADERS, players.map((p) => p.sc));

function expectedImport(p) {
  const out = [];
  if (!ACTIVE.has(p.division.toUpperCase())) out.push("Division needs review; out of scope; keep out of evaluation pool");
  if (!p.dob) out.push("Birthdate missing; admin must review before the player has an age group");
  if (idCounts.get(p.playerId) > 1) out.push("Duplicate Player Id in file; treat as two separate players, never merge");
  if (p.payment === "") out.push("Blank payment status stored as UNKNOWN; still eligible");
  if (!p.bib && p.inPool) out.push("No evaluation number supplied; flag, do not invent one");
  return out.length ? out.join(" | ") : "Commit as new player";
}
writeCsv("scenario-notes.csv",
  ["Fixture Key", "Player Id", "Player First Name", "Player Last Name", "Player Birth Date", "League Age", "Requested Division", "Payment Status", "Evaluation Number", "Scenario Tags", "Expected Import Result", "Notes"],
  scenario.map((p) => ({ "Fixture Key": p.ref, "Player Id": p.playerId, "Player First Name": p.first, "Player Last Name": p.last, "Player Birth Date": isoToUs(p.dob), "League Age": p.age, "Requested Division": p.division, "Payment Status": p.payment || "(blank)", "Evaluation Number": p.bib, "Scenario Tags": p.tags, "Expected Import Result": expectedImport(p), Notes: p.notes })));

// ---------- 3. Bib (evaluation number) upload files ----------
const withBib = players.filter((p) => p.bib);
writeCsv("bib-numbers-by-player-id.csv", ["Player Id", "Player First Name", "Player Last Name", "Evaluation Number"],
  withBib.map((p) => ({ "Player Id": p.playerId, "Player First Name": p.first, "Player Last Name": p.last, "Evaluation Number": p.bib })));
writeCsv("bib-numbers-by-name-and-birthdate.csv", ["Player First Name", "Player Last Name", "Player Birth Date", "Evaluation Number"],
  withBib.filter((p) => p.dob).map((p) => ({ "Player First Name": p.first, "Player Last Name": p.last, "Player Birth Date": isoToUs(p.dob), "Evaluation Number": p.bib })));
const firstSample = players.find((p) => p.source === "sample" && p.inPool);
const outOfScope = players.find((p) => p.source === "sample" && !p.inPool);
writeCsv("bib-numbers-with-errors.csv", ["Player Id", "Player First Name", "Player Last Name", "Player Birth Date", "Evaluation Number", "Expected Result"], [
  { "Player Id": "77100001", "Player First Name": "Alex", "Player Last Name": "Arbor", "Player Birth Date": isoToUs(byRef["PLY-001"].dob), "Evaluation Number": "201", "Expected Result": "Accepted" },
  { "Player Id": "77100002", "Player First Name": "Bailey", "Player Last Name": "Hayes", "Player Birth Date": isoToUs(byRef["PLY-002"].dob), "Evaluation Number": "201", "Expected Result": "Rejected: bib 201 already used by another player in this file" },
  { "Player Id": "77100003", "Player First Name": "Cameron", "Player Last Name": "Oak", "Player Birth Date": isoToUs(byRef["PLY-003"].dob), "Evaluation Number": "A12", "Expected Result": "Rejected: bib is not a whole number" },
  { "Player Id": "77100004", "Player First Name": "Dakota", "Player Last Name": "Vale", "Player Birth Date": isoToUs(byRef["PLY-004"].dob), "Evaluation Number": "", "Expected Result": "Rejected: bib is blank" },
  { "Player Id": "99999999", "Player First Name": "Nobody", "Player Last Name": "Known", "Player Birth Date": "01/01/2015", "Evaluation Number": "990", "Expected Result": "Rejected: no registered player matches" },
  { "Player Id": "77100077", "Player First Name": "", "Player Last Name": "", "Player Birth Date": "", "Evaluation Number": "991", "Expected Result": "Needs review: Player Id 77100077 belongs to two players (PLY-007, PLY-008)" },
  { "Player Id": outOfScope.playerId, "Player First Name": outOfScope.first, "Player Last Name": outOfScope.last, "Player Birth Date": isoToUs(outOfScope.dob), "Evaluation Number": "992", "Expected Result": `Rejected: player is not in the evaluation pool (${outOfScope.division})` },
  { "Player Id": "77100005", "Player First Name": "Elliot", "Player Last Name": "Carter", "Player Birth Date": isoToUs(byRef["PLY-005"].dob), "Evaluation Number": "205", "Expected Result": "Accepted" },
  { "Player Id": "77100005", "Player First Name": "Elliot", "Player Last Name": "Carter", "Player Birth Date": isoToUs(byRef["PLY-005"].dob), "Evaluation Number": "993", "Expected Result": "Rejected: same player listed twice with different bibs" },
  { "Player Id": firstSample.playerId, "Player First Name": firstSample.first, "Player Last Name": firstSample.last, "Player Birth Date": isoToUs(firstSample.dob), "Evaluation Number": "245", "Expected Result": "Rejected: bib 245 already belongs to PLY-045 in the database" },
]);

// ---------- 4. Player ability model (shared by prior-year and current scores) ----------
const ability = {};
function abilityOf(p) {
  if (ability[p.ref]) return ability[p.ref];
  const r = rng(`ability|${p.ref}`);
  const base = 1.6 + r() * 2.8; // 1.6 .. 4.4
  const a = Object.fromEntries(ALL.map((k) => [k, base + (r() - 0.5) * 1.4]));
  a.pitcher = r() < 0.35; a.catcher = r() < 0.2;
  return (ability[p.ref] = a);
}
function score(p, skill, raterKey, label) {
  const r = rng(`score|${label}|${p.ref}|${raterKey}|${skill}`);
  const x = r(); const noise = x < 0.15 ? -1 : x > 0.85 ? 1 : 0;
  return clamp(Math.round(abilityOf(p)[skill] + noise));
}

// ---------- 5. Prior-year (Spring 2026) end-of-season coach ratings ----------
const COACH_2026 = { "COA-01": "Avery Linden", "COA-02": "Bailey Marsh", "COA-03": "Cameron Reyes", "COA-05": "Elliott Brandt", "COA-06": "Finley Moss", "COA-07": "Gray Whitfield", "COA-09": "Indigo Ferris" };
const div2026 = (age2027) => { const a = age2027 - 1; return a <= 8 ? "AA" : a <= 10 ? "AAA" : a <= 12 ? "Majors" : a <= 14 ? "Juniors" : "Seniors"; };
const HIST_HEADERS = ["Season", "Division", "Team", "Coach Name", "Player Id", "Player First Name", "Player Last Name", "Player Birth Date", ...ALL, "Fixture Note"];
const histRows = []; const histExpected = [];
function histRow(ref, coachKey, scores, opts = {}) {
  const p = byRef[ref] ?? opts.player;
  const div = div2026(p.age);
  const row = { Season: "Spring 2026", Division: div, Team: `${div} ${COACH_2026[coachKey].split(" ")[1]}`, "Coach Name": COACH_2026[coachKey],
    "Player Id": opts.playerId ?? p.playerId, "Player First Name": opts.first ?? p.first, "Player Last Name": opts.last ?? p.last, "Player Birth Date": isoToUs(opts.dob ?? p.dob), "Fixture Note": opts.note ?? "" };
  for (const k of ALL) row[k] = scores[k] ?? "";
  histRows.push(row);
  histExpected.push({ "Row": histRows.length, "Player First Name": row["Player First Name"], "Player Last Name": row["Player Last Name"], "Expected Match": opts.expected ?? ref, "Admin Action": opts.action ?? "Confirm match", Reason: opts.reason ?? "Player Id, name, and birthdate all agree" });
}
const S = (h, t, g, f, r, extra = {}) => ({ hitting: h, throwing: t, grounders: g, fly_balls: f, running_awareness: r, ...extra });
histRow("PLY-017", "COA-01", S(4, 3, 3, 3, 4, { pitching_mechanics: 3, pitching_accuracy_control: 3, pitching_arm_strength: 4 }), { note: "Complete, with pitching" });
histRow("PLY-018", "COA-01", S(3, 3, 4, 3, 3), { note: "Complete" });
histRow("PLY-019", "COA-01", S(4, 4, 3, 3, 4), { playerId: "77100019", note: "Player Id changed for 2027 (now 77100919)", action: "Review, then confirm", reason: "Name and birthdate agree; Player Id differs" });
histRow("PLY-020", "COA-01", S(3, 4, 4, 3, 3), { playerId: "77100920", note: "2026 Player Id differs from 2027", action: "Review, then confirm", reason: "Name and birthdate agree; Player Id differs" });
histRow("PLY-021", "COA-06", S(4, 3, 3, 4, 4), { first: "Umaya", note: "Name changed (2027: Uma)", action: "Review, then confirm", reason: "Player Id and birthdate agree; first name differs" });
histRow("PLY-026", "COA-02", S(3, 4, "", "", 3), { note: "Grounders and fly balls left blank by coach; blank is not zero" });
histRow("PLY-027", "COA-02", S(2, 3, 3, 3, 3), { note: "Co-rated with Cameron Reyes; they disagree on hitting" });
histRow("PLY-027", "COA-03", S(5, 4, 4, 4, 4), { note: "Co-rated with Bailey Marsh" });
histRow("PLY-028", "COA-02", S(5, 3, 3, 3, 3, { catching_receiving: 3, catching_blocking: 3, catching_throwing: 2 }), { note: "Co-rated; includes catching" });
histRow("PLY-028", "COA-03", S(2, 4, 4, 4, 4), { note: "Co-rated with Bailey Marsh" });
for (const [ref, s] of [["PLY-031", S(3, 3, 3, 4, 3)], ["PLY-032", S(4, 4, 4, 4, 5)], ["PLY-034", S(2, 3, 2, 3, 3)], ["PLY-035", S(3, 4, 3, 3, 4)]]) histRow(ref, "COA-05", s, { note: 'Coach name spelled "Elliott" in source; account is "Elliot"' });
histRow("PLY-038", "COA-06", S(3, 4, 3, 3, 4), { note: "Intended match; see next row for a look-alike" });
histRow("PLY-038", "COA-06", S(2, 2, 3, 2, 2), { player: byRef["PLY-038"], first: "Micah", last: "Oakes", playerId: "77100938", dob: byRef["PLY-038"].dob.slice(0, 8) + "02",
  note: "Look-alike: similar name, same birth month, different Player Id", expected: "UNMATCHED", action: "Keep unmatched", reason: "Different last name, birth day, and Player Id; not PLY-038" });
histRow("PLY-039", "COA-09", S(4, "", 3, "", ""), { note: "Partial spreadsheet; other skills missing" });
for (const [ref, s] of [["PLY-040", S(4, 4, 4, 3, 4)], ["PLY-041", S(3, 2, 3, 3, 2)], ["PLY-042", S(5, 4, 5, 4, 4, { catching_receiving: 4, catching_blocking: 5, catching_throwing: 4 })]]) histRow(ref, "COA-07", s, { note: "Coach not returning in 2027; keep source name" });
histRow("PLY-018", "COA-03", S(2, 2, 2, 2, 2), { player: byRef["PLY-018"], first: "Kit", last: "Lindqvist", playerId: "77100999", dob: "2015-02-02",
  note: "Played 2026, did not register for 2027", expected: "UNMATCHED", action: "Keep unmatched", reason: "No 2027 registration" });
// Sparse prior-year data for the bulk sample: about 8% of returning-age players.
const COACH_KEYS_2026 = Object.keys(COACH_2026);
for (const p of players.filter((p) => p.source === "sample" && p.inPool && p.age >= 8)) {
  const r = rng(`hist|${p.ref}`);
  if (r() >= 0.08) continue;
  const coach = COACH_KEYS_2026[Math.floor(r() * COACH_KEYS_2026.length)];
  const s = Object.fromEntries(CORE.map((k) => [k, score(p, k, coach, "2026")]));
  if (abilityOf(p).pitcher && r() < 0.5) for (const k of PITCH) s[k] = score(p, k, coach, "2026");
  histRow(p.ref, coach, s, { note: "" });
}
writeCsv("spring-2026-coach-ratings.csv", HIST_HEADERS, histRows);
writeCsv("spring-2026-expected-matches.csv", ["Row", "Player First Name", "Player Last Name", "Expected Match", "Admin Action", "Reason"], histExpected);

// ---------- 6. Scored dataset: Spring 2027 evaluations ----------
const COACHES_BY_AGE = { 7: ["COA-01", "COA-02", "COA-03"], 8: ["COA-01", "COA-02", "COA-03"], 9: ["COA-03", "COA-04", "COA-05"], 10: ["COA-03", "COA-04", "COA-05"],
  11: ["COA-05", "COA-06", "COA-08"], 12: ["COA-05", "COA-06", "COA-08"], 13: ["COA-08", "COA-09", "COA-10"], 14: ["COA-08", "COA-09", "COA-10"], 15: ["COA-09", "COA-10", "COA-01"], 16: ["COA-09", "COA-10", "COA-01"] };
const IES_BY_AGE = (a) => [a <= 9 && "EVA-01", a >= 10 && a <= 12 && "EVA-02", a >= 13 && "EVA-03", a >= 11 && a <= 13 && "EVA-04", a >= 14 && "EVA-06"].filter(Boolean);
const NO_EVALS = new Set(["PLY-013", "PLY-014", "PLY-044"]);
const evals = [];
for (const p of players.filter((p) => p.inPool)) {
  if (NO_EVALS.has(p.ref)) continue;
  const coaches = COACHES_BY_AGE[p.age]; const ies = IES_BY_AGE(p.age);
  let raters = [...coaches.map((k) => [k, "coach"]), ...ies.map((k) => [k, "independent_evaluator"])];
  if (p.source === "sample") raters = raters.filter(([k]) => rng(`present|${p.ref}|${k}`)() < 0.92 || k.startsWith("EVA"));
  if (p.ref === "PLY-012") raters = raters.filter(([k, t]) => t === "independent_evaluator" || k === coaches[0]);
  for (const [key, type] of raters) {
    const r = rng(`eval|${p.ref}|${key}`);
    let status = "submitted"; const s = {}; let note = "";
    const ab = abilityOf(p);
    for (const k of CORE) s[k] = score(p, k, key, "2027");
    if (ab.pitcher && r() < 0.75) for (const k of PITCH) s[k] = score(p, k, key, "2027");
    if (ab.catcher && r() < 0.75) for (const k of CATCH) s[k] = score(p, k, key, "2027");
    if (p.source === "sample") {
      const x = r();
      if (x < 0.01) { status = "not_evaluated"; note = "Random not-evaluated"; }
      else if (x < 0.04) { status = "draft"; note = "Random unsubmitted draft; excluded from averages"; }
      else if (x < 0.06) { const k = CORE[Math.floor(r() * 5)]; s[k] = ""; note = `Submitted with ${k} blank`; }
    }
    switch (p.ref) {
      case "PLY-001": case "PLY-002": for (const k of ALL) s[k] = ""; Object.assign(s, S(4, 3, 4, 3, 4)); note = "PLY-001 and PLY-002 tie exactly"; break;
      case "PLY-011": for (const k of ALL) if (k !== "hitting") s[k] = ""; note = "Injured; hit only"; break;
      case "PLY-043": if (type === "independent_evaluator") { status = "not_evaluated"; note = "Injured; evaluator marked not evaluated"; } else { for (const k of ALL) if (k !== "hitting" && k !== "running_awareness") s[k] = ""; note = "Injured; hitting and running only"; } break;
      case "PLY-023": case "PLY-024": for (const k of [...PITCH, ...CATCH]) s[k] = ""; note = "No pitching or catching scored"; break;
      case "PLY-025": if (key === coaches[0]) { status = "not_evaluated"; note = "Coach marked not evaluated; not a zero"; } break;
      case "PLY-026": if (key === ies[0]) { s.grounders = ""; note = "Submitted with grounders blank; must be flagged"; } break;
      case "PLY-027": if (key === "EVA-02") { Object.assign(s, S(5, 5, 5, 5, 5)); note = "Disagreement: EVA-02 high"; } if (key === "EVA-04") { Object.assign(s, S(2, 2, 2, 2, 2)); note = "Disagreement: EVA-04 low"; } break;
      case "PLY-028": if (key === "EVA-02") { Object.assign(s, S(2, 2, 2, 2, 2)); note = "Disagreement: EVA-02 low"; } if (key === "EVA-04") { Object.assign(s, S(5, 5, 5, 5, 5)); note = "Disagreement: EVA-04 high"; } break;
      case "PLY-035": case "PLY-036": if (key === "COA-10") { status = "draft"; note = "Never submitted; excluded from averages"; } break;
    }
    if (status === "not_evaluated") for (const k of ALL) s[k] = "";
    evals.push({ p, key, type, status, s, note });
  }
}
writeCsv("scored/spring-2027-evaluations.csv",
  ["Evaluator Key", "Evaluator Email", "Evaluator Type", "Fixture Key", "Player Id", "Evaluation Number", "Player First Name", "Player Last Name", "Player Birth Date", "League Age", "Status", ...ALL, "Fixture Note"],
  evals.map((e) => ({ "Evaluator Key": e.key, "Evaluator Email": person[e.key].email, "Evaluator Type": e.type, "Fixture Key": e.p.ref, "Player Id": e.p.playerId, "Evaluation Number": e.p.bib,
    "Player First Name": e.p.first, "Player Last Name": e.p.last, "Player Birth Date": isoToUs(e.p.dob), "League Age": e.p.age, Status: e.status, ...e.s, "Fixture Note": e.note })));

// ---------- 7. Expected draft report values ----------
// Rule (docs/DECISIONS.md 2026-11-10): only submitted evaluations count; blanks are skipped, never zero;
// skill average = mean of non-blank ratings; overall = mean of available core skill averages;
// pitching/catching = mean of available sub-skill averages. Coach and evaluator kept separate.
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (x) => (x === null ? "" : x.toFixed(2));
function summarize(rows) {
  const skill = Object.fromEntries(ALL.map((k) => [k, mean(rows.map((r) => r[k]).filter((v) => v !== "" && v !== undefined).map(Number))]));
  const avail = (ks) => ks.map((k) => skill[k]).filter((v) => v !== null);
  return { skill, overall: mean(avail(CORE)), pitching: mean(avail(PITCH)), catching: mean(avail(CATCH)) };
}
const histByRef = {};
histExpected.forEach((m, i) => { if (m["Expected Match"] !== "UNMATCHED") (histByRef[m["Expected Match"]] ??= []).push(histRows[i]); });
const reportHeaders = ["Fixture Key", "Player Id", "Evaluation Number", "Player First Name", "Player Last Name", "League Age",
  "Coach Overall", "Coach Evaluations", ...CORE.map((k) => `Coach ${k}`), "Coach Pitching", "Coach Catching",
  "Evaluator Overall", "Evaluator Evaluations", ...CORE.map((k) => `Evaluator ${k}`), "Evaluator Pitching", "Evaluator Catching",
  "Prior-Year Overall", "Prior-Year Ratings", "Blank Core Skills (submitted)", "Not Evaluated Marks", "Drafts Excluded", "Flags"];
const report = [];
for (const p of players.filter((p) => p.inPool)) {
  const mine = evals.filter((e) => e.p === p);
  const sub = (t) => mine.filter((e) => e.type === t && e.status === "submitted").map((e) => e.s);
  const c = summarize(sub("coach")); const v = summarize(sub("independent_evaluator")); const h = summarize(histByRef[p.ref] ?? []);
  const blanks = mine.filter((e) => e.status === "submitted").reduce((n, e) => n + CORE.filter((k) => e.s[k] === "").length, 0);
  const flags = [!p.bib && "No evaluation number", !mine.some((e) => e.status === "submitted") && "No submitted evaluations", blanks && "Blank core skills", !p.dob && "Birthdate missing (age set by admin)"].filter(Boolean).join(" | ");
  const row = { "Fixture Key": p.ref, "Player Id": p.playerId, "Evaluation Number": p.bib, "Player First Name": p.first, "Player Last Name": p.last, "League Age": p.age,
    "Coach Overall": fmt(c.overall), "Coach Evaluations": sub("coach").length, "Coach Pitching": fmt(c.pitching), "Coach Catching": fmt(c.catching),
    "Evaluator Overall": fmt(v.overall), "Evaluator Evaluations": sub("independent_evaluator").length, "Evaluator Pitching": fmt(v.pitching), "Evaluator Catching": fmt(v.catching),
    "Prior-Year Overall": fmt(h.overall), "Prior-Year Ratings": (histByRef[p.ref] ?? []).length, "Blank Core Skills (submitted)": blanks,
    "Not Evaluated Marks": mine.filter((e) => e.status === "not_evaluated").length, "Drafts Excluded": mine.filter((e) => e.status === "draft").length, Flags: flags };
  for (const k of CORE) { row[`Coach ${k}`] = fmt(c.skill[k]); row[`Evaluator ${k}`] = fmt(v.skill[k]); }
  report.push(row);
}
report.sort((a, b) => a["League Age"] - b["League Age"] || (+b["Evaluator Overall"] || 0) - (+a["Evaluator Overall"] || 0) || a["Fixture Key"].localeCompare(b["Fixture Key"]));
writeCsv("scored/expected-draft-report.csv", reportHeaders, report);

// ---------- Summary ----------
const pool = players.filter((p) => p.inPool);
const perAge = pool.reduce((m, p) => ({ ...m, [p.age]: (m[p.age] ?? 0) + 1 }), {});
console.log(`\nplayers: ${players.length} total, ${pool.length} in evaluation pool, ${players.length - pool.length} out of pool`);
console.log(`per age: ${Object.entries(perAge).map(([a, n]) => `${a}:${n}`).join("  ")}`);
console.log(`prior-year rows: ${histRows.length}; evaluations: ${evals.length} (${evals.filter((e) => e.status === "submitted").length} submitted, ${evals.filter((e) => e.status === "draft").length} draft, ${evals.filter((e) => e.status === "not_evaluated").length} not evaluated)`);
