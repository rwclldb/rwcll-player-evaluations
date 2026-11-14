// CSV import parsing: prior-year ratings (Sports Connect DR format and the older format), bib column rules,
// and that every "Download blank CSV" template is accepted by its own parser. No database needed.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": root } });
const { readCsv, findHeader, COLUMN_ALIASES } = jiti(path.join(root, "lib/csv-upload.ts"));
const { parsePriorYear, shortDivision, coachFromTeam } = jiti(path.join(root, "lib/prior-year-csv.ts"));
const T = jiti(path.join(root, "lib/csv-templates.ts"));

const CATEGORIES = [
  ["hitting", "Hitting"], ["throwing", "Throwing"], ["grounders", "Grounders"], ["fly_balls", "Fly Balls"],
  ["running_awareness", "Running / Awareness"], ["pitching_mechanics", "Pitching Mechanics"],
  ["pitching_accuracy_control", "Pitching Accuracy/Control"], ["pitching_arm_strength", "Pitching Arm Strength"],
  ["catching_receiving", "Catching/Receiving"], ["catching_blocking", "Catching/Blocking"],
].map(([code, name]) => ({ code, name }));

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${ok || detail === undefined ? "" : ` (${JSON.stringify(detail)})`}`);
  if (!ok) failed++;
};

// Same columns as the league's 2026 enrollment export (names and contact details are made up).
const sc = readCsv([
  "Division Name,Player Id,Player First Name,Player Last Name,Player Birth Date,User Email,Team Name,Order No,Easy Rating,DR Hitting,DR Throwing,DR Grounders,DR Fly Balls,DR Running-Awareness,DR Total",
  "AA Ball - Little League Baseball,90000001,Test,Unrated,9/1/2016,parent1@example.com,AA 01 - De Leon,11111111,,,,,,,0",
  "AA Ball - Little League Baseball,90000002,Test,Rated,7/21/2018,parent2@example.com,AA 01 - De Leon,22222222,,2,1,2,1,2,8",
  "AA Ball - Little League Baseball,90000003,Test,Partial,1/23/2019,parent3@example.com,AA 11 - McGowan,33333333,3.6,4,,4,3,4,15",
].join("\r\n"));
const p = parsePriorYear(sc, CATEGORIES, "Spring 2026");
check("Sports Connect DR file parses", !("error" in p), p);
if (!("error" in p)) {
  check("players with no ratings are skipped", p.unrated === 1 && p.rows.length === 2, { unrated: p.unrated, rows: p.rows.length });
  check("DR columns map to the five core skills", JSON.stringify(p.rows[0].ratings) === JSON.stringify({ hitting: 2, throwing: 1, grounders: 2, fly_balls: 1, running_awareness: 2 }), p.rows[0].ratings);
  check("a blank skill stays out of the ratings", !("throwing" in p.rows[1].ratings) && p.rows[1].ratings.hitting === 4, p.rows[1].ratings);
  check("division is shortened to AA", p.rows[0].division === "AA", p.rows[0].division);
  check("coach name comes from the team name", p.rows[0].coach_name === "De Leon" && p.rows[1].coach_name === "McGowan", [p.rows[0].coach_name, p.rows[1].coach_name]);
  check("season comes from the page when the file has none", p.rows[0].season === "Spring 2026");
  check("birthdate M/D/YYYY becomes ISO", p.rows[0].birth_date === "2018-07-21", p.rows[0].birth_date);
  check("Player Id kept for matching", p.rows[0].player_id === "90000002");
  check("rated players keep their spreadsheet line (row 2 was skipped)", p.rows[0].line === 3 && p.rows[1].line === 4, p.rows.map((r) => r.line));
  const stored = JSON.stringify(p.rows.map((r) => r.source));
  check("emails and order numbers are never stored", !/example\.com|22222222|User Email|Order No/.test(stored), stored);
  check("unused columns are reported", ["User Email", "Order No", "Easy Rating", "DR Total"].every((c) => p.ignoredColumns.includes(c)), p.ignoredColumns);
}

const withProgram = parsePriorYear(readCsv(["Program Name,Player First Name,Player Last Name,DR Hitting", "2026 Spring Baseball,A,B,3"].join("\n")), CATEGORIES, "");
check("Program Name is used as the season", !("error" in withProgram) && withProgram.rows[0].season === "2026 Spring Baseball", withProgram);

const gappy = readCsv(["Player Id,Evaluation Number", "1,201", "", "2,202", "\"3\",\"203\""].join(String.fromCharCode(13, 10)));
check("blank lines are skipped but line numbers still match the spreadsheet", JSON.stringify(gappy.lines) === "[2,4,5]", gappy.lines);

const old = readCsv(fs.readFileSync(path.join(root, "rwcll-fictional-test-league/generated/spring-2026-coach-ratings.csv"), "utf8"));
const o = parsePriorYear(old, CATEGORIES, "");
check("older prior-year format (code columns, Season, Coach Name) still parses", !("error" in o) && o.rows.length > 0 && o.rows[0].season !== "", o.error);

const none = parsePriorYear(readCsv("Player First Name,Player Last Name,Notes\nA,B,x"), CATEGORIES, "Spring 2026");
check("a file with no rating columns is refused", "error" in none);

check("shortDivision handles AAA before AA", shortDivision("AAA Ball - Little League Baseball") === "AAA" && shortDivision("Majors Baseball") === "Majors" && shortDivision("Tee Ball") === "Tee Ball");
check("coachFromTeam without a dash is blank", coachFromTeam("Team Blue") === "");

// Bib column: Registration Number accepted; a real bib column wins when both are present.
check("Registration Number is accepted as the bib column", findHeader(["Player Id", "Registration Number"], COLUMN_ALIASES.bib) === "Registration Number");
check("Evaluation Number wins over Registration Number", findHeader(["Registration Number", "Player Id", "Evaluation Number"], COLUMN_ALIASES.bib) === "Evaluation Number");
check("Bib wins over Registration Number", findHeader(["Registration Number", "Bib"], COLUMN_ALIASES.bib) === "Bib");

// Every template downloads columns its own parser recognises.
const names = (t) => t.columns.map((c) => c.name);
const bib = names(T.BIB_TEMPLATE);
check("bib template: Player Id, names, birthdate and bib all recognised",
  ["playerId", "firstName", "lastName", "birthDate", "bib"].every((k) => findHeader(bib, COLUMN_ALIASES[k])));
const py = parsePriorYear({ headers: names(T.PRIOR_YEAR_TEMPLATE), rows: [] }, CATEGORIES, "");
check("prior-year template: every skill column recognised, nothing unused", !("error" in py) && py.ratingColumns.length === CATEGORIES.length && py.ignoredColumns.length === 0, py);
const ppl = names(T.PEOPLE_TEMPLATE);
check("people template: email, role and division recognised",
  Boolean(findHeader(ppl, COLUMN_ALIASES.email) && findHeader(ppl, COLUMN_ALIASES.role) && findHeader(ppl, ["Division Name"])));
const { REQUIRED_HEADERS } = jiti(path.join(root, "lib/sports-connect-preview.ts"));
check("Sports Connect template has every required header", REQUIRED_HEADERS.every((h) => names(T.SPORTS_CONNECT_TEMPLATE).includes(h)));

// Optional "Coaches Kid" column on the registration import.
const { makePreview } = jiti(path.join(root, "lib/sports-connect-preview.ts"));
const kidCsv = [[...REQUIRED_HEADERS, "Coaches Kid"].join(","),
  ...[["Yes", "K1"], ["no", "K2"], ["", "K3"], ["maybe", "K4"]].map(([v, id]) =>
    [REQUIRED_HEADERS.map((h) => ({ "Program Name": "Baseball", "Division Name": "AA", "Player Id": id, "Player First Name": "A", "Player Last Name": id,
      "Player Birth Date": "03/01/2018", "Order Payment Status": "Paid" }[h] ?? "")).join(","), v].join(","))].join("\n");
const kidPreview = makePreview(kidCsv);
check("Coaches Kid column: Yes/no/blank become true/false/blank",
  JSON.stringify(kidPreview.rows.map((r) => r.coachKid)) === "[true,false,null,null]", kidPreview.rows.map((r) => r.coachKid));
check("an unclear Coaches Kid value is flagged for review", kidPreview.rows[3].issues.some((i) => i.includes("Coaches Kid")) && !kidPreview.rows[0].issues.some((i) => i.includes("Coaches Kid")));
check("Sports Connect template lists Coaches Kid", names(T.SPORTS_CONNECT_TEMPLATE).includes("Coaches Kid"));

if (failed) { console.error(`FAIL: ${failed} CSV import check(s) failed`); process.exit(1); }
console.log("PASS: CSV import parsing and templates");
