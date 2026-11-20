# Board demo: run sheet

About 40 minutes: 5 minutes of slides, 27 minutes of live demo (8 of them the draft), then questions.
The deck `RWCLL-Player-Evaluations-Board.pptx` (same folder) is the backup: every
demo step has a matching slide with speaker notes, so you can switch to slides at
any point.

Everything in the demo is fictional: the "Fixture Park" league, 357 made-up
players, about 70 test accounts. Nothing touches the hosted site.

---

## The morning of the demo (15 minutes)

1. **Start Docker Desktop**, then check Supabase: `npx supabase status`.
   If it isn't running: `npx supabase start`.
2. **Load the demo league** (wipes local data and reloads it, about 5 minutes):

   ```
   npm run demo:load
   ```

   It dates evaluation day **today**, so check-in and the "Here" badges work live.
   It should end with `PASS: demo league loaded`. Presenting on another day?
   `npm run fixtures:load -- --reset --demo --demo-date=2026-12-10`.
3. **Run the app in production mode** (faster, no developer badge in the corner).
   Stop any `npm run dev` first:

   ```
   npm run build
   npm run start
   ```

   Leave that terminal open. The app is at http://localhost:3000.
4. **Open three browser windows** (each keeps its own sign-in). The password for
   every account is `FIXTURE_PASSWORD` in `.env.local`.

   | Window | How to open it | Sign in as | Set up |
   |---|---|---|---|
   | **A: Admin** | Normal Chrome window | `admin.jordan@example.com` | Full screen |
   | **B: Coach** | Chrome Incognito (Ctrl+Shift+N) | `coach.avery@example.com` | F12 → device toolbar (Ctrl+Shift+M) → iPhone 12 Pro, zoom 100% |
   | **C: Registrar** | Chrome Guest profile (profile icon → Guest) | `registrar.riley@example.com` | F12 → device toolbar → iPhone 12 Pro |

5. **Click through once**: Window A roadmap, Window B the age 7 list, Window C
   Check-in. Don't score or check anyone in yet: Avery's age 7 list should
   still say "0 of 16 players done". (If you practised, run step 2 again.)
6. Open the deck in PowerPoint on slide 1, ready to present.

**What the demo data looks like**

- Spring 2027, 357 players ages 7–16, bibs 201–676. Sized like the real league: about 110 asking for
  Majors (68 twelve-year-olds), 8 Majors and 8 AAA teams of 12, AA about 100, Juniors 26, Seniors 15.
- Ages **7 and 8** are open for scoring (about 60% scored). Avery (coach) hasn't
  started age 7: you'll score live.
- Ages **9–12** are locked and **released** to coaches; ages **13–16** are locked.
- 46 players checked in, one injured player excused (Luke Rivera, age 7), four
  and one possible duplicate (a walk-up, Elliot Carter, bib 990).
- 27 teams with a manager and coach, 13 coach's kids linked to their parents, sibling groups, and the
  Juniors, Majors and AAA drafts set up with their order drawn (not started). See
  `rwcll-fictional-test-league/generated/draft-families-spring-2027.csv` for what each family tests.
- Avery has starred three age 9 players and written two private notes.
- An announcer (`announcer.alex@example.com`) has called about 60% of ages 7–8
  (the players already scored).

---

## The talk (with timings)

### 1. Opening (slides 1–3, 5 min)

- **Slide 1:** who you are; the app runs spring evaluations and builds the
  draft reports.
- **Slide 2, Fairer / Faster / Safer:** one sentence each.
- **Slide 3, five stages:** "The app follows our year. Today I'll show you the
  middle three." Then switch to Window A.

### 2. The admin's roadmap (Window A, 2 min)

- Home page = **Roadmap**. Point at the five stages and the badges
  ("needs attention" counts). "The app works out where we are from the data:
  most age groups are locked, so it says After evaluations."
- Click **1 Before evaluations**. "Every step has a live status and a button to
  the page that does it. I don't have to remember what's next." Walk the steps
  below from here; each page has a **Roadmap** link (top left) to come back.

### 3. Getting ready: the Before evaluations steps (Window A, 5 min)

- Step **Import registrations** → **Review imports** → **View Rows** on batch #1.
  "This is the Sports Connect export, 444 rows."
  - The **Bulk review** box says 0 out-of-scope rows and 0 clean rows: that was
    done when the league was loaded. **Don't click** "Ignore out-of-scope rows" or
    "Approve and commit clean rows" (there's nothing left for them). Say: "Normally
    this is two clicks: 86 rows from other programs ignored, 357 players added."
  - Click **Open Administrator Row Review**. The **Needs work** tab has one row:
    **Harper Oak**, "Duplicate Player ID in file". "Two children came in with the
    same Sports Connect Player Id. The app won't guess; a person decides." Don't
    decide it now.
  - "Uploading a newer export later is safe: it only adds and updates."
- Back to **Roadmap**. Step **Give every player a bib**: 3 players have no bib.
  "You'll see that again as a flag on the draft report."
- Step **Check for duplicate players** → **Possible duplicates**. "Elliot Carter
  was added as a walk-up but was already registered: two records, one child."
  (Different from Harper Oak, who isn't in the app yet.) Don't merge, or do it:
  **Keep this one** on the card with scores (bib 205), type a reason, **Merge**.
- Step **Assign age groups** → **Assignments**. "Coaches only score the age
  groups they're assigned to."
- Optional: point at step **Board decision: prior-year ratings while scoring**.
  "That's one of my questions for you at the end."

### 4. Evaluation day (Windows C, B, A, 9 min)

- **Window C (registrar):** "This is the check-in table." Tap **Check players
  in** → filter **7** → **Not here yet** → tap **Barnes, Eli (301)**.
  "One tap. Tap again to undo." Point out "1 exempt from attending" (the
  injured player).
- **Window C (registrar), calling players:** menu → **Call players** → age **7**.
  "Someone at the field calls bib numbers so players know when to go."
  **Next up** shows the next players who are here and haven't been called; Eli
  Barnes, whom you just checked in, is there. Tap **Eli Barnes** → he's marked
  **Called** (tap again to undo). "A parent volunteer can do just this job with an
  announcer account: names, bibs and ages, nothing else." (Show the announcer
  slide here if you like.)
- **Window B (coach):** Home shows "Evaluation day is today!" and Avery's age
  groups. Tap **Score** on age 7. Refresh: **Eli Barnes now shows Here and
  Called**, and he's first in the **Now up** strip at the top. "Coaches always
  know who's on the field; tap a name in Now up to open that player."
- Tap **#201 Arbor, Alex**. Tap a score for each of the five skills
  (for example 3, 4, 3, 2, 4) → **Save & Next**. "Big buttons, built for a
  phone in the sun."
- **No signal:** in DevTools (F12) choose the **Network** tab → **Offline**.
  Score #202 and **Save & Next**. Point at "On phone (not sent)" and the
  **1 not sent** badge in the header. Switch **Offline** back to **No
  throttling**: the badge clears within 15 seconds. "Nothing is lost if the
  field has no signal."
- **Window A (admin):** **Roadmap** → **3 Evaluation day** → **Watch scoring
  progress**. "Avery has started: 2 of 13. If a scorer goes quiet for 15
  minutes, it says so." Point at Age 7's **called** count: "And who was called
  but not scored yet." (After the day, **Evaluation day → End-of-day check**
  lists anyone called but missing a score, or checked in but never called.)

### 5. Draft reports (Windows A and B, 4 min)

- **Window A:** **Draft Reports** → **Age 9**. "Three columns that never get
  mixed: independent evaluators, coaches, last year's coach. The number in
  parentheses drops the highest and lowest coach score." Click **Martin, Roman**
  to open each skill. Show the **CSV**, **PDF** and **Print** buttons.
- **Flags** (last column): tap **1 unsubmitted draft** on Martin, Roman. "Every
  flag says what it means, and for admins where to fix it": the link opens that
  coach's scores for this player. Tap **No bib** on Vale, Indigo: the link goes to
  the player's page. (Press Esc to close a flag.)
- **Window B (coach):** **Draft Reports** → **Age 9** → **My stars (3)**. "Coaches
  see averages only, never another coach's scores, never evaluator names. Stars
  and private notes are theirs alone; even admins can't read them." Open
  **Vale, Indigo** to show the private note.

### 6. Teams and the draft (Windows A and B, 8 min)

**Jump to draft day first.** While you show slides 17 and 18 (the draft section), run this in a terminal (about a minute; nothing is
wiped): `npm run demo:draft-day`. Every player is scored and every age group locked and released.
Window B: menu → **Sign out**, then sign in as `coach.finley@example.com` (the Majors Cubs manager).

- **Window A:** **Roadmap** → **5 Teams and draft**. "After the reports, the app runs the draft too."
- **Draft ▾ → Teams**: 27 teams, each with a manager and a coach, loaded from the Sports Connect volunteer report.
  **Draft ▾ → Coach's kids and siblings**: "Kids are linked to their parent, and siblings found from the family's
  Sports Connect account. A person confirms each one."
- **Draft ▾ → Drafts → Majors → Open setup**: 112 players for 96 spots, 71 must be drafted (every 12-year-old and
  the coaches' kids). Point at the rules: snake order, the drawn first-round order, coach's kids in rounds 1 and 2.
  "These are switches, because our rules change every year."
- **Start the draft…** → **Yes, start**. Open **Projector** in a new tab for the room.
- Pick a few players (click a player, then **Pick for <team>** at the bottom). Pick **Tess Whitaker**: "Her brother
  Leo, a 10-year-old, could go either way: take him with the team's next pick, or send him down to AAA." Choose
  **Take with next pick**. When Giants, Cubs or Rays come up, their coach's kid goes on automatically.
- **Window B (Finley, the Cubs manager):** **Watch the draft**. "Managers watch on their phones: the same board,
  live, every rating sorted their way, including their own scores, with their private stars and notes." Show
  **My team**.
- **Window A:** **Finish draft** (you don't need all 96 picks): "Anyone not drafted drops to the next division."
- **Draft ▾ → Drafts → AA → Make teams**: "AA has no draft. The app makes balanced teams from the ratings, keeps
  coach's kids with their parent and siblings together." Point at the team averages. Don't place them (or do; it's
  reset next time you load the demo).
- **Draft ▾ → Team rosters**: every team's players, moves with a note, **Release rosters**, and **Download CSV** for
  Sports Connect.

### 7. Privacy and plan (slides 22 and 24, 3 min)

- Back to PowerPoint: **slide 22** (protecting kids' information) and
  **slide 24** (where we are: everything tested by Dec 31, evaluation day
  Jan 23, 2027).

### 8. Questions for the board (slides 25–28, 5+ min)

Go through slides 26 and 27. Write down answers; they become settings or
next year's work. The questions:

1. Should coaches score only the age groups they're assigned to? *(today: yes)*
2. Combine coach and evaluator scores into one ranking? *(today: kept separate)*
3. When should coaches see the draft reports?
4. What should "coach's kid" mean on the report? *(today: a label only)*
5. Should coaches see last year's ratings while they score? *(a switch)*
6. Run this year's draft in the app (just shown), or keep it on paper this year? *(built and tested)*
7. Who will be admins and registrars?
8. How long should we keep past seasons' player data?
9. Who should own the hosting accounts long-term?
10. Anything else you'd want it to do?

---

## If something goes wrong

| Problem | Do this |
|---|---|
| A page is slow or blank | Refresh. Still stuck: switch to the matching slide (see below). |
| Sign-in fails | Check the password in `.env.local`; make sure each window is a different profile (normal, Incognito, Guest). |
| The app won't start | Docker Desktop running? `npx supabase start`, then `npm run start`. |
| Offline step doesn't send | Make sure DevTools Network is back to **No throttling**; wait 15 seconds, or tap the badge's **Send now**. |
| No "Here" badges or check-in list | The demo was loaded on a different day. Re-run `npm run demo:load` (5 minutes). |
| A draft won't start | Its age groups aren't released: run `npm run demo:draft-day`. Already started or finished? Reload with `npm run demo:load`, then `npm run demo:draft-day`. |

**Slide for each demo step:** roadmap 4 · imports 5 · duplicates 6 ·
assignments 7 · check-in 9 · announcer 10 · scoring 11 · progress 12 · draft report 14 ·
flags 15 · coach view 16 · teams 18 · the draft 19 · managers' phones 20 ·
Make teams and rosters 21 · help and QR codes 23.

## After the demo

To practise the draft again: `npm run demo:load`, then `npm run demo:draft-day` (the draft can only be run once per load).
`npm run e2e:draft` runs a mock Majors draft in the browser and puts everything back afterwards.

The demo data is disposable. Load it again any time with `npm run demo:load`,
or go back to the usual test league with `npm run fixtures:load -- --reset`.
