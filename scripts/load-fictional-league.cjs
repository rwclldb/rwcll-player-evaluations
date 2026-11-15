// Loads the RWCLL fictional test league into Supabase (local by default).
//
//   npm run fixtures:load -- --reset                  wipe local DB, then load the pre-evaluation dataset
//   npm run fixtures:load -- --reset --open-sessions  same, with every age group already Open for scoring
//   npm run fixtures:load -- --reset --scored         same, plus all Spring 2027 evaluations (for draft reports)
//   npm run fixtures:load                             load into an empty local DB (refuses if players exist)
//   npm run fixtures:load -- --reset --demo           board demo: scored league mid-evaluation-day (docs/DEMO-SCRIPT.md)
//                                                     [--demo-date=YYYY-MM-DD] (default: today, Pacific)
//                                                     [--board-seats=N] (default 6: board1@example.com... score age 8)
//   Live-site demo (you run it): npm run fixtures:load -- --hosted --confirm-project=<ref> --demo
//                                (docs/board-demo/LIVE-DEMO-SCRIPT.md)
//   npm run fixtures:load -- --reset --bare           wipe, then only admin accounts + seasons: walk through setup in the app
//                                                     (docs/TEST-PLAN-SEASON-SETUP.xlsx)
//
// Hosted (run it YOURSELF; see docs/FAQ.md "Load test data into hosted Supabase"):
//   npm run fixtures:load -- --hosted --confirm-project=<ref> [--open-sessions | --scored]
//   Reads HOSTED_SUPABASE_URL / _SECRET_KEY / _PUBLISHABLE_KEY from .env.hosted.local. Never wipes hosted.
//
// Requires FIXTURE_PASSWORD: the password given to every test account.
// Local mode refuses to run unless both .env.local and `supabase status` point at 127.0.0.1.
//
// Uses the app's real code paths where they exist:
//   - CSV parsing: lib/sports-connect-preview.ts (same parser as the import screen)
//   - Registration import: stage_sports_connect_import -> review -> resolve duplicate -> commit RPCs,
//     called while signed in as admin.jordan@example.com
// Steps with no app workflow yet are done with the service role and labelled SIMULATED in the output:
//   accounts/roles, seasons, bib numbers, prior-year import, sessions/events/assignments, PLY-022 age fix.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createClient } = require("@supabase/supabase-js");

const root = path.resolve(__dirname, "..");
const pack = path.join(root, "rwcll-fictional-test-league");
const gen = path.join(pack, "generated");
const argv = process.argv.slice(2);
const args = new Set(argv);
const RESET = args.has("--reset");
// DEMO: the scored league staged as a live evaluation day for presenting (docs/DEMO-SCRIPT.md).
const DEMO = args.has("--demo");
const SCORED = args.has("--scored") || DEMO;
const pacificToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
const DEMO_DATE = (argv.find((a) => a.startsWith("--demo-date=")) ?? "").split("=")[1] || pacificToday();
if (DEMO && !/^\d{4}-\d{2}-\d{2}$/.test(DEMO_DATE)) { console.error("--demo-date must be YYYY-MM-DD"); process.exit(1); }
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const OPEN_SESSIONS = args.has("--open-sessions");
// BARE: admin accounts and seasons only; everything else is done by hand in the app.
const BARE = args.has("--bare");
// HOSTED mode is meant to be run by the user, never by Claude Code (hosted Supabase is off limits to it).
const HOSTED = args.has("--hosted");
const confirmProject = (argv.find((a) => a.startsWith("--confirm-project=")) ?? "").split("=")[1];

const log = (msg) => console.log(msg);
const fail = (msg) => { console.error(`\nFAIL: ${msg}`); process.exit(1); };

// ---------- environment & safety ----------
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim().replace(/^"|"$/g, "")]));
}
const envLocal = readEnvFile(path.join(root, ".env.local"));
const isLocal = (u) => /^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/.test(u ?? "");

function supabaseStatus() {
  const r = spawnSync("npx", ["supabase", "status", "-o", "env"], { cwd: root, encoding: "utf8", shell: true });
  if (r.status !== 0) fail("`npx supabase status` failed. Is local Supabase running? (npx supabase start)");
  return Object.fromEntries(r.stdout.split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
}

let status;
let password;
if (HOSTED) {
  // Keys come from .env.hosted.local (git-ignored by the .env*.local rule) or the environment.
  const envHosted = { ...readEnvFile(path.join(root, ".env.hosted.local")), ...process.env };
  const url = (envHosted.HOSTED_SUPABASE_URL ?? "").replace(/\/$/, "");
  const ref = (url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/) ?? [])[1];
  if (!ref) fail("Set HOSTED_SUPABASE_URL (https://<project-ref>.supabase.co) in .env.hosted.local.");
  if (confirmProject !== ref) fail(`Hosted load needs --confirm-project=${ref} to prove you mean this project.`);
  if (RESET) fail("--reset is local only. Wipe the hosted database yourself first (npx supabase db reset --linked).");
  status = { API_URL: url, SERVICE_ROLE_KEY: envHosted.HOSTED_SUPABASE_SECRET_KEY, PUBLISHABLE_KEY: envHosted.HOSTED_SUPABASE_PUBLISHABLE_KEY };
  if (!status.SERVICE_ROLE_KEY || !status.PUBLISHABLE_KEY) fail("Set HOSTED_SUPABASE_SECRET_KEY and HOSTED_SUPABASE_PUBLISHABLE_KEY in .env.hosted.local.");
  password = envHosted.FIXTURE_PASSWORD || envLocal.FIXTURE_PASSWORD;
  log(`HOSTED load into project ${ref}.`);
} else {
  const appUrl = envLocal.NEXT_PUBLIC_SUPABASE_URL;
  if (!isLocal(appUrl)) fail(`.env.local NEXT_PUBLIC_SUPABASE_URL must be the local API (http://127.0.0.1:54321). Found: ${appUrl ?? "(missing)"}`);
  status = supabaseStatus();
  if (!isLocal(status.API_URL)) fail(`supabase status API_URL is not local: ${status.API_URL}`);
  password = process.env.FIXTURE_PASSWORD || envLocal.FIXTURE_PASSWORD;
}
// Board seats (demo only): coach accounts board1@example.com ... assigned to age 8, for board members to score
// on their own phones during a live-site demo. --board-seats=0 to skip.
const BOARD_SEATS = DEMO ? Number((argv.find((a) => a.startsWith("--board-seats=")) ?? "--board-seats=6").split("=")[1]) : 0;
if (!Number.isInteger(BOARD_SEATS) || BOARD_SEATS < 0 || BOARD_SEATS > 20) fail("--board-seats must be a whole number from 0 to 20");
if (!password || password.length < 8) fail("Set FIXTURE_PASSWORD (8+ characters). It becomes the password for every test account.");

// ---------- CSV helper (fixture files are simple RFC 4180) ----------
const jiti = require("jiti")(__filename);
const preview = jiti(path.join(root, "lib/sports-connect-preview.ts"));
function readCsv(file) {
  const [headers, ...rows] = preview.parseCsv(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  return rows.filter((r) => r.some((c) => c !== "")).map((cells) => Object.fromEntries(headers.map((h, i) => [h.trim(), (cells[i] ?? "").trim()])));
}
const usToIso = (us) => { const m = (us ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };

// Create a sign-in account, or reuse one that survived a wipe (hosted `db reset` keeps sign-ins): its password is
// reset to FIXTURE_PASSWORD and its display name restored.
async function ensureUser(svc, existingUsers, email, password, displayName) {
  const found = existingUsers?.users?.find((u) => u.email === email);
  let id = found?.id;
  if (id) await must(svc.auth.admin.updateUserById(id, { password, email_confirm: true }), `reset password ${email}`);
  else id = (await must(svc.auth.admin.createUser({ email, password, email_confirm: true }), `create user ${email}`)).user.id;
  await must(svc.from("user_profiles").upsert({ user_id: id, display_name: displayName }), `profile ${email}`);
  return id;
}

async function must(promise, what) {
  const { data, error } = await promise;
  if (error) fail(`${what}: ${error.message}`);
  return data;
}

async function main() {
  // ---------- reset ----------
  if (RESET) {
    log("Wiping LOCAL database (npx supabase db reset) ...");
    const r = spawnSync("npx", ["supabase", "db", "reset"], { cwd: root, stdio: "inherit", shell: true });
    if (r.status !== 0) fail("supabase db reset failed");
    status = supabaseStatus();
  }
  const serviceKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  const anonKey = status.ANON_KEY || status.PUBLISHABLE_KEY;
  if (!serviceKey || !anonKey) fail("Could not read local keys from supabase status");
  const svc = createClient(status.API_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Wait for the API after a reset.
  for (let i = 0; ; i++) {
    const { error } = await svc.from("seasons").select("id").limit(1);
    if (!error) break;
    if (i > 30) fail(`database API not ready: ${error.message}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  const { count: existing } = await svc.from("players").select("id", { count: "exact", head: true });
  if (existing > 0) fail(`database already has ${existing} players. ${HOSTED ? "Wipe it first (npx supabase db reset --linked)." : "Re-run with --reset to wipe it first."}`);
  const { count: categoryCount } = await svc.from("rating_categories").select("id", { count: "exact", head: true });
  if (categoryCount !== 11) fail(`expected 11 rating categories, found ${categoryCount}. Apply migrations and supabase/seed.sql first.`);

  // ---------- accounts & roles (SIMULATED: no in-app invite workflow yet) ----------
  const people = readCsv(path.join(pack, "fictional_people.csv"));
  const userId = {};
  const { data: existingUsers } = await svc.auth.admin.listUsers({ perPage: 1000 });
  for (const p of people.filter((p) => p.email && (!BARE || p.role_spring_2027 === "administrator"))) {
    userId[p.fictional_person_key] = await ensureUser(svc, existingUsers, p.email, password, `${p.first_name} ${p.last_name}`);
  }
  for (let i = 1; i <= (BARE ? 0 : BOARD_SEATS); i++) {
    userId[`BRD-${i}`] = await ensureUser(svc, existingUsers, `board${i}@example.com`, password, `Board Member ${i}`);
  }
  log(`SIMULATED accounts: ${Object.keys(userId).length} users ready (password from FIXTURE_PASSWORD)${BOARD_SEATS ? `, including ${BOARD_SEATS} board seats` : ""}`);

  // ---------- seasons (SIMULATED: no season-creation workflow yet) ----------
  const s2026 = await must(svc.from("seasons").insert({ name: "Spring 2026", start_date: "2026-01-01", end_date: "2026-06-30", is_closed: true }).select("id").single(), "create Spring 2026");
  const s2027 = await must(svc.from("seasons").insert({ name: "Spring 2027", start_date: "2027-01-01", end_date: "2027-06-30" }).select("id").single(), "create Spring 2027");
  const adminId = userId["ADM-01"];
  const roleRows = people.filter((p) => userId[p.fictional_person_key] && p.role_spring_2027 !== "none").map((p) => ({
    user_id: userId[p.fictional_person_key], role_name: p.role_spring_2027, season_id: p.role_spring_2027 === "administrator" ? null : s2027.id, created_by: adminId,
  }));
  for (let i = 1; i <= (BARE ? 0 : BOARD_SEATS); i++) roleRows.push({ user_id: userId[`BRD-${i}`], role_name: "coach", season_id: s2027.id, created_by: adminId });
  await must(svc.from("user_roles").insert(roleRows), "assign roles");
  const { count: divCount } = await svc.from("season_divisions").select("id", { count: "exact", head: true }).eq("season_id", s2027.id);
  log(`SIMULATED seasons: Spring 2026 (id ${s2026.id}, closed), Spring 2027 (id ${s2027.id}, ${divCount} divisions attached); ${roleRows.length} roles`);
  if (BARE) {
    log(`
PASS: bare league loaded: ${Object.keys(userId).length} admin accounts, Spring 2026 (closed) and Spring 2027. No players, coaches, evaluators, bibs, prior-year ratings, or sessions.`);
    log("Next: follow docs/TEST-PLAN-SEASON-SETUP.xlsx, signed in as admin.jordan@example.com with FIXTURE_PASSWORD.");
    return;
  }

  // ---------- registration import (REAL: same parser and RPCs as the import screen) ----------
  const admin = createClient(status.API_URL, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await must(admin.auth.signInWithPassword({ email: "admin.jordan@example.com", password }), "sign in as admin.jordan");
  const csvName = "sports-connect-spring-2027-full.csv";
  const { rows: previewRows, missingHeaders } = preview.makePreview(fs.readFileSync(path.join(gen, csvName), "utf8"));
  if (missingHeaders.length) fail(`CSV missing headers: ${missingHeaders.join(", ")}`);
  const batchId = await must(admin.rpc("stage_sports_connect_import", { p_season_id: s2027.id, p_source_file_name: csvName, p_rows: previewRows }), "stage import");
  const staged = await must(svc.from("sports_connect_import_rows").select("id, source_row_number, first_name, last_name, source_division, review_flags").eq("import_batch_id", batchId).order("source_row_number"), "read staged rows");
  log(`REAL import: staged ${staged.length} rows as batch ${batchId}`);

  const ACTIVE = new Set(["AA", "AAA", "MAJORS", "JUNIORS", "SENIORS"]);
  const tally = { committed: 0, ignored: 0, duplicateResolved: 0, leftForReview: [] };
  const committedIds = new Set();
  const stagedFull = await must(svc.from("sports_connect_import_rows").select("id, external_player_id").eq("import_batch_id", batchId), "read staged ids");
  const extId = Object.fromEntries(stagedFull.map((r) => [r.id, r.external_player_id]));
  for (const row of staged) {
    const flags = JSON.stringify(row.review_flags ?? []);
    if (!ACTIVE.has(String(row.source_division ?? "").toUpperCase())) {
      await must(admin.rpc("review_sports_connect_import_row", { p_row_id: row.id, p_decision: "ignored", p_reason: "Fixture load: out-of-scope program, kept out of evaluation pool" }), `ignore row ${row.source_row_number}`);
      tally.ignored++; continue;
    }
    // The database allows one registration per Sports Connect Player Id per season. A second child carrying
    // an already-committed Id cannot be committed; leave it in review, as an admin would find it.
    if (extId[row.id] && committedIds.has(extId[row.id])) { tally.leftForReview.push(`${row.first_name} ${row.last_name}`); continue; }
    if (flags.includes("Duplicate Player ID")) {
      await must(admin.rpc("resolve_duplicate_player_id_warning", { p_row_id: row.id, p_reason: "Fixture load: different children sharing one Sports Connect ID; keep separate" }), `resolve duplicate row ${row.source_row_number}`);
      tally.duplicateResolved++;
    }
    await must(admin.rpc("review_sports_connect_import_row", { p_row_id: row.id, p_decision: "approved_new", p_reason: "Fixture load: new player in empty database" }), `approve row ${row.source_row_number}`);
    await must(admin.rpc("commit_sports_connect_import_row", { p_row_id: row.id, p_reason: "Fixture load: commit approved registration" }), `commit row ${row.source_row_number}`);
    tally.committed++;
    if (extId[row.id]) committedIds.add(extId[row.id]);
  }
  log(`REAL import: ${tally.committed} committed, ${tally.ignored} ignored (out of scope), ${tally.duplicateResolved} duplicate-ID warnings resolved`);
  if (tally.leftForReview.length) log(`REAL import: left in review (Player Id already registered this season): ${tally.leftForReview.join(", ")}`);

  // ---------- registrations lookup ----------
  const regs = await must(svc.from("player_seasons").select("id, player_id, league_age, external_player_id, players(first_name, last_name, date_of_birth)").eq("season_id", s2027.id), "read registrations");
  const byNameDob = new Map(regs.map((r) => [`${r.players.first_name}|${r.players.last_name}|${r.players.date_of_birth ?? ""}`, r]));

  // PLY-022 has no birthdate. SIMULATED admin age fix (no age-correction workflow yet).
  const val = regs.find((r) => r.players.first_name === "Val" && r.players.last_name === "Hayes");
  if (val && val.league_age === null) {
    await must(svc.from("player_seasons").update({ league_age: 11 }).eq("id", val.id), "set PLY-022 age");
    val.league_age = 11;
    log("SIMULATED admin fix: Val Hayes (PLY-022, no birthdate) set to league age 11");
  }

  // ---------- bibs (SIMULATED: bib upload not built yet) ----------
  let bibs = 0;
  for (const b of readCsv(path.join(gen, "bib-numbers-by-name-and-birthdate.csv"))) {
    const reg = byNameDob.get(`${b["Player First Name"]}|${b["Player Last Name"]}|${usToIso(b["Player Birth Date"])}`);
    if (!reg && tally.leftForReview.includes(`${b["Player First Name"]} ${b["Player Last Name"]}`)) { log(`  bib ${b["Evaluation Number"]} skipped: ${b["Player First Name"]} ${b["Player Last Name"]} is still in import review`); continue; }
    if (!reg) fail(`bib file row has no registration: ${b["Player First Name"]} ${b["Player Last Name"]}`);
    await must(svc.from("player_seasons").update({ evaluation_number: Number(b["Evaluation Number"]) }).eq("id", reg.id), "set bib");
    bibs++;
  }
  // Val Hayes has no birthdate, so take her bib from the Player Id file.
  const valBib = readCsv(path.join(gen, "bib-numbers-by-player-id.csv")).find((b) => b["Player First Name"] === "Val" && b["Player Last Name"] === "Hayes");
  if (val && valBib) { await must(svc.from("player_seasons").update({ evaluation_number: Number(valBib["Evaluation Number"]) }).eq("id", val.id), "set Val bib"); bibs++; }
  log(`SIMULATED bib upload: ${bibs} evaluation numbers set`);

  // ---------- prior-year coach ratings of players (SIMULATED: historical import not built yet) ----------
  const hist = readCsv(path.join(gen, "spring-2026-coach-ratings.csv"));
  const expected = readCsv(path.join(gen, "spring-2026-expected-matches.csv"));
  const scenario = readCsv(path.join(gen, "scenario-notes.csv"));
  const sample = readCsv(path.join(root, "docs/test-fixtures/sports-connect-sample-spring-2027-fake.csv"));
  const refToReg = (ref) => {
    if (ref.startsWith("PLY-")) { const s = scenario.find((x) => x["Fixture Key"] === ref); return byNameDob.get(`${s["Player First Name"]}|${s["Player Last Name"]}|${usToIso(s["Player Birth Date"]) ?? ""}`); }
    const s = sample[Number(ref.slice(4)) - 1]; return byNameDob.get(`${s["Player First Name"]}|${s["Player Last Name"]}|${usToIso(s["Player Birth Date"])}`);
  };
  const categories = await must(svc.from("rating_categories").select("id, code, name"), "read categories");
  const coachUser = Object.fromEntries(people.filter((p) => p.coached_spring_2026 === "YES").map((p) => [p.fictional_person_key, userId[p.fictional_person_key] ?? null]));
  const coachKeyByName = { "Avery Linden": "COA-01", "Bailey Marsh": "COA-02", "Cameron Reyes": "COA-03", "Elliott Brandt": "COA-05", "Finley Moss": "COA-06", "Gray Whitfield": "COA-07", "Indigo Ferris": "COA-09" };
  const hBatch = await must(svc.from("import_batches").insert({ import_type: "historical_evaluations", source_file_name: "spring-2026-coach-ratings.csv", rows_received: hist.length, created_by: adminId, season_id: s2026.id }).select("id").single(), "historical batch");
  let imported = 0, pending = 0;
  for (let i = 0; i < hist.length; i++) {
    const h = hist[i]; const exp = expected[i]; const rowNo = i + 1;
    const reg = exp["Expected Match"] === "UNMATCHED" ? null : refToReg(exp["Expected Match"]);
    if (exp["Expected Match"] !== "UNMATCHED" && !reg) fail(`prior-year row ${rowNo}: cannot find ${exp["Expected Match"]}`);
    const method = exp["Admin Action"] === "Confirm match" ? "player_id" : "manual_review";
    const staging = await must(svc.from("historical_evaluation_import_rows").insert({
      import_batch_id: hBatch.id, source_row_number: rowNo, source_data: h, source_player_id: h["Player Id"], first_name: h["Player First Name"], last_name: h["Player Last Name"],
      birth_date: usToIso(h["Player Birth Date"]), source_season_label: h.Season, source_division_name: h.Division, source_team_label: h.Team, source_coach_name: h["Coach Name"],
      candidate_player_ids: reg ? [reg.player_id] : [],
    }).select("id").single(), `stage prior-year row ${rowNo}`);
    if (!reg) { pending++; continue; } // look-alike and departed player stay pending for admin review
    const he = await must(svc.from("historical_evaluations").insert({
      player_id: reg.player_id, source_season_label: h.Season, source_division_name: h.Division, source_team_label: h.Team, source_season_id: s2026.id,
      source_coach_name: h["Coach Name"], source_coach_user_id: coachUser[coachKeyByName[h["Coach Name"]]] ?? null, source_player_id: h["Player Id"],
      player_match_method: method, source_import_batch_id: hBatch.id, source_import_row_number: rowNo, imported_by: adminId, created_by: adminId,
      reviewed_by: adminId, reviewed_at: new Date().toISOString(), review_reason: `Fixture load: ${exp.Reason}`,
      coverage_note: h["Fixture Note"] || null,
    }).select("id").single(), `prior-year evaluation ${rowNo}`);
    const ratings = categories.filter((c) => h[c.code] !== "").map((c) => ({ historical_evaluation_id: he.id, category_name: c.name, score: Number(h[c.code]), rating_category_id: c.id, source_category_code: c.code }));
    if (ratings.length) await must(svc.from("historical_ratings").insert(ratings), `prior-year ratings ${rowNo}`);
    await must(svc.from("historical_evaluation_import_rows").update({ resolved_player_id: reg.player_id, match_method: method, review_state: "imported", reviewed_by: adminId, reviewed_at: new Date().toISOString(), review_reason: `Fixture load: ${exp.Reason}`, imported_historical_evaluation_id: he.id }).eq("id", staging.id), `mark prior-year row ${rowNo}`);
    imported++;
  }
  await must(svc.from("import_batches").update({ rows_processed: imported }).eq("id", hBatch.id), "historical batch counts");
  log(`SIMULATED prior-year import: ${imported} matched and imported, ${pending} left pending admin review`);

  // ---------- sessions, events, assignments (SIMULATED via service role; sessions stay in Setup) ----------
  const SLOTS = { 7: ["09:00", "10:30"], 8: ["09:00", "10:30"], 9: ["10:30", "12:00"], 10: ["10:30", "12:00"], 11: ["12:30", "14:00"], 12: ["12:30", "14:00"], 13: ["14:00", "15:30"], 14: ["14:00", "15:30"], 15: ["15:30", "17:00"], 16: ["15:30", "17:00"] };
  const COACHES = { 7: ["COA-01", "COA-02", "COA-03"], 8: ["COA-01", "COA-02", "COA-03"], 9: ["COA-03", "COA-04", "COA-05"], 10: ["COA-03", "COA-04", "COA-05"], 11: ["COA-05", "COA-06", "COA-08"], 12: ["COA-05", "COA-06", "COA-08"], 13: ["COA-08", "COA-09", "COA-10"], 14: ["COA-08", "COA-09", "COA-10"], 15: ["COA-09", "COA-10", "COA-01"], 16: ["COA-09", "COA-10", "COA-01"] };
  const IES = (a) => [a <= 9 && "EVA-01", a >= 10 && a <= 12 && "EVA-02", a >= 13 && "EVA-03", a >= 11 && a <= 13 && "EVA-04", a >= 14 && "EVA-06"].filter(Boolean);
  let assignments = 0;
  const sessionByAge = {};
  for (let age = 7; age <= 16; age++) {
    const session = await must(svc.from("evaluation_sessions").insert({ season_id: s2027.id, league_age: age, status: "setup", created_by: adminId }).select("id").single(), `session age ${age}`);
    sessionByAge[age] = session.id;
    await must(svc.from("evaluation_session_events").insert([
      { evaluation_session_id: session.id, event_type: "primary", event_date: DEMO ? DEMO_DATE : "2027-01-23", start_time: SLOTS[age][0], end_time: SLOTS[age][1], location: "Fixture Park, Field 1", created_by: adminId },
      { evaluation_session_id: session.id, event_type: "makeup", event_date: DEMO ? addDays(DEMO_DATE, 7) : "2027-01-30", start_time: "10:00", end_time: "12:00", location: "Fixture Park, Field 2", notes: "Makeup for all ages", created_by: adminId },
    ]), `events age ${age}`);
    const seats = age === 8 ? Array.from({ length: BOARD_SEATS }, (_, i) => `BRD-${i + 1}`) : [];
    const rows = [...COACHES[age].map((k) => [k, "coach"]), ...seats.map((k) => [k, "coach"]), ...IES(age).map((k) => [k, "independent_evaluator"])].map(([k, t]) => ({ evaluation_session_id: session.id, evaluator_user_id: userId[k], evaluator_type: t, assigned_by: adminId }));
    await must(svc.from("evaluator_assignments").insert(rows), `assignments age ${age}`);
    assignments += rows.length;
  }
  log(`SIMULATED sessions: 10 age groups (7-16) in Setup, primary 2027-01-23 + makeup 2027-01-30, ${assignments} evaluator assignments`);

  // ---------- verify ----------
  const pool = regs.filter((r) => r.league_age >= 7 && r.league_age <= 16).length;
  // The fixture files already exclude players held in import review (duplicate Player Id).
  const expectedPool = readCsv(path.join(gen, "scored/expected-draft-report.csv")).length;
  const expectedBibs = readCsv(path.join(gen, "bib-numbers-by-player-id.csv")).length;
  const { count: bibCount } = await svc.from("player_seasons").select("id", { count: "exact", head: true }).eq("season_id", s2027.id).not("evaluation_number", "is", null);
  log(`\nVerify: ${pool} registrations in ages 7-16 (expected ${expectedPool}); ${bibCount} with bibs (expected ${expectedBibs})`);
  if (pool !== expectedPool || bibCount !== expectedBibs) fail("loaded counts do not match the fixture files");
  if (!SCORED) {
    if (OPEN_SESSIONS) {
      // SIMULATED admin "Open Session" for every age group, so scoring can start right away.
      await must(svc.from("evaluation_sessions").update({ status: "open" }).eq("season_id", s2027.id), "open sessions");
      log("SIMULATED: all 10 age groups opened for scoring");
    }
    log(`\nPASS: pre-evaluation dataset loaded${OPEN_SESSIONS ? " (sessions Open)" : " (sessions in Setup)"}. Sign in as any fixture account (e.g. admin.jordan@example.com) with FIXTURE_PASSWORD.`);
    return;
  }

  // ---------- scored dataset: Spring 2027 evaluations (REAL: save_evaluation as each evaluator) ----------
  // SIMULATED: open every session (admin "Open session" action) so scoring is allowed.
  await must(svc.from("evaluation_sessions").update({ status: "open" }).eq("season_id", s2027.id), "open sessions");
  const evalRows = readCsv(path.join(gen, "scored/spring-2027-evaluations.csv"));
  const CODES = categories.map((c) => c.code);
  // DEMO: ages 7 and 8 are still being scored. Avery (COA-01) hasn't started age 7 (scored live in the demo);
  // the other scorers in ages 7-8 have done about the first 60% of players.
  const demoUnscored = (r) => {
    if (!DEMO) return false;
    const reg = refToReg(r["Fixture Key"]);
    if (!reg || reg.league_age > 8) return false;
    if (r["Evaluator Key"] === "COA-01" && reg.league_age === 7) return true;
    const sameAge = regs.filter((x) => x.league_age === reg.league_age).sort((a, b) => a.id - b.id);
    return sameAge.indexOf(reg) >= Math.ceil(sameAge.length * 0.6);
  };
  const byEvaluator = evalRows.filter((r) => !demoUnscored(r)).reduce((m, r) => ((m[r["Evaluator Key"]] ??= []).push(r), m), {});
  let saved = 0;
  for (const [key, rows] of Object.entries(byEvaluator)) {
    const client = createClient(status.API_URL, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await must(client.auth.signInWithPassword({ email: rows[0]["Evaluator Email"], password }), `sign in as ${key}`);
    for (const r of rows) {
      const reg = refToReg(r["Fixture Key"]);
      if (!reg) fail(`evaluation for ${r["Fixture Key"]} has no registration`);
      const ratings = Object.fromEntries(CODES.filter((c) => r[c] !== "").map((c) => [c, Number(r[c])]));
      await must(client.rpc("save_evaluation", { p_session_id: sessionByAge[reg.league_age], p_player_season_id: reg.id, p_ratings: ratings, p_experience_answers: {}, p_status: r.Status }),
        `${key} ${r.Status} for ${r["Fixture Key"]}`);
      saved++;
    }
    await client.auth.signOut();
  }
  log(`REAL scoring: ${saved} evaluations saved through save_evaluation by ${Object.keys(byEvaluator).length} evaluator accounts; sessions left Open`);
  if (DEMO) return stageDemo({ svc, admin, s2027, sessionByAge, userId, adminId, regs, password, saved });

  // Verify: the app's draft_report function (as admin) must reproduce expected-draft-report.csv.
  const report = new Map();
  for (const sessionId of Object.values(sessionByAge)) {
    for (const row of await must(admin.rpc("draft_report", { p_session_id: sessionId }), `draft_report session ${sessionId}`)) report.set(row.player_season_id, row);
  }
  const checks = [
    ["Coach Overall", "coach_overall"], ["Evaluator Overall", "evaluator_overall"], ["Prior-Year Overall", "prior_overall"],
    ["Coach Evaluations", "coach_evaluations"], ["Evaluator Evaluations", "evaluator_evaluations"], ["Prior-Year Ratings", "prior_ratings"],
    ["Blank Core Skills (submitted)", "blank_core_skills"], ["Not Evaluated Marks", "not_evaluated_marks"], ["Drafts Excluded", "drafts_excluded"],
  ];
  let mismatches = 0, compared = 0;
  for (const exp of readCsv(path.join(gen, "scored/expected-draft-report.csv"))) {
    const row = report.get(refToReg(exp["Fixture Key"]).id);
    if (!row) { mismatches++; log(`  missing from draft_report: ${exp["Fixture Key"]}`); continue; }
    for (const [col, field] of checks) {
      const want = exp[col] === "" ? null : Number(exp[col]);
      const got = row[field] === null ? null : Number(row[field]);
      compared++;
      if ((got === null) !== (want === null) || (got !== null && Math.abs(got - want) > 0.005)) {
        mismatches++;
        if (mismatches <= 8) log(`  mismatch ${exp["Fixture Key"]} ${col}: draft_report ${got ?? "blank"}, expected ${exp[col] || "blank"}`);
      }
    }
  }
  const { count: evalCount } = await svc.from("evaluations").select("id", { count: "exact", head: true });
  log(`Verify: ${evalCount} evaluations in database; draft_report checked ${compared} values for ${report.size} players: ${mismatches} mismatches`);
  if (evalCount !== evalRows.length || mismatches || report.size !== readCsv(path.join(gen, "scored/expected-draft-report.csv")).length) fail("draft_report does not match the fixture files");
  log("\nPASS: scored dataset loaded. Sessions are Open; lock and release them in the app to test reports.");
}

// ---------- board demo: a live evaluation day (SIMULATED admin and registrar actions) ----------
async function stageDemo({ svc, admin, s2027, sessionByAge, userId, adminId, regs, password, saved }) {
  const now = new Date();
  const at = (minutesAgo) => new Date(now.getTime() - minutesAgo * 60000).toISOString();
  const byAge = (age) => regs.filter((r) => r.league_age === age).sort((a, b) => a.id - b.id);

  // Age groups: 7-8 still scoring, 9-12 locked and released to coaches, 13-16 locked and waiting for release.
  // An independent evaluator's shared note (written before the age group locks).
  const nine = byAge(9);
  const kendallEval = await must(svc.from("evaluations").select("id").eq("player_season_id", nine[0].id).eq("evaluator_user_id", userId["EVA-01"]).maybeSingle(), "find evaluator score");
  if (kendallEval) await must(svc.from("evaluator_notes").insert({ evaluation_id: kendallEval.id, author_user_id: userId["EVA-01"], note_text: "Quick first step; keeps the glove down on grounders." }), "evaluator note");
  // REAL: the Sessions page's lock and release, as admin.jordan.
  for (const age of [9, 10, 11, 12, 13, 14, 15, 16]) await must(admin.rpc("change_evaluation_session_stage", { p_session_id: sessionByAge[age], p_action: "lock" }), `lock age ${age}`);
  for (const age of [9, 10, 11, 12]) await must(admin.rpc("change_evaluation_session_stage", { p_session_id: sessionByAge[age], p_action: "release" }), `release age ${age}`);
  await must(svc.from("seasons").update({ show_prior_year_during_evaluations: true }).eq("id", s2027.id), "prior-year switch");

  // A registrar for check-in.
  const { data: existingUsers } = await svc.auth.admin.listUsers({ perPage: 1000 });
  const registrar = { user: { id: await ensureUser(svc, existingUsers, "registrar.riley@example.com", password, "Riley Registrar") } };
  await must(svc.from("user_roles").insert({ user_id: registrar.user.id, role_name: "registrar", season_id: s2027.id, created_by: adminId }), "registrar role");

  // Check-in at today's primary event: about three quarters of ages 7 and 8 are here.
  const events = await must(svc.from("evaluation_session_events").select("id, evaluation_session_id").eq("event_type", "primary"), "read events");
  const eventFor = (age) => events.find((e) => e.evaluation_session_id === sessionByAge[age]).id;
  const checkins = [7, 8].flatMap((age) => byAge(age).filter((_, i, all) => i < Math.ceil(all.length * 0.75))
    .map((r, i) => ({ player_season_id: r.id, event_id: eventFor(age), checked_in_by: registrar.user.id, checked_in_at: at(60 - i) })));
  await must(svc.from("player_checkins").insert(checkins), "check-ins");

  // An announcer, who has called up the players already scored in ages 7 and 8 (oldest call first).
  const announcer = await ensureUser(svc, existingUsers, "announcer.alex@example.com", password, "Alex Announcer");
  await must(svc.from("user_roles").insert({ user_id: announcer, role_name: "announcer", season_id: s2027.id, created_by: adminId }), "announcer role");
  const calls = [7, 8].flatMap((age) => byAge(age).filter((_, i, all) => i < Math.ceil(all.length * 0.6))
    .map((r, i) => ({ player_season_id: r.id, event_id: eventFor(age), called_by: announcer, called_at: at(50 - i) })));
  await must(svc.from("player_calls").insert(calls), "calls");

  // An injured age-7 player excused from attending.
  const injured = byAge(7).at(-1);
  await must(svc.from("player_exemptions").insert({ player_season_id: injured.id, scope: "attendance", reason: "Broken wrist; doctor's note on file", approved_by_name: "Safety officer", recorded_by: adminId }), "exemption");

  // Coach's kids (the league's draft rules decide what that means).
  const kids = [9, 10, 11, 12].map((age) => byAge(age)[2]);
  await must(svc.from("player_seasons").update({ is_coach_kid: true }).in("id", kids.map((k) => k.id)), "coach kids");

  // A walk-up who was already registered: shows up under Possible duplicates.
  const twin = byAge(8)[1];
  const walk = await must(svc.from("players").insert({ first_name: twin.players.first_name, last_name: twin.players.last_name }).select("id").single(), "walk-up player");
  await must(svc.from("player_seasons").insert({ player_id: walk.id, season_id: s2027.id, league_age: 8, evaluation_number: 990, registration_source: "on_site", league_age_source: "admin" }), "walk-up registration");

  // Avery's private notes and stars on released age 9.
  const avery = userId["COA-01"];
  await must(svc.from("player_stars").insert([nine[0], nine[4], nine[7]].map((r) => ({ user_id: avery, player_season_id: r.id }))), "stars");
  await must(svc.from("private_notes").insert([
    { player_season_id: nine[0].id, author_user_id: avery, note_text: "Great hands at short. Ask about spring travel schedule." },
    { player_season_id: nine[4].id, author_user_id: avery, note_text: "Strong arm, could pitch." },
  ]), "private notes");

  log(`DEMO staged for ${DEMO_DATE} (makeup ${addDays(DEMO_DATE, 7)}): ${saved} scores; ages 7-8 open, 9-12 released, 13-16 locked;`);
  log(`  ${calls.length} players called by announcer.alex@example.com.`);
  log(`  ${checkins.length} check-ins, 1 exemption, ${kids.length} coach's kids, 1 possible duplicate (walk-up bib 990), prior-year shown while scoring.`);
  log("  Registrar: registrar.riley@example.com. Avery (coach.avery@example.com) has age 7 left to score.");
  if (BOARD_SEATS) log(`  Board seats: board1@example.com to board${BOARD_SEATS}@example.com, coaches assigned to age 8 (open).`);
  log("\nPASS: demo league loaded. Follow docs/DEMO-SCRIPT.md. Re-run it the morning of the demo so the event date is today.");
}

main().catch((e) => fail(e.stack || e.message));
