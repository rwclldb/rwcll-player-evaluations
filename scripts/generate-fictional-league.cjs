// Generates the RWCLL fictional test league fixture files.
// Deterministic: the same inputs always produce byte-identical outputs.
//
// Inputs (hand-authored):
//   rwcll-fictional-test-league/fictional_player_roster.csv   45 scenario players with tags
//   rwcll-fictional-test-league/fictional_people.csv          admins, coaches, evaluators (emails)
//   docs/test-fixtures/sports-connect-sample-spring-2027-fake.csv   323 fake Sports Connect rows
//   (plus generated draft players, families and team staff: section 1b)
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
// ---------- 1b. Draft-sized league (decided 2026-11-21) ----------
// Realistic division sizes for the draft, and families that exercise the draft rules:
//   Majors ~110 asking (68 twelves), 8 teams of 12, so 10-11s fall to AAA; AAA 8 teams of 12, so some 8-9s fall
//   to AA; AA ~100 (teams made by the generator); Juniors 26 (2 teams of 13); Seniors 15 (1 team).
// Seven sample Seniors move to "Senior Softball" (out of scope); with the Athletics manager's son that makes 15.
const seniorsOut = players.filter((p) => p.source === "sample" && p.inPool && p.division.toUpperCase() === "SENIORS").slice(-7);
for (const p of seniorsOut) { p.division = "Senior Softball"; p.sc = { ...p.sc, "Division Name": "Senior Softball" }; p.inPool = false; }

const DRF_FIRST = ["Ari", "Blake", "Cruz", "Drew", "Eden", "Flynn", "Gale", "Hollis", "Ira", "Jules", "Kai", "Lane", "Milo", "Nash", "Oakley", "Parker",
  "Quinn", "Reese", "Sage", "Tate", "Uri", "Vaughn", "Wren", "Xavi", "Yuri", "Zane", "Arlo", "Bodhi", "Cyrus", "Dax", "Emery", "Finch", "Gus", "Hank",
  "Idris", "Jett", "Koa", "Leif", "Mack", "Nico", "Otis", "Pax", "Rhys", "Silas", "Theo", "Vince", "Wade", "Zeke"];
const DRF_LAST = ["Abernathy", "Bellamy", "Castellano", "Delacroix", "Esposito", "Fairbanks", "Galloway", "Hargrove", "Iverson", "Jablonski", "Kowalczyk",
  "Lindgren", "Montague", "Nakamura", "Okonkwo", "Pemberton", "Quintero", "Rasmussen", "Sandoval", "Thibodeaux", "Underwood", "Valenzuela", "Whitaker",
  "Yamamoto", "Zielinski", "Ashby", "Brennan", "Calloway", "Donovan", "Eastwood", "Fitzgerald", "Gallagher", "Holloway", "Ingram", "Jamison", "Kingsley",
  "Lockhart", "Maddox", "Northcott", "Prescott", "Radcliffe", "Sinclair", "Tremblay", "Wexler"];
const monthsFor = (age) => [...chart.entries()].filter(([, a]) => a === age).map(([k]) => k);
let drfN = 0;
function addDraftPlayer({ first, last, age, division, family = null, twinOf = null, email = null, note = "" }) {
  drfN++;
  const ref = `DRF-${String(drfN).padStart(3, "0")}`;
  const r = rng(`drf|${ref}`);
  let dob = twinOf?.dob;
  if (!dob) {
    const ms = monthsFor(age);
    const [y, m] = ms[Math.floor(r() * ms.length)].split("-");
    dob = `${y}-${m.padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`;
  }
  if (ageFromIso(dob) !== age) throw new Error(`${ref}: birthdate ${dob} gives age ${ageFromIso(dob)}, wanted ${age}`);
  first ??= DRF_FIRST[Math.floor(r() * DRF_FIRST.length)];
  last ??= DRF_LAST[Math.floor(r() * DRF_LAST.length)];
  const p = {
    ref, source: "draft", n: drfN, playerId: String(77300000 + drfN), first, last, dob, age, division, payment: "Completed", bib: String(600 + drfN),
    tags: family ? `FAMILY_${family}` : "", notes: note, family, inPool: true,
    sc: {
      "Program Name": "2027 Spring Season", "Division Name": division, "Player Id": String(77300000 + drfN), "Registration Number": "",
      "Account First Name": PARENTS[drfN % PARENTS.length], "Account Last Name": last, "Player First Name": first, "Player Last Name": last,
      "Player Gender": drfN % 2 ? "Male" : "Female", "Player Birth Date": isoToUs(dob),
      // Siblings share the family's account email: the import suggests them as siblings from it.
      "User Email": email ?? `family.${last.toLowerCase()}.${(family ?? ref).toLowerCase()}@example.com`,
      "Order Date": `08/${String((drfN % 28) + 1).padStart(2, "0")}/2026 06:00:00 PM`, "Order No": String(93000000 + drfN), "Order Payment Status": "Completed",
    },
  };
  players.push(p);
  return p;
}

// Team staff (the Sports Connect volunteer report, one row per person) and accounts for the new people.
const STAFF_FIRST = ["Morgan", "Riley", "Sam", "Taylor", "Jordan", "Casey", "Alex", "Robin", "Jesse", "Kerry", "Dana", "Shawn", "Pat", "Lee", "Chris",
  "Devon", "Emerson", "Frankie", "Glen", "Hayden", "Jody", "Kim", "Logan", "Marlow", "Noel", "Peyton", "Rowan", "Skyler", "Toby", "Val"];
const STAFF_LAST = ["Ortiz", "Nguyen", "Patel", "Kowalski", "Bennett", "Chandler", "Dalton", "Ellison", "Forbes", "Garrison", "Hensley", "Irwin",
  "Jarvis", "Keller", "Lawson", "Mercer", "Nolan", "Osborne", "Pruitt", "Ramsey", "Sutherland", "Tanner", "Upton", "Vickers", "Walsh", "Yates"];
const staffPeople = new Map(); // email -> { first, last, key }
let staffN = 0;
function newStaff() {
  const first = STAFF_FIRST[staffN % STAFF_FIRST.length];
  const last = STAFF_LAST[(staffN * 7) % STAFF_LAST.length];
  staffN++;
  const email = `${first}.${last}@example.com`.toLowerCase();
  if (staffPeople.has(email)) throw new Error(`duplicate staff email ${email}`);
  staffPeople.set(email, { first, last, key: `STF-${String(staffN).padStart(2, "0")}` });
  return email;
}
const existing = (key) => ({ email: person[key].email, first: person[key].first_name, last: person[key].last_name });
const staffRows = [];
function staff(division, team, role, who) {
  const e = typeof who === "string" ? { email: who, ...staffPeople.get(who) } : who;
  staffRows.push({ "Program Name": "2027 Spring Season", "Division Name": division, "Team Name": team, "Volunteer Role": role,
    "Volunteer First Name": e.first, "Volunteer Last Name": e.last, "Volunteer Email Address": e.email });
  return e.email;
}
const TEAMS = {
  Majors: ["Giants", "Cubs", "Mets", "Rays", "Pirates", "Tigers", "Orioles", "Padres"],
  AAA: ["Astros", "Braves", "Cardinals", "Dodgers", "Mariners", "Reds", "Rockies", "Royals"],
  Juniors: ["Angels", "Nationals"],
  Seniors: ["Athletics"],
  AA: ["Blue Jays", "Brewers", "Diamondbacks", "Guardians", "Marlins", "Phillies", "Rangers", "Twins"],
};
// Who runs which team. Existing fixture coaches take some jobs; everyone else is a new account.
const roleOf = {};
const pick = (division, team, role, who) => { roleOf[`${division}|${team}|${role}`] = staff(division, team, role, who); };
pick("Majors", "Giants", "Team Manager", existing("COA-05"));   // Elliot Brandt: manager with twin 12-year-olds
pick("Majors", "Cubs", "Team Manager", existing("COA-06"));     // Finley Moss: also coaches in AAA (two divisions)
pick("Majors", "Mets", "Team Manager", existing("COA-08"));     // Harper Quill: kid is 9 (too young for Majors)
pick("Juniors", "Angels", "Team Manager", existing("COA-09"));  // Indigo Ferris
pick("Seniors", "Athletics", "Team Manager", existing("COA-10")); // Jamie Sutton
pick("AA", "Blue Jays", "Team Manager", existing("COA-01"));    // Avery Linden
pick("AA", "Brewers", "Team Manager", existing("COA-02"));      // Bailey Marsh
pick("AAA", "Astros", "Team Manager", existing("COA-03"));      // Cameron Reyes
pick("AAA", "Braves", "Team Manager", existing("COA-04"));      // Dakota Shore
pick("AAA", "Braves", "Coach", existing("COA-06"));             // Finley Moss again (Majors Cubs manager)
pick("Majors", "Rays", "Team Manager", newStaff());
const raysManager = roleOf["Majors|Rays|Team Manager"];
pick("AAA", "Astros", "Coach", { email: raysManager, ...staffPeople.get(raysManager) }); // manages Rays (Majors), coaches Astros (AAA)
for (const [division, teams] of Object.entries(TEAMS)) {
  for (const team of teams) {
    if (!roleOf[`${division}|${team}|Team Manager`]) pick(division, team, "Team Manager", newStaff());
    if (!roleOf[`${division}|${team}|Coach`]) pick(division, team, "Coach", newStaff());
  }
}
const piratesAssistant = newStaff();
staff("Majors", "Pirates", "Assistant Coach", piratesAssistant);  // assistant: their kid gets no privilege
staff("AAA", "Reds", "Assistant Coach", newStaff());
staff("AA", "Twins", "Assistant Coach", newStaff());
const unallocated = newStaff();
staff("AA", "Unallocated", "Coach", unallocated);                 // volunteer not placed on a team yet: skipped by the upload
staffRows.push({ "Program Name": "2027 Spring Season", "Division Name": "Majors", "Team Name": "Giants", "Volunteer Role": "Team Parent",
  "Volunteer First Name": "Sky", "Volunteer Last Name": "Helper", "Volunteer Email Address": "team.parent@example.com" }); // not a coach role: skipped

// Families: coach's kids, twins and siblings. "group" = the loader confirms the sibling group (otherwise it stays a
// suggestion from the shared account email). "parent" = linked as that coach's kid.
const families = [];
// A coach's kid shares the parent's last name.
const lastOf = (email) => staffPeople.get(email)?.last ?? people.find((p) => p.email === email)?.last_name;
function family(key, scenario, kids, { parent = null, group = true, email = null } = {}) {
  let first = null;
  for (const k of kids) {
    const p = addDraftPlayer({ ...k, family: key, twinOf: k.twin ? first : null, email, note: scenario });
    first ??= p;
    families.push({ Family: key, "Fixture Key": p.ref, "Player First Name": p.first, "Player Last Name": p.last, "League Age": p.age,
      "Requested Division": p.division, "Parent Email": k.kid === false ? "" : parent ?? "", "Confirm Siblings": kids.length > 1 && group ? "YES" : "NO", Scenario: scenario });
  }
}
const M = (age) => ({ age, division: "Majors" });
family("F01", "Twin 12-year-olds of the Giants manager: rounds 1 and 2 go to them automatically",
  [{ first: "Mateo", last: "Ramirez", ...M(12) }, { first: "Lucia", last: "Ramirez", ...M(12), twin: true }], { parent: roleOf["Majors|Giants|Team Manager"] });
family("F02", "Cubs manager's 12-year-old and Cubs coach's 11-year-old (different families, same team)",
  [{ first: "Owen", last: "Moss", ...M(12) }], { parent: roleOf["Majors|Cubs|Team Manager"] });
family("F03", "Cubs coach's 11-year-old who asked for Majors: the team's round-2 coach's kid",
  [{ first: "Ivy", last: lastOf(roleOf["Majors|Cubs|Coach"]), ...M(11) }], { parent: roleOf["Majors|Cubs|Coach"] });
family("F04", "Mets manager's 9-year-old: too young for Majors, so a regular AAA player (no privilege there)",
  [{ first: "Penny", last: "Quill", age: 9, division: "AAA" }], { parent: roleOf["Majors|Mets|Team Manager"] });
family("F05", "Rays manager also coaches AAA Astros. Both kids are Rays coach's kids in Majors (the 10 too, though she asked for AAA: coach's kids are must-draft); take her out of the Majors pool to let her play AAA for Astros",
  [{ first: "Gabe", last: lastOf(raysManager), ...M(12) }, { first: "Nora", last: lastOf(raysManager), age: 10, division: "AAA" }], { parent: raysManager });
family("F06", "Siblings: a 12 and a 10 who asked for Majors. Picking the 12 asks about the 10 (take or send down)",
  [{ first: "Tess", last: "Whitaker", ...M(12) }, { first: "Leo", last: "Whitaker", ...M(10) }]);
family("F07", "Siblings: a 12 (Majors) and an 11 who asked for AAA. Different pools, so no sibling rule in Majors",
  [{ first: "Hugo", last: "Lindgren", ...M(12) }, { first: "Maya", last: "Lindgren", age: 11, division: "AAA" }]);
family("F08", "Twin 11-year-olds who asked for Majors: picking one asks about the other",
  [{ first: "Eli", last: "Nakamura", ...M(11) }, { first: "Ada", last: "Nakamura", ...M(11), twin: true }]);
family("F09", "Siblings in AAA: an 11 (must draft) and a 9 who asked for AAA",
  [{ first: "Sol", last: "Galloway", age: 11, division: "AAA" }, { first: "June", last: "Galloway", age: 9, division: "AAA" }]);
family("F10", "Siblings: a 10 (AAA) and an 8 (AA): different pools; AA teams keep them together later",
  [{ first: "Rex", last: "Prescott", age: 10, division: "AAA" }, { first: "Bea", last: "Prescott", age: 8, division: "AA" }]);
family("F11", "Pirates assistant coach's 12-year-old: assistants get no coach's-kid privilege (not linked)",
  [{ first: "Cole", last: lastOf(piratesAssistant), ...M(12), kid: false }]);
family("F12", "Not confirmed: two players on one family account, left as a sibling suggestion",
  [{ first: "Ivo", last: "Sinclair", ...M(10) }, { first: "Lily", last: "Sinclair", age: 8, division: "AA" }], { group: false });
family("F13", "Registered with the Tigers coach's own sign-in email: suggested as that coach's kid (not linked)",
  [{ first: "Sami", last: lastOf(roleOf["Majors|Tigers|Coach"]), ...M(12) }], { email: roleOf["Majors|Tigers|Coach"] });
family("F14", "A 12-year-old who asked for Juniors (plays up?): still must-draft in Majors until an admin moves them",
  [{ first: "Kit", last: "Holloway", age: 12, division: "Juniors" }]);
family("F15", "AAA Astros manager's 8-year-old who asked for AAA: AAA coach's kid",
  [{ first: "Remy", last: "Reyes", age: 8, division: "AAA" }], { parent: roleOf["AAA|Astros|Team Manager"] });
family("F16", "AA Blue Jays manager's twins (7): kept with their parent's team when AA teams are made",
  [{ first: "Fern", last: "Linden", age: 7, division: "AA" }, { first: "Moss", last: "Linden", age: 7, division: "AA", twin: true }], { parent: roleOf["AA|Blue Jays|Team Manager"] });
family("F17", "AA siblings: a 9 and a 7",
  [{ first: "Ruby", last: "Eastwood", age: 9, division: "AA" }, { first: "Abe", last: "Eastwood", age: 7, division: "AA" }]);
family("F18", "Angels manager's 13 and a 14-year-old sibling: Juniors coach's kid and sibling",
  [{ first: "Wes", last: "Ferris", age: 14, division: "Juniors" }, { first: "Iris", last: "Ferris", age: 13, division: "Juniors" }], { parent: roleOf["Juniors|Angels|Team Manager"] });
family("F19", "Athletics manager's 16-year-old (Seniors: one team, everyone on it)",
  [{ first: "Dean", last: "Sutton", age: 16, division: "Seniors" }], { parent: roleOf["Seniors|Athletics|Team Manager"] });

// Fill to the target sizes (age|requested division -> total wanted in the pool).
const TARGET = { "12|Majors": 68, "11|Majors": 31, "10|Majors": 11, "9|AAA": 20, "8|AAA": 5, "8|AA": 56, "9|AA": 31 };
for (const [k, want] of Object.entries(TARGET)) {
  const [age, division] = [Number(k.split("|")[0]), k.split("|")[1]];
  const have = () => players.filter((p) => p.inPool && p.age === age && p.division.toUpperCase() === division.toUpperCase() && !p.heldDuplicate).length;
  while (have() < want) addDraftPlayer({ age, division });
}
// The two Juniors coach's-kid family members join a full Juniors group: move two sample Juniors out to keep 26.
const juniorsOut = players.filter((p) => p.source === "sample" && p.inPool && p.division.toUpperCase() === "JUNIORS").slice(-2);
for (const p of juniorsOut) { p.division = "Junior Softball"; p.sc = { ...p.sc, "Division Name": "Junior Softball" }; p.inPool = false; }
// One player per name and birthdate (the loader finds registrations that way).
const nameKeys = new Set();
for (const p of players) {
  const k = `${p.first}|${p.last}|${p.dob}`;
  if (nameKeys.has(k)) throw new Error(`two players share name and birthdate: ${k}`);
  nameKeys.add(k);
}

// A repeated Sports Connect Player Id is a data error (decision 2026-11-10): the app flags it, the first
// row commits, and later rows are held in import review until the Id is corrected. Held players are
// not in the evaluation pool, have no bib, and get no scores.
const seenIds = new Set();
for (const p of players) {
  if (seenIds.has(p.playerId)) { p.inPool = false; p.heldDuplicate = true; }
  seenIds.add(p.playerId);
}
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
// Draft fixtures: the volunteer report (teams and staff), the draft players and the families the loader links.
writeCsv("sports-connect-volunteers-teams-spring-2027.csv", ["Program Name", "Division Name", "Team Name", "Volunteer Role", "Volunteer First Name", "Volunteer Last Name", "Volunteer Email Address"], staffRows);
writeCsv("draft-players-spring-2027.csv", ["Fixture Key", "Player Id", "Player First Name", "Player Last Name", "Player Birth Date", "League Age", "Requested Division", "Evaluation Number", "Family", "Notes"],
  players.filter((p) => p.source === "draft").map((p) => ({ "Fixture Key": p.ref, "Player Id": p.playerId, "Player First Name": p.first, "Player Last Name": p.last, "Player Birth Date": isoToUs(p.dob),
    "League Age": p.age, "Requested Division": p.division, "Evaluation Number": p.bib, Family: p.family ?? "", Notes: p.notes })));
writeCsv("draft-families-spring-2027.csv", ["Family", "Fixture Key", "Player First Name", "Player Last Name", "League Age", "Requested Division", "Parent Email", "Confirm Siblings", "Scenario"], families);

function expectedImport(p) {
  const out = [];
  if (!ACTIVE.has(p.division.toUpperCase())) out.push("Division needs review; out of scope; keep out of evaluation pool");
  if (!p.dob) out.push("Birthdate missing; admin must review before the player has an age group");
  if (p.heldDuplicate) out.push("Duplicate Player Id: held in import review (cannot commit) until the Id is corrected in Sports Connect; not in evaluation pool");
  else if (idCounts.get(p.playerId) > 1) out.push("Duplicate Player Id in file: flagged; admin resolves the warning and commits this first row");
  if (p.payment === "") out.push("Blank payment status is flagged for review, stored as UNKNOWN, and still eligible");
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
  { "Player Id": "77100077", "Player First Name": "", "Player Last Name": "", "Player Birth Date": "", "Evaluation Number": "991", "Expected Result": "Needs review: no name given and Player Id 77100077 appeared twice in the registration file (PLY-008 is held in import review)" },
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
for (const p of players.filter((p) => p.source !== "scenario" && p.inPool && p.age >= 8)) {
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
  if (p.source !== "scenario") raters = raters.filter(([k]) => rng(`present|${p.ref}|${k}`)() < 0.92 || k.startsWith("EVA"));
  if (p.ref === "PLY-012") raters = raters.filter(([k, t]) => t === "independent_evaluator" || k === coaches[0]);
  for (const [key, type] of raters) {
    const r = rng(`eval|${p.ref}|${key}`);
    let status = "submitted"; const s = {}; let note = "";
    const ab = abilityOf(p);
    for (const k of CORE) s[k] = score(p, k, key, "2027");
    if (ab.pitcher && r() < 0.75) for (const k of PITCH) s[k] = score(p, k, key, "2027");
    if (ab.catcher && r() < 0.75) for (const k of CATCH) s[k] = score(p, k, key, "2027");
    if (p.source !== "scenario") {
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
