# Test plan: season setup, up to evaluation day

A hands-on walkthrough of everything an admin does before evaluation day, using the fictional league. Run it
locally first; repeat on the hosted test server once it has the same code and migrations.

Expected numbers below were checked on 2026-11-11 against the fixture files. If you see something different,
note the step and what you saw.

## 0. Start clean

1. `npm run fixtures:load -- --reset --bare` (wipes local data, then creates only the two admin accounts and the
   Spring 2026 and Spring 2027 seasons).
2. `npm run dev`, open http://localhost:3000, and sign in as `admin.jordan@example.com` with `FIXTURE_PASSWORD`
   from `.env.local`.
3. Keep Mailpit open in another tab: http://127.0.0.1:54324. Every invitation email lands there.

Files used (all fictional):

| File | Step |
|---|---|
| `rwcll-fictional-test-league/sports-connect-volunteers-spring-2027.csv` | 1 (coaches, in the Sports Connect volunteer report format) |
| `rwcll-fictional-test-league/independent-evaluators-spring-2027.csv` | 1 (evaluators) |
| `rwcll-fictional-test-league/generated/sports-connect-spring-2027-full.csv` | 2 |
| `rwcll-fictional-test-league/generated/spring-2026-coach-ratings.csv` | 3 |
| `rwcll-fictional-test-league/generated/bib-numbers-by-player-id.csv` | 4 |
| `rwcll-fictional-test-league/generated/bib-numbers-with-errors.csv` | 4 |

## 1. Accounts (People)

- [ ] **People > Invite from a list**, Season Spring 2027, choose the volunteers file. Preview shows 10 rows,
  9 selected: Finley Moss is listed twice (Majors and Juniors) and the second row is unticked. Every role says Coach
  (Coach, Assistant Coach and Team Manager all map to coach).
- [ ] **Invite selected.** Message: 9 invited. Mailpit has 9 emails titled "Your RWCLL Player Evaluations account".
- [ ] Same with the evaluators file. Preview shows 6 rows, all "Independent evaluator". Message: 6 invited.
- [ ] Jamie Sutton appears twice in Accounts: `coach.jamie@` as Coach, `eval.jamie@` as Evaluator.
- [ ] On `coach.jamie@`, add the **Evaluator** role. Expected error: an account can't be both a coach and an
  independent evaluator in the same season.
- [ ] **Invite one person:** your own test address, role League admin. Then remove that admin role again.
- [ ] Try removing your own admin role (on admin.jordan). Expected error.
- [ ] Accept one invitation: in Mailpit open the email to `coach.avery@example.com`, click the link, choose a
  password. You land in the app signed in as Avery (no age groups yet). Sign out and back in as admin.jordan.
  Avery's status on People changes to Active.
- [ ] **Disable** `eval.orion@example.com`, then **Enable** it again. Both show a message.

## 2. Registrations (Sports Connect import)

- [ ] **Imports > Sports Connect import.** Choose the full registrations file and season Spring 2027.
  **Save Batch for Review**, then open the batch.
- [ ] **Bulk review > Ignore out-of-scope rows.** Message: 77 ignored (A, Tee Ball, softball, Challenger, and
  similar programs).
- [ ] **Approve and commit clean rows.** Message: 274 committed. The panel then shows 0 and 0.
- [ ] **Open Administrator Row Review.** 17 rows are left:
  - 7 pairs of different children who share a name (14 rows): Luke Rivera, Jasper Hughes, Jonah Powell,
    Ethan Rogers, Lucas Phillips, Julian Reed, Owen Price. Birthdates and Player Ids differ, so approve each
    as a new player and commit. After you commit the first of a pair, the second shows the first as a possible
    match; still choose new.
  - Gray Hayes and Harper Oak share Player Id 77100077. Resolve the duplicate warning on Gray (different
    children), approve and commit Gray. Try to commit Harper: expected error "Player Id 77100077 is already
    registered this season to Gray Hayes...". Leave Harper in review (in real life Sports Connect fixes the Id).
  - Val Hayes has no birthdate. Approve as new and commit.
- [ ] **Players** shows 290 registrations. Filter **No age group**: 1 (Val Hayes).
- [ ] Open Val Hayes, set Age group 11, Reason "No birthdate; parent confirmed age 11", Save. Change history
  shows the change. Filter No age group is now 0; Val shows "Age set by admin".
- [ ] On any player, change the first name without a reason. Expected error asking for a reason.

## 3. Prior-year coach ratings

- [ ] **Imports > Prior-year ratings**, Match to Spring 2027, choose the Spring 2026 ratings file, Preview.
  Summary: 33 ready, 3 to review, 2 held, 0 rejected.
- [ ] Check these three, and choose "Same child" for each:
  Sage Vale and Taylor Carter (name and birthdate agree, Player Id changed), Umaya Arbor (registered as
  "Uma Arbor"; Player Id and birthdate agree).
- [ ] **Import selected ratings.** Message: 36 imported.
- [ ] Held: Micah Oakes (a look-alike, not the registered player) and Kit Lindqvist (not returning). Click
  **Check held rows again**: still 0 match. Tick both and **Dismiss** with the default reason.
- [ ] Upload the same file again. 36 rows are rejected as already imported and the 2 dismissed players are held
  again. Nothing is imported twice.

## 4. Bibs

- [ ] **Players > Upload bibs**, choose the by-Player-Id file, Preview. Will set: 287. Apply. Message: 287 bibs set.
- [ ] Players, filter **No bib**: 3 (Gale Oak, Indigo Vale, Jamie Carter; the fixture leaves them without bibs on purpose).
- [ ] Give them bibs by hand on their edit pages (for example 401, 402, 403). Then try giving a fourth player
  bib 401: expected error naming the player who has it.
- [ ] Upload the with-errors file. Expected:
  - Conflicts: Eli Turner (245 belongs to Wren Carter)
  - Already set: Alex Arbor, Elliot Carter
  - Held: Player Id 99999999 (nobody), Player Id 77100077 (shared Id; one child still in review)
  - Rejected: duplicate bib 201 in the file, "A12", blank, Hugo Long (out-of-scope program), Elliot Carter listed twice
- [ ] Compare each row with the file's "Expected Result" column.
- [ ] Optional: in a fresh upload, give a player a different bib than they have. It shows under Changes with a
  checkbox; leave it unticked and apply: the player keeps the old bib.

## 5. Walk-up player (evaluation-day fix)

- [ ] **Players > Add player on site.** Check last name "Hayes": the list shows Hayes players already registered
  this season with a Find them link (no option to add them twice).
- [ ] Add a new player, for example "Test Walkup", no birthdate, age 9, bib 450, reason "Walk-up at evaluations".
  The player page says "Added on site, no Sports Connect Player Id yet". Players filter **Added on site**: 1.

## 6. Sessions and dates

- [ ] **Sessions:** Create the 10 missing age sessions for Spring 2027 (ages 7 to 16).
- [ ] **Global primary event schedule:** 01/23/2027, 09:00 to 13:00, location "Red Morton Park", Preview eligible
  sessions, apply. Every age group shows "Primary event scheduled".
- [ ] **Global makeup event schedule:** 01/30/2027, same times and place. Every age group gets a makeup event.
- [ ] Change one age group's primary time on its own (for example age 15 and 16 at 13:00).

## 7. Assignments

- [ ] **Assignments:** assign evaluators following the fixture plan:

  | Ages | Coaches | Independent evaluators |
  |---|---|---|
  | 7-8 | Avery, Bailey, Cameron | Kendall |
  | 9-10 | Cameron, Dakota, Elliot | Kendall (9), Lane (10) |
  | 11-12 | Elliot, Finley, Harper | Lane, Nico |
  | 13-14 | Harper, Indigo, Jamie (coach) | Micah, Nico (13), Jamie (eval, 14) |
  | 15-16 | Indigo, Jamie (coach), Avery | Micah, Jamie (eval) |

  (Doing just ages 7 and 8 is enough to test; the rest is practice.)
- [ ] Leave Orion with no assignment.

## 8. Ready for evaluation day

- [ ] **Sessions:** Open age 7. (It refuses without a primary event and at least one evaluator.)
- [ ] **Evaluation-day roster** for age 7: bibs and names, blank Check-in and Notes columns. Print preview fits.
- [ ] Turn the **prior-year switch** on for Spring 2027.
- [ ] In a private window on a phone-sized screen, sign in as Avery (password chosen in step 1). Evaluations
  shows Age 7 open with players listed by bib. Players with a prior-year rating show it on their scoring page.
- [ ] As admin, **Draft Reports > Age 10**: the Prior-Year column is filled for Quinn Hayes and Ethan Hayes
  (draft reports always include prior-year ratings, and admins can open any age group).
- [ ] Sign in as Orion (accept his invitation first): no age groups, can't score anyone.
- [ ] Back as admin, **Return to Setup** for age 7 (nobody has saved an evaluation yet).

## Afterwards

Reload the full test league with `npm run fixtures:load -- --reset --open-sessions` (or `--scored` for draft
reports) when you're done.
