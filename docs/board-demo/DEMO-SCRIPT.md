# Board demo: run sheet

About 30 minutes: 5 minutes of slides, 18 minutes of live demo, then questions.
The deck `RWCLL-Player-Evaluations-Board.pptx` (same folder) is the backup: every
demo step has a matching slide with speaker notes, so you can switch to slides at
any point.

Everything in the demo is fictional: the "Fixture Park" league, 290 made-up
players, 18 test accounts. Nothing touches the hosted site.

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
   still say "0 of 13 players done". (If you practised, run step 2 again.)
6. Open the deck in PowerPoint on slide 1, ready to present.

**What the demo data looks like**

- Spring 2027, 290 players ages 7–16, bibs 201–548.
- Ages **7 and 8** are open for scoring (about 60% scored). Avery (coach) hasn't
  started age 7: you'll score live.
- Ages **9–12** are locked and **released** to coaches; ages **13–16** are locked.
- 46 players checked in, one injured player excused (Luke Rivera, age 7), four
  coach's kids, and one possible duplicate (a walk-up, Elliot Carter, bib 990).
- Avery has starred three age 9 players and written two private notes.

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
  ("needs attention" counts).
- Click **3 Evaluation day**. "Every step has a live status and a button to
  the page that does it. I don't have to remember what's next."

### 3. Getting ready (Window A, 4 min)

- **Imports** → **View Rows** on batch #1. "This is the Sports Connect export,
  368 rows. Clean rows go in with two clicks; 87 had something worth a look,
  like out-of-scope programs. Harper Oak is still waiting because her Player Id
  was used twice." Mention: uploading a newer export later only adds and
  updates.
- **Players** → **Possible duplicates (1)**. "Elliot Carter was added as a walk-up
  but was already registered. The app spots it; a person decides." Don't merge
  (or do: choose **Keep this one** on the left card, type a reason, **Merge**).
- **Assignments**. "Coaches only score the age groups they're assigned to."

### 4. Evaluation day (Windows C, B, A, 8 min)

- **Window C (registrar):** "This is the check-in table." Tap **Check players
  in** → filter **7** → **Not here yet** → tap **Barnes, Eli (301)**.
  "One tap. Tap again to undo." Point out "1 exempt from attending" (the
  injured player).
- **Window B (coach):** Home shows "Evaluation day is today!" and Avery's age
  groups. Tap **Score** on age 7. Refresh: **Eli Barnes now shows Here**.
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
  minutes, it says so."

### 5. Draft reports (Windows A and B, 4 min)

- **Window A:** **Draft Reports** → **Age 9**. "Three columns that never get
  mixed: independent evaluators, coaches, last year's coach. The number in
  parentheses drops the highest and lowest coach score." Click **Martin, Roman**
  to open each skill. Show the **CSV**, **PDF** and **Print** buttons.
- Flags: "unsubmitted draft", "No bib": "it tells us what to double-check
  before release."
- **Window B (coach):** **Draft Reports** → **Age 9** → **My stars (3)**. "Coaches
  see averages only, never another coach's scores, never evaluator names. Stars
  and private notes are theirs alone; even admins can't read them." Open
  **Vale, Indigo** to show the private note.

### 6. Privacy and plan (slides 15 and 17, 3 min)

- Back to PowerPoint: **slide 15** (protecting kids' information) and
  **slide 17** (where we are: everything tested by Dec 31, evaluation day
  Jan 23, 2027).

### 7. Questions for the board (slides 18–21, 5+ min)

Go through slides 19 and 20. Write down answers; they become settings or
next year's work. The questions:

1. Should coaches score only the age groups they're assigned to? *(today: yes)*
2. Combine coach and evaluator scores into one ranking? *(today: kept separate)*
3. When should coaches see the draft reports?
4. What should "coach's kid" mean on the report? *(today: a label only)*
5. Should coaches see last year's ratings while they score? *(a switch)*
6. Teams and end-of-season coach ratings in the app next year?
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

**Slide for each demo step:** roadmap 4 · imports 5 · duplicates 6 ·
assignments 7 · check-in 9 · scoring 10 · progress 11 · draft report 13 ·
coach view 14 · help and QR codes 16.

## After the demo

The demo data is disposable. Load it again any time with `npm run demo:load`,
or go back to the usual test league with `npm run fixtures:load -- --reset`.
