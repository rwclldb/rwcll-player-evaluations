// Browser test: scoring with no signal, on a phone-sized screen.
//
// Scores two players with the browser offline, checks they are kept on the device (status, header badge, nothing
// in the database), reopens the app online and checks they are sent automatically and match what was entered.
// Also checks that a save the server refuses is shown in red and can be discarded.
//
// Needs:  local Supabase with the fictional league loaded and sessions open
//           (npm run fixtures:load -- --reset --open-sessions)
//         the app running (npm run dev), default http://localhost:3000 (override: E2E_BASE_URL)
//         Chrome or Edge installed (override: CHROME_PATH)
// Run:    npm run e2e:offline-scoring
//
// Signs in as eval.kendall@example.com and deletes the evaluations it created (local database only).
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright-core");

const root = path.resolve(__dirname, "..");
const APP = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EVALUATOR = "eval.kendall@example.com";
const CORE = ["hitting", "throwing", "grounders", "fly_balls", "running_awareness"];

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

const tap = (page, code, value) => page.locator(`input[name="rating_${code}"][value="${value}"]`).locator("xpath=..").click();
const badge = (page) => page.locator("header summary", { hasText: "not sent" });
const savedScores = (psId) => sql(`SELECT e.status || ' ' || string_agg(r.score::text, ' ' ORDER BY rc.sort_order)
  FROM public.evaluations e JOIN public.ratings r ON r.evaluation_id = e.id JOIN public.rating_categories rc ON rc.id = r.rating_category_id
  WHERE e.player_season_id = ${psId} AND e.evaluator_user_id = (SELECT id FROM auth.users WHERE email = '${EVALUATOR}') GROUP BY e.status;`);

async function signIn(page) {
  await page.goto(`${APP}/auth/login`);
  await page.fill("#email", EVALUATOR);
  await page.fill("#password", env.FIXTURE_PASSWORD);
  await Promise.all([page.waitForURL(/\/protected/), page.click('button[type="submit"]')]);
}

(async () => {
  try { await fetch(`${APP}/auth/login`); } catch { stop(`app is not running at ${APP} (npm run dev)`); }

  // Three neighbouring players nobody has scored, in an open session assigned to the evaluator.
  const pick = sql(`
    WITH me AS (SELECT id FROM auth.users WHERE email = '${EVALUATOR}'),
    s AS (SELECT es.id, es.season_id, es.league_age FROM public.evaluation_sessions es
          JOIN public.evaluator_assignments ea ON ea.evaluation_session_id = es.id AND ea.evaluator_user_id = (SELECT id FROM me)
          WHERE es.status = 'open' ORDER BY es.league_age LIMIT 1),
    r AS (SELECT ps.id, ps.evaluation_number AS bib,
                 lead(ps.id) OVER w AS next_id, lead(ps.evaluation_number) OVER w AS next_bib,
                 NOT EXISTS (SELECT 1 FROM public.evaluations e WHERE e.player_season_id = ps.id) AS free,
                 lead(NOT EXISTS (SELECT 1 FROM public.evaluations e WHERE e.player_season_id = ps.id)) OVER w AS next_free
          FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id, s
          WHERE ps.season_id = s.season_id AND ps.league_age = s.league_age
          WINDOW w AS (ORDER BY ps.evaluation_number NULLS LAST, p.last_name, p.first_name))
    SELECT s.id, r.id, r.bib, r.next_id, r.next_bib FROM r, s
    WHERE r.free AND r.next_free AND r.bib IS NOT NULL AND r.next_bib IS NOT NULL
    ORDER BY r.bib DESC LIMIT 1;`);
  if (!pick) stop(`no open session with two neighbouring unscored players for ${EVALUATOR}. Run: npm run fixtures:load -- --reset --open-sessions`);
  const [sessionId, aId, aBib, bId, bBib] = pick.split("|");
  console.log(`Using session ${sessionId}: bib #${aBib} then #${bBib}`);

  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await signIn(page);
    await page.goto(`${APP}/protected/evaluations?sessionId=${sessionId}&player=${aId}`, { waitUntil: "networkidle" });
    await page.waitForSelector("text=Save & Next");

    // ---- no signal ----
    await context.setOffline(true);
    for (let i = 0; i < CORE.length; i++) await tap(page, CORE[i], [3, 4, 2, 5, 1][i]);
    await page.fill("#player-note", "Offline note");
    await page.getByRole("button", { name: /Save & Next/ }).click();
    await page.waitForSelector("text=Saved on this phone");
    check(page.url().includes(`player=${bId}`), `Save & Next with no signal still moves to #${bBib}`);
    await tap(page, "hitting", 2);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForSelector("text=Saved on this phone");
    check((await badge(page).innerText()).includes("2 not sent"), "the header shows 2 not sent");
    check(sql(`SELECT count(*) FROM public.evaluations WHERE player_season_id IN (${aId}, ${bId});`) === "0", "nothing reached the database yet");

    await page.locator("a", { hasText: "All players" }).first().click();
    await page.waitForSelector("#bib-search");
    check((await page.locator("text=On phone (not sent)").count()) === 2, "the list marks both players On phone (not sent)");
    check((await page.locator("text=No signal. Keep scoring").count()) === 1, "the list says there is no signal");
    await page.locator("li a", { hasText: `${aBib}` }).first().click();
    await page.waitForSelector('input[name="rating_hitting"][value="3"]:checked', { state: "attached" });
    check((await page.inputValue("#player-note")) === "Offline note", "reopening the first player shows the scores and note kept on the phone");

    // ---- back online, in a fresh page (as after the phone reloads the tab) ----
    await page.close();
    await context.setOffline(false);
    const again = await context.newPage();
    await again.goto(`${APP}/protected`, { waitUntil: "networkidle" });
    await again.waitForFunction(() => !document.querySelector("header summary")?.textContent?.includes("not sent"), null, { timeout: 30000 });
    check(true, "back online, the badge clears on its own");
    check(savedScores(aId) === "submitted 3 4 2 5 1", "first player's scores reached the database", savedScores(aId));
    check(savedScores(bId) === "submitted 2", "second player's score reached the database", savedScores(bId));
    const note = sql(`SELECT n.note_text FROM public.evaluator_notes n JOIN public.evaluations e ON e.id = n.evaluation_id
      WHERE e.player_season_id = ${aId} AND e.evaluator_user_id = (SELECT id FROM auth.users WHERE email = '${EVALUATOR}');`);
    check(note === "Offline note", "the note was sent too", note);
    await again.goto(`${APP}/protected/evaluations?sessionId=${sessionId}`, { waitUntil: "networkidle" });
    check((await again.locator("text=On phone (not sent)").count()) === 0, "the list shows them as saved");

    // ---- a save the server refuses ----
    const userId = sql(`SELECT id FROM auth.users WHERE email = '${EVALUATOR}';`);
    await again.evaluate(({ userId, sessionId }) => {
      const key = `rwcll:unsent:v1:${userId}`;
      const item = { key: `${sessionId}:999999999`, label: "#0 Nobody (test)", savedAt: new Date().toISOString(),
        payload: { sessionId: Number(sessionId), playerSeasonId: 999999999, intent: "submitted", ratings: { hitting: 3 }, answers: {}, noteKind: null, note: null } };
      localStorage.setItem(key, JSON.stringify([item]));
    }, { userId, sessionId });
    await again.reload({ waitUntil: "networkidle" });
    await again.waitForFunction(() => document.querySelector("header summary")?.className.includes("rose"), null, { timeout: 30000 });
    await badge(again).click();
    const panel = await again.locator("header details").innerText();
    check(/Could not save/.test(panel), "a refused save shows red with the reason", panel.replace(/\s+/g, " ").slice(0, 160));
    again.once("dialog", (d) => d.accept());
    await again.getByRole("button", { name: "Discard" }).click();
    await again.waitForFunction(() => !document.querySelector("header summary"), null, { timeout: 10000 });
    check(true, "Discard removes it");
  } finally {
    await browser.close();
    sql(`DELETE FROM public.evaluator_notes WHERE evaluation_id IN (SELECT id FROM public.evaluations WHERE player_season_id IN (${aId}, ${bId}));
         UPDATE public.evaluations SET status = 'draft' WHERE player_season_id IN (${aId}, ${bId});
         DELETE FROM public.ratings WHERE evaluation_id IN (SELECT id FROM public.evaluations WHERE player_season_id IN (${aId}, ${bId}));
         DELETE FROM public.experience_answers WHERE evaluation_id IN (SELECT id FROM public.evaluations WHERE player_season_id IN (${aId}, ${bId}));
         DELETE FROM public.evaluations WHERE player_season_id IN (${aId}, ${bId});`);
  }

  if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
  console.log("\nPASS: offline scoring (browser, phone-sized)");
})().catch((e) => stop(e.stack || e.message));
