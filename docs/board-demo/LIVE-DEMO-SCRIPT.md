# Board demo on the live site: run sheet

About 35 minutes. The same story as the laptop demo (`DEMO-SCRIPT.md`), but on
the real website, so the board can **take part on their own phones**: they scan a
QR code, sign in with a seat card, score a few players, and then see the draft
report appear once you release it.

All the data is fictional (290 made-up players at "Fixture Park"). The live site
holds nothing real yet, so wiping and reloading it is fine.

The deck `RWCLL-Player-Evaluations-Board.pptx` is the backup if the site or the
Wi-Fi lets you down.

---

## The day before (30 minutes)

### 1. Put the latest code on the live site

Merge the branch to `main` and push, as usual (`docs/FAQ.md`, "Merging to main").
Vercel deploys it. Step 3 applies every migration, so there's nothing else to
apply.

### 2. Pick a demo password

Board members will type it on their phones, so make it easy to type and at least
8 characters, for example `FieldDay2027`. Put it in `.env.hosted.local` as
`FIXTURE_PASSWORD=...` (the file from `docs/FAQ.md`, "Load test data into hosted
Supabase"). Every demo account gets this password. It only protects fictional
data, and you'll change it before going live (see "After the demo").

### 3. Wipe the live database

From the project folder in PowerShell (log in and link first if needed; see
`docs/FAQ.md`):

```
npx supabase db reset --linked
```

This rebuilds the database with every migration. Sign-in accounts may survive
it; that's fine, because the loader reuses them and resets their passwords.

### 4. Print the seat cards

Print the card sheet at the end of this file and cut it up: one card per board
member, up to six. Write the demo password on each card.

---

## The morning of the demo (15 minutes)

### 5. Load the demo league (about 10 minutes)

```
npm run fixtures:load -- --hosted --confirm-project=<your project ref> --demo
```

It dates evaluation day **today**, so check-in and "Here" work live. Presenting
on another day: add `--demo-date=2026-12-10`. It ends with
`PASS: demo league loaded` and lists the board seats.

It creates:

- 290 players; ages **7 and 8 open for scoring** (about 60% scored), ages 9–12
  released to coaches, 13–16 locked.
- 46 players checked in, an injured player excused, coach's kids, a possible
  duplicate (Elliot Carter, a walk-up with bib 990).
- **Six board seats**, `board1@example.com` to `board6@example.com`: coaches
  assigned to **age 8**. They show as "Board Member 1" to "Board Member 6".
- The usual test accounts: `admin.jordan@example.com` (admin),
  `coach.avery@example.com` (coach, hasn't started age 7),
  `registrar.riley@example.com` (registrar).

Need more than six seats? Add `--board-seats=10` (up to 20).

### 6. Set up the laptop

Open the live site address in three Chrome windows (each keeps its own sign-in):

| Window | How to open it | Sign in as | Set up |
|---|---|---|---|
| **A: Admin** | Normal window | `admin.jordan@example.com` | Full screen, on the projector |
| **B: Coach** | Incognito (Ctrl+Shift+N) | `coach.avery@example.com` | F12 → device toolbar (Ctrl+Shift+M) → iPhone 12 Pro |
| **C: Registrar** | Guest profile | `registrar.riley@example.com` | Same phone view |

Optional: sign in to `coach.avery@example.com` on **your own phone** too, to show
the real thing in your hand.

### 7. Check it once

- Window A: **Roadmap** shows Spring 2027; open the **QR Codes** page (add
  `/protected/qr` to the address). There must be **no** "points at this
  computer" warning; the codes use the live address.
- Scan the **Age 8 scoring** code with your phone. It should ask you to sign in,
  then open the age 8 list. Use `board6@example.com`, then **sign out** (don't
  score anything).
- Board members need internet on their phones: venue Wi-Fi or mobile data.

---

## The talk (with timings)

### 1. Opening (slides 1–3, 4 min)

- Slide 1: what the app is. Slide 2: Fairer / Faster / Safer. Slide 3: the five
  stages. "Everything you'll see is the real website, with a made-up league."

### 2. The admin's roadmap (Window A, 2 min)

- **Roadmap**: the five stages, the badges. Click **3 Evaluation day**: every
  step has a status and a button to the page that does it.

### 3. Getting ready (Window A, 4 min)

- **Imports** → batch #1 → **View Rows**: the Sports Connect export, 368 rows; clean
  rows go in with two clicks, odd ones wait for a person. Uploading a newer export
  later only adds and updates.
- **Players** → **Possible duplicates (1)**: Elliot Carter was added as a walk-up
  but was already registered. Do it live: choose **Keep this one** on the card
  with scores (bib 205), type "Same child, walk-up on evaluation day", **Merge**.
  "The record is fixed and the change is logged."
- **Assignments**: coaches only score their own age groups. Point at the six
  Board Members on **Age 8**: "That's you, in a minute."

### 4. Evaluation day (Windows C and B, 6 min)

- **Window C (registrar):** **Check players in** → age **7** → **Not here yet** →
  tap **Barnes, Eli (301)**. One tap; tap again to undo. "1 exempt from
  attending" is the injured player.
- **Window B (coach Avery):** Home says "Evaluation day is today!". **Score** on
  age 7: Eli Barnes now shows **Here**. Tap **#201 Arbor, Alex**, tap a score for
  each skill, **Save & Next**.
- **No signal (optional, 1 min):** F12 → **Network** → **Offline**; score #202 →
  **Save & Next**; point at "On phone (not sent)" and the **1 not sent** badge;
  switch back to **No throttling**; the badge clears within 15 seconds.

### 5. Your turn: the board scores (8 min)

1. Hand out the seat cards, one per person. Each card is a different account;
   two people on one card would overwrite each other's scores.
2. Window A: show the **QR Codes** page full screen and point at **Age 8
   scoring**. "Open your phone's camera and scan it."
3. They sign in with the email and password on their card and land on the age 8
   list. "Pick any player, tap a score for each skill, Save & Next. Do two or
   three."
4. While they score, Window A: **Roadmap** → **3 Evaluation day** → **Watch
   scoring progress**. The **Board Member** bars under Age 8 move as they save
   (the page refreshes every 30 seconds). "If one of you stopped for 15
   minutes, it would say so."

### 6. Lock and release: the report appears on their phones (5 min)

1. Window A: **Sessions** → **Age 8** row → **Lock Scoring** → **Lock Scoring**
   in the box. "Scores are frozen."
2. **Release to Coaches** → **Release to Coaches**. "Now every coach can see it."
3. Board members, on their phones: menu (☰) → **Draft Reports** → **Age 8**. Their
   scores now count in the **Coach** column, next to the independent evaluator
   and last year's ratings. "You can see the averages, but not what the person
   next to you gave each player, and evaluators stay anonymous." Have them tap a
   **star** and then **My stars**: their own shortlist that nobody else sees.
4. Window A: **Draft Reports** → **Age 8**: the admin's view, with **CSV**, **PDF**
   and **Print**.

### 7. Privacy and plan (slides 15 and 17, 2 min)

### 8. Questions for the board (slides 18–21, 5+ min)

The ten questions are on slides 19 and 20 (and in `DEMO-SCRIPT.md`). Write the
answers down; they become settings or next year's work.

---

## If something goes wrong

| Problem | Do this |
|---|---|
| The site or Wi-Fi is down | Switch to the slides (each demo step has one), or to the laptop demo (`DEMO-SCRIPT.md`). |
| A board member can't sign in | Check the email is typed exactly (`board3@example.com`, all lower case) and the password. Still stuck: give them a spare seat card. |
| The QR code opens the wrong page | They were already signed in as someone else. Menu (☰) → **Sign out**, then scan again. |
| Progress doesn't move | Wait 30 seconds, or reload the page. |
| Lock or release shows an error | Reload **Sessions** and try again. Saves still on a phone after the lock are refused; that phone shows a red badge with Discard. |
| No "Here" badges or check-in list | The data was loaded on a different day. Re-run step 5 (10 minutes) or skip that part. |

**Slide for each step:** roadmap 4 · imports 5 · duplicates 6 · assignments 7 ·
check-in 9 · scoring 10 · progress 11 · draft report 13 · coach view 14 ·
help and QR codes 16.

## After the demo

- **To demo again:** steps 3 and 5.
- **Before real use:** wipe the live database (step 3). Then, in Supabase,
  **Authentication → Users**, delete every `@example.com` account: the demo
  password was shared with the room. Delete `.env.hosted.local` when you're done
  with it.

---

## Seat cards (print, cut, write the password)

| | |
|---|---|
| **RWCLL Evaluations: Board seat 1**<br>Scan the **Age 8 scoring** code on the screen.<br>Email: `board1@example.com`<br>Password: ____________________ | **RWCLL Evaluations: Board seat 2**<br>Scan the **Age 8 scoring** code on the screen.<br>Email: `board2@example.com`<br>Password: ____________________ |
| **RWCLL Evaluations: Board seat 3**<br>Scan the **Age 8 scoring** code on the screen.<br>Email: `board3@example.com`<br>Password: ____________________ | **RWCLL Evaluations: Board seat 4**<br>Scan the **Age 8 scoring** code on the screen.<br>Email: `board4@example.com`<br>Password: ____________________ |
| **RWCLL Evaluations: Board seat 5**<br>Scan the **Age 8 scoring** code on the screen.<br>Email: `board5@example.com`<br>Password: ____________________ | **RWCLL Evaluations: Board seat 6**<br>Scan the **Age 8 scoring** code on the screen.<br>Email: `board6@example.com`<br>Password: ____________________ |
