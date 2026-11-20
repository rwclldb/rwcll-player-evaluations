// Browser test: a mock Majors draft, run by the admin while the Cubs manager watches on a phone.
//
// Starts the Majors draft from its setup page, checks the automatic coach's-kid picks in round 1, a sibling decision,
// a coach's kid another team can't take, the manager's screen updating without a reload, Pause showing on the manager's
// screen, the must-draft rule and its override note, fixing a wrong pick from Team rosters, the projector view and
// Finish. Then puts the Majors draft back exactly as it was (in setup, nobody placed).
//
// Needs:  local Supabase with the board demo at draft day, Majors draft not started
//           (npm run demo:load, then npm run demo:draft-day)
//         the app running (npm run dev), default http://localhost:3000 (override: E2E_BASE_URL)
//         Chrome or Edge installed (override: CHROME_PATH)
// Run:    npm run e2e:draft
//         E2E_SHOTS=<folder> also saves light-theme screenshots (Teams, the draft room, the manager's phone, Make teams)
//         for the board deck.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright-core");

const root = path.resolve(__dirname, "..");
const APP = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const ADMIN = "admin.jordan@example.com";
const MANAGER = "coach.finley@example.com"; // Finley Moss: Majors Cubs manager

let failures = 0;
const check = (ok, msg, detail = "") => { if (ok) console.log(`PASS: ${msg}`); else { failures++; console.log(`FAIL: ${msg}${detail ? ` (${detail})` : ""}`); } };
const stop = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
if (!/^http:\/\/(127\.0\.0\.1|localhost):54321\/?$/.test(env.NEXT_PUBLIC_SUPABASE_URL ?? "")) stop(".env.local must point at local Supabase");
if (!env.FIXTURE_PASSWORD) stop("FIXTURE_PASSWORD missing from .env.local (load the fixtures first)");
const projectId = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8").match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
function sql(query) {
  const r = spawnSync("docker", ["exec", "-i", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8" });
  if (r.status !== 0) stop(`local database query failed: ${r.stderr}`);
  return r.stdout.trim();
}
const chromePath = process.env.CHROME_PATH || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].find((p) => fs.existsSync(p));
if (!chromePath) stop("No Chrome or Edge found. Set CHROME_PATH.");

// ---------- the Majors draft, before ----------
const draftRow = sql(`SELECT dr.id || '|' || dr.season_division_id || '|' || dr.status || '|' || (SELECT count(*) FROM public.draft_picks p WHERE p.draft_id = dr.id)
  FROM public.drafts dr JOIN public.season_divisions sd ON sd.id = dr.season_division_id JOIN public.divisions d ON d.id = sd.division_id
  JOIN public.seasons s ON s.id = dr.season_id WHERE d.name = 'Majors' AND s.name = 'Spring 2027'`);
if (!draftRow) stop("No Spring 2027 Majors draft. Run npm run demo:load, then npm run demo:draft-day.");
const [DRAFT, DIVISION, status, picks] = draftRow.split("|");
if (status !== "setup" || picks !== "0") stop(`The Majors draft has already started (${status}, ${picks} picks). Reload with npm run demo:load and npm run demo:draft-day.`);
if (sql(`SELECT count(*) FROM public.evaluation_sessions es JOIN public.seasons s ON s.id = es.season_id WHERE s.name = 'Spring 2027' AND es.league_age BETWEEN 10 AND 12 AND es.published_at IS NULL`) !== "0") {
  stop("Ages 10-12 aren't released. Run npm run demo:draft-day first.");
}
const STARTED = sql("SELECT now()");
const kidRoundsBefore = sql(`SELECT COALESCE(json_agg(k), '[]') FROM public.draft_kid_rounds k WHERE k.draft_id = ${DRAFT}`);
const finley = sql(`SELECT id FROM auth.users WHERE email = '${MANAGER}'`);

function restore() {
  // Put the Majors draft back in setup with nobody placed; remove everything this test made (the audit log keeps it all).
  sql(`BEGIN;
    UPDATE public.player_seasons SET team_id = NULL, season_division_id = NULL
      WHERE id IN (SELECT player_season_id FROM public.draft_picks WHERE draft_id = ${DRAFT})
         OR id IN (SELECT player_season_id FROM public.roster_moves WHERE moved_at >= '${STARTED}');
    DELETE FROM public.draft_picks WHERE draft_id = ${DRAFT};
    DELETE FROM public.draft_sibling_queue WHERE draft_id = ${DRAFT};
    DELETE FROM public.draft_sibling_asks WHERE draft_id = ${DRAFT};
    DELETE FROM public.draft_tiers WHERE draft_id = ${DRAFT};
    DELETE FROM public.draft_leftovers WHERE draft_id = ${DRAFT};
    DELETE FROM public.draft_kid_rounds WHERE draft_id = ${DRAFT};
    INSERT INTO public.draft_kid_rounds (draft_id, player_season_id, round, team_id)
      SELECT draft_id, player_season_id, round, team_id FROM json_populate_recordset(NULL::public.draft_kid_rounds, '${kidRoundsBefore}');
    DELETE FROM public.division_pool_overrides WHERE created_at >= '${STARTED}';
    DELETE FROM public.roster_moves WHERE moved_at >= '${STARTED}';
    DELETE FROM public.player_stars WHERE user_id = '${finley}' AND created_at >= '${STARTED}';
    UPDATE public.drafts SET status = 'setup', started_at = NULL, finished_at = NULL, clock_started_at = NULL WHERE id = ${DRAFT};
    COMMIT;`);
}

const SHOTS = process.env.E2E_SHOTS ? path.resolve(process.env.E2E_SHOTS) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
async function shot(page, name, url) {
  if (!SHOTS) return;
  if (url) await page.goto(url, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal{display:none !important}" }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function signIn(browser, email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", ...opts });
  await ctx.addInitScript(() => { try { localStorage.setItem("theme", "light"); } catch {} });
  const page = await ctx.newPage();
  await page.goto(`${APP}/auth/login`);
  await page.fill("#email", email);
  await page.fill("#password", env.FIXTURE_PASSWORD);
  await Promise.all([page.waitForURL(/\/protected/), page.click('button[type="submit"]')]);
  return page;
}
const pickBar = (page) => page.locator("div.fixed").filter({ hasText: /^Pick / });
const header = async (page) => (await page.locator("main h1").first().locator("xpath=../..").innerText()).replace(/\s+/g, " ");
async function answerSiblings(page, take) {
  const alert = page.getByRole("alert").filter({ hasText: "sibling" });
  if (await alert.count()) { await page.getByRole("button", { name: take ? "Take with next pick" : "Send down" }).first().click(); await page.waitForTimeout(1200); return true; }
  return false;
}
async function pick(page, playerId, note = "") {
  await page.locator(`li[data-player="${playerId}"]`).click();
  if (note) await page.getByLabel("Override note").fill(note);
  await pickBar(page).getByRole("button", { name: /^Pick for/ }).click();
  await page.waitForTimeout(1200);
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath });
  try {
    const admin = await signIn(browser, ADMIN);
    const manager = await signIn(browser, MANAGER, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    await shot(admin, "draft-teams", `${APP}/protected/teams`);
    // ---------- start ----------
    await admin.goto(`${APP}/protected/drafts/${DIVISION}`);
    await admin.getByText("Start the draft…").click();
    await Promise.all([admin.waitForURL(/\/room/, { timeout: 60000 }), admin.getByRole("button", { name: /Yes, start the Majors draft/ }).click()]);
    check(sql(`SELECT status FROM public.drafts WHERE id = ${DRAFT}`) === "live", "the admin starts the Majors draft from its setup page");
    await manager.goto(`${APP}/protected/drafts/${DIVISION}/room`);
    check((await header(manager)).includes("On the clock"), "the Cubs manager opens the live draft on a phone");

    // ---------- round 1, with the sibling decision ----------
    const id = (first, last) => sql(`SELECT ps.id FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id JOIN public.seasons s ON s.id = ps.season_id
      WHERE s.name = 'Spring 2027' AND p.first_name = '${first}' AND p.last_name = '${last}'`);
    const tess = id("Tess", "Whitaker"), leo = id("Leo", "Whitaker"), ivy = id("Ivy", "Lawson");
    const overall = async (page) => (await header(page)).match(/\((\d+) overall\)/)?.[1];
    const managerBefore = await overall(manager);
    await pick(admin, tess);
    check(await admin.getByRole("alert").filter({ hasText: "Leo Whitaker" }).count() === 1, "picking Tess Whitaker asks about her brother Leo (10)");
    await admin.getByRole("button", { name: "Take with next pick" }).click();
    await admin.waitForTimeout(1500);
    check((await admin.locator("table").first().innerText()).includes("Sibling: Leo Whitaker"), "Leo is shown in his sister's team's next slot");
    // The manager's phone updates without a reload.
    let seen = false;
    for (let t = 0; t < 16 && !seen; t++) { await manager.waitForTimeout(500); seen = (await overall(manager)) !== managerBefore; }
    check(seen, "the manager's screen moves on by itself within a few seconds", `still ${managerBefore}`);
    // Another team can't take the Cubs' coach's kid.
    const onClock = (await header(admin)).match(/On the clock: (\S+)/)?.[1];
    if (onClock !== "Cubs") {
      await admin.locator(`li[data-player="${ivy}"]`).click();
      const bar = await pickBar(admin).innerText();
      check(bar.includes("Coach's kid of Cubs") && await pickBar(admin).getByRole("button", { name: /^Pick for/ }).isDisabled(), "another team can't take the Cubs coach's kid");
      await pickBar(admin).getByRole("button", { name: "Cancel" }).click();
    }
    // Finish round 1 with the best available non-must players (10-11s who asked for Majors).
    const next = () => admin.evaluate(() => {
      const li = [...document.querySelectorAll("li[data-player]")].find((x) => x.dataset.must === "no" && x.dataset.reserved === "no" && x.dataset.queued === "no");
      return li ? Number(li.dataset.player) : null;
    });
    while (Number(sql(`SELECT COALESCE(min(s.round), 99) FROM private.draft_next_slot(${DRAFT}) s`)) === 1) {
      if (await answerSiblings(admin, false)) continue;
      const p = await next(); if (!p) break;
      await pick(admin, p);
    }
    const kids = sql(`SELECT string_agg(pl.first_name || ' ' || pl.last_name || '>' || t.name, ', ' ORDER BY pl.last_name) FROM public.draft_picks dp
      JOIN public.player_seasons ps ON ps.id = dp.player_season_id JOIN public.players pl ON pl.id = ps.player_id JOIN public.teams t ON t.id = dp.team_id
      WHERE dp.draft_id = ${DRAFT} AND dp.kind = 'coach_kid' AND dp.round = 1`);
    check(kids === "Owen Moss>Cubs, Gabe Ortiz>Rays, Mateo Ramirez>Giants", "round 1: each coach's kid went to the parent's team automatically", kids);
    check(sql(`SELECT team_id = (SELECT team_id FROM public.draft_picks WHERE draft_id = ${DRAFT} AND player_season_id = ${tess}) FROM public.draft_picks WHERE draft_id = ${DRAFT} AND player_season_id = ${leo}`) === "t"
      || sql(`SELECT count(*) FROM public.draft_sibling_queue WHERE draft_id = ${DRAFT} AND player_season_id = ${leo}`) === "1", "Leo goes (or is queued) to his sister's team");

    if (SHOTS) {
      await shot(admin, "draft-room");
      await shot(manager, "draft-phone-players");
      await manager.getByRole("button", { name: "Board" }).click();
      await shot(manager, "draft-phone-board");
      await manager.getByRole("button", { name: "Players" }).click();
      const maker = await admin.context().newPage();
      await shot(maker, "draft-make-teams", `${APP}/protected/drafts/${sql(`SELECT sd.id FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id WHERE sd.season_id = (SELECT season_id FROM public.drafts WHERE id = ${DRAFT}) AND d.name = 'AA'`)}/make-teams`);
      await maker.close();
    }
    // ---------- pause shows on the manager's phone ----------
    await admin.getByRole("button", { name: "Pause" }).click();
    await manager.waitForTimeout(5000);
    check((await header(manager)).includes("PAUSED"), "Pause shows on the manager's phone within a few seconds");
    await admin.getByRole("button", { name: "Resume" }).click();
    await admin.waitForTimeout(1200);

    // ---------- must-draft: keep taking 10-11s until only must-draft players are allowed ----------
    let blocked = false;
    for (let i = 0; i < 60 && !blocked; i++) {
      if (await answerSiblings(admin, false)) continue;
      const p = await next(); if (!p) break;
      await admin.locator(`li[data-player="${p}"]`).click();
      const bar = await pickBar(admin).innerText();
      if (bar.includes("Only must-draft players can be picked now")) {
        blocked = await pickBar(admin).getByRole("button", { name: /^Pick for/ }).isDisabled();
        await admin.getByLabel("Override note").fill("E2E: board approved");
        await pickBar(admin).getByRole("button", { name: /^Pick for/ }).click();
        await admin.waitForTimeout(1200);
        break;
      }
      await pickBar(admin).getByRole("button", { name: /^Pick for/ }).click();
      await admin.waitForTimeout(1000);
    }
    check(blocked, "near the end, a non-must-draft pick is held until there's a note");
    check(sql(`SELECT count(*) FROM public.draft_picks WHERE draft_id = ${DRAFT} AND override_note = 'E2E: board approved'`) === "1", "with a note the pick is made and the note is kept");

    // ---------- fixing a wrong pick from Team rosters ----------
    const last = sql(`SELECT player_season_id || '|' || overall || '|' || pl.last_name || ', ' || pl.first_name FROM public.draft_picks dp
      JOIN public.player_seasons ps ON ps.id = dp.player_season_id JOIN public.players pl ON pl.id = ps.player_id
      WHERE dp.draft_id = ${DRAFT} ORDER BY dp.made_at DESC LIMIT 1`).split("|");
    const rosters = await admin.context().newPage();
    await rosters.goto(`${APP}/protected/team-rosters`);
    await rosters.getByLabel("Find a player").fill(last[2]);
    await rosters.getByRole("button", { name: `Move ${last[2]}` }).click();
    await rosters.getByLabel("Move to").selectOption("pool");
    await rosters.getByLabel("Note").fill("E2E: wrong pick");
    await rosters.getByRole("button", { name: "Save" }).click();
    await rosters.waitForTimeout(1500);
    check(sql(`SELECT overall FROM private.draft_next_slot(${DRAFT})`) === last[1], "moving the last pick back to the pool reopens that pick");
    await rosters.close();

    // ---------- projector, finish ----------
    const projector = await admin.context().newPage();
    await projector.goto(`${APP}/protected/drafts/${DIVISION}/room?view=board`);
    const onTheClock = await projector.getByText("Latest picks").first().waitFor({ timeout: 30000 }).then(() => true, () => false);
    check(onTheClock && (await projector.locator("main").innerText()).toUpperCase().includes("ON THE CLOCK"), "the projector view shows who's on the clock and the latest picks");
    await projector.close();
    await admin.reload();
    admin.once("dialog", (d) => d.accept());
    await admin.getByRole("button", { name: "Finish draft" }).click();
    await admin.waitForTimeout(2000);
    check(sql(`SELECT status FROM public.drafts WHERE id = ${DRAFT}`) === "done" && Number(sql(`SELECT count(*) FROM public.draft_leftovers WHERE draft_id = ${DRAFT}`)) > 0,
      "Finish draft: the undrafted players are left over for the next division");
    check(sql(`SELECT count(*) FROM private.division_pool((SELECT sd.id FROM public.season_divisions sd JOIN public.divisions d ON d.id = sd.division_id
      WHERE sd.season_id = (SELECT season_id FROM public.drafts WHERE id = ${DRAFT}) AND d.name = 'AAA')) WHERE reason = 'from_above'`) !== "0",
      "left-over 10-11s join the AAA pool");
  } finally {
    await browser.close();
    restore();
    const after = sql(`SELECT status || '|' || (SELECT count(*) FROM public.draft_picks WHERE draft_id = ${DRAFT}) FROM public.drafts WHERE id = ${DRAFT}`);
    console.log(after === "setup|0" ? "Cleaned up: the Majors draft is back in setup with nobody placed." : `WARNING: clean-up left ${after}`);
  }
  if (failures) { console.error(`FAIL: ${failures} draft check(s) failed`); process.exit(1); }
  console.log("PASS: the Majors draft works in the browser");
})().catch((e) => { console.error(e); try { restore(); } catch {} process.exit(1); });
