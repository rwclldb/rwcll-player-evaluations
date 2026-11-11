// Browser test: scoring screen navigation on a phone-sized screen.
//
// Guards against the 2026-11-10 bug where moving between players reused the scoring form, so a
// just-submitted player showed blank ratings (and the screen could disagree with the database).
//
// Needs:  local Supabase with the fictional league loaded and sessions open
//           (npm run fixtures:load -- --reset --open-sessions)
//         the app running (npm run dev), default http://localhost:3000 (override: E2E_BASE_URL)
//         Chrome or Edge installed (override: CHROME_PATH)
// Run:    npm run e2e:evaluation-navigation
//
// Signs in as eval.kendall@example.com, picks two neighbouring players nobody has scored yet,
// checks every step, then deletes the evaluation it created (local database only).
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright-core");

const root = path.resolve(__dirname, "..");
const APP = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EVALUATOR = "eval.kendall@example.com";
const CORE = ["hitting", "throwing", "grounders", "fly_balls", "running_awareness"];

let failures = 0;
const pass = (msg) => console.log(`PASS: ${msg}`);
const check = (ok, msg, detail = "") => { if (ok) pass(msg); else { failures++; console.log(`FAIL: ${msg}${detail ? ` (${detail})` : ""}`); } };
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

async function shown(page) {
  return page.evaluate((core) => core.map((c) => {
    const el = document.querySelector(`input[name="rating_${c}"]:checked`);
    return el ? el.value || "-" : "?";
  }).join(" "), CORE);
}
const bibOnPage = (page) => page.locator("p.font-mono.text-3xl").first().textContent();

(async () => {
  try { await fetch(`${APP}/auth/login`); } catch { stop(`app is not running at ${APP} (npm run dev)`); }

  // Two neighbouring, unscored players in an open session assigned to the evaluator (bib order = screen order).
  const pick = sql(`
    WITH me AS (SELECT id FROM auth.users WHERE email = '${EVALUATOR}'),
    s AS (SELECT es.id, es.season_id, es.league_age FROM public.evaluation_sessions es
          JOIN public.evaluator_assignments ea ON ea.evaluation_session_id = es.id AND ea.evaluator_user_id = (SELECT id FROM me)
          WHERE es.status = 'open' ORDER BY es.league_age LIMIT 1),
    r AS (SELECT ps.id, ps.evaluation_number,
                 lead(ps.id) OVER w AS next_id, lead(ps.evaluation_number) OVER w AS next_bib,
                 EXISTS (SELECT 1 FROM public.evaluations e WHERE e.player_season_id = ps.id) AS scored,
                 lead(EXISTS (SELECT 1 FROM public.evaluations e WHERE e.player_season_id = ps.id)) OVER w AS next_scored
          FROM public.player_seasons ps JOIN public.players p ON p.id = ps.player_id, s
          WHERE ps.season_id = s.season_id AND ps.league_age = s.league_age
          WINDOW w AS (ORDER BY ps.evaluation_number NULLS LAST, p.last_name, p.first_name))
    SELECT s.id, r.id, r.evaluation_number, r.next_id, r.next_bib FROM r, s
    WHERE NOT r.scored AND r.next_id IS NOT NULL AND NOT r.next_scored AND r.evaluation_number IS NOT NULL AND r.next_bib IS NOT NULL
    ORDER BY r.evaluation_number LIMIT 1;`);
  if (!pick) stop(`no open session with two neighbouring unscored players for ${EVALUATOR}. Run: npm run fixtures:load -- --reset --open-sessions`);
  const [sessionId, aId, aBib, bId, bBib] = pick.split("|");
  console.log(`Using session ${sessionId}: bib #${aBib} then #${bBib}`);

  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  let dialogs = 0;
  page.on("dialog", (d) => { dialogs++; d.accept(); });

  try {
    await page.goto(`${APP}/auth/login`);
    await page.fill("#email", EVALUATOR);
    await page.fill("#password", env.FIXTURE_PASSWORD);
    await Promise.all([page.waitForURL(/\/protected/), page.click('button[type="submit"]')]);

    // Bib search from the list goes to the right player.
    await page.goto(`${APP}/protected/evaluations?sessionId=${sessionId}`);
    await page.fill("#bib-search", aBib);
    await page.getByRole("button", { name: "Go" }).click();
    await page.waitForURL(new RegExp(`player=${aId}`));
    await page.waitForSelector("text=Save & Next");
    check((await bibOnPage(page)) === `#${aBib}`, `bib search opens #${aBib}`);
    check((await shown(page)) === "- - - - -", "unscored player starts blank", await shown(page));

    const scores = [4, 3, 5, 2, 4];
    for (let i = 0; i < CORE.length; i++) await page.locator(`input[name="rating_${CORE[i]}"][value="${scores[i]}"]`).locator("xpath=..").click();
    await page.getByRole("button", { name: /Save & Next/ }).click();
    await page.waitForURL(new RegExp(`player=${bId}`));
    await page.waitForSelector("text=Showing the next player");
    check((await bibOnPage(page)) === `#${bBib}`, `Save & Next moves to #${bBib}`);
    check((await shown(page)) === "- - - - -", "next player starts blank (nothing carried over)", await shown(page));

    await page.locator('input[name="rating_hitting"][value="1"]').locator("xpath=..").click();
    check((await shown(page)) === "1 - - - -", "tapping one rating on the next player does not bring back the previous player's scores", await shown(page));

    await page.getByRole("link", { name: new RegExp(`#${aBib}`) }).first().click();
    await page.waitForURL(new RegExp(`player=${aId}(&|$)`));
    await page.waitForSelector('input[name="rating_hitting"][value="4"]:checked', { state: "attached" });
    check(dialogs === 1, "leaving with an unsaved tap asks for confirmation");
    check((await shown(page)) === "4 3 5 2 4", `going back to #${aBib} shows the saved scores`, await shown(page));

    await page.locator('input[name="rating_throwing"][value="5"]').locator("xpath=..").click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForSelector("text=Saved. You can still change it");
    check((await shown(page)) === "4 5 5 2 4", "Save keeps showing the updated scores", await shown(page));

    const saved = sql(`SELECT e.status || ' ' || string_agg(r.score::text, ' ' ORDER BY rc.sort_order)
      FROM public.evaluations e JOIN public.ratings r ON r.evaluation_id = e.id JOIN public.rating_categories rc ON rc.id = r.rating_category_id
      WHERE e.player_season_id = ${aId} AND e.evaluator_user_id = (SELECT id FROM auth.users WHERE email = '${EVALUATOR}') GROUP BY e.status;`);
    check(saved === "submitted 4 5 5 2 4", "database matches the screen", saved);

    // Shared note (independent evaluator): saved with the ratings and shown again after the reload.
    await page.fill("#player-note", "E2E shared note: quick first step");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForSelector("text=Saved. You can still change it");
    check((await page.inputValue("#player-note")) === "E2E shared note: quick first step", "shared note is shown again after saving");
    const note = sql(`SELECT n.note_text FROM public.evaluator_notes n JOIN public.evaluations e ON e.id = n.evaluation_id
      WHERE e.player_season_id = ${aId} AND e.evaluator_user_id = (SELECT id FROM auth.users WHERE email = '${EVALUATOR}');`);
    check(note === "E2E shared note: quick first step", "shared note is in the database", note);
    check(sql(`SELECT count(*) FROM public.evaluations WHERE player_season_id = ${bId};`) === "0", "the unsaved tap on the next player was not saved");
  } finally {
    await browser.close();
    // Remove what this test created so it can run again (local only; session is open so deletes are allowed).
    // A submitted evaluation must keep a core rating, so move it back to draft before deleting.
    sql(`DELETE FROM public.evaluator_notes WHERE evaluation_id IN (SELECT id FROM public.evaluations WHERE player_season_id IN (${aId}, ${bId}));
         UPDATE public.evaluations SET status = 'draft' WHERE player_season_id IN (${aId}, ${bId});
         DELETE FROM public.ratings WHERE evaluation_id IN (SELECT id FROM public.evaluations WHERE player_season_id IN (${aId}, ${bId}));
         DELETE FROM public.experience_answers WHERE evaluation_id IN (SELECT id FROM public.evaluations WHERE player_season_id IN (${aId}, ${bId}));
         DELETE FROM public.evaluations WHERE player_season_id IN (${aId}, ${bId});`);
  }

  if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
  console.log("\nPASS: scoring screen navigation (browser, phone-sized)");
})().catch((e) => stop(e.stack || e.message));
