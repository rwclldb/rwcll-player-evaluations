# Teams and the draft: spec

Status: **proposed, waiting for approval** (2026-11-19). Nothing here is built yet.

The league runs its spring draft inside the app, straight from the evaluation data:
the Juniors, Majors and AAA drafts, players who aren't drafted moving down a
division, generated teams for AA (and Seniors when there are two teams), and
rosters exported as a CSV.

## Dates

| Date | What |
|---|---|
| Dec 31, 2026 | Evaluation work finished and tested (unchanged priority) |
| Jan 23, 2027 | Evaluation day |
| Feb 1 | Juniors draft |
| Feb 2 | Majors draft |
| Feb 4 | AAA draft |
| Feb 6 | AA (and below) rosters released |

Teams, managers and coaches have to be in the app before Feb 1, and the draft room
needs a full rehearsal with fixture data in January.

---

## 1. Teams and staff

**Teams page** (admin, `/protected/teams`): for each division this season, a list
of teams. Each team has:

- a name (default "Team 1", "Team 2" and so on; rename any time);
- one **Manager** and one **Coach**: app accounts with the coach role this season.
  These two get the coach's-kid privilege, and they are the people in the draft
  room;
- any number of **Assistant coaches**: listed on the team only. No coach's-kid
  privilege, and no access to the draft room.

Rules:

- One person can be on teams in several divisions, but on only one team per
  division.
- The existing `teams` and `team_coach_assignments` tables are used. The staff
  roles become `manager`, `coach` and `assistant_coach` (the current values are
  `head_coach` and `assistant_coach`).
- A CSV upload of teams and staff (division, team name, manager email, coach email,
  assistant emails) for setting up many teams at once.

**Coach's kids, linked to a parent:** the app has a "Coach's kid" label today.
Players can now also be linked to a parent account:

- On a player's edit page, choose the parent: a manager or coach this season. Twins
  are two links to the same parent.
- The privilege applies only in a division where that parent is Manager or Coach of
  a team. A parent who manages in Majors and whose younger child is in AAA gets no
  privilege in AAA, unless they also manage or coach an AAA team.
- The existing "Coach's kid" label stays as it is. The link is what the draft uses.

**Siblings:**

- **Sibling groups** are kept per season and set by an admin on the player edit
  page or the Teams page.
- **Suggestions:** the app suggests groups from players registered under the same
  Sports Connect account.
  - Today the import doesn't keep the account at all.
  - The proposal: at import, store only a fingerprint (hash) of the account email,
    never the email itself.
  - Re-importing the full export fills it in for players already registered.
- **Suggestions are never automatic:** an admin confirms each group.

---

## 2. Draft setup

One draft per division per season: Juniors, Majors, AAA, and any other division
the admin turns on. Each draft has a **setup page** (admin) with the pool, the
teams, the order and the rules. The settings are copied from the same division's
draft last season, so each year only the changes need entering.

### The pool: who gets drafted

Built from the division's age range and the division each player requested in
Sports Connect:

- **Must-draft ages** (default: the division's top age). Every player of that age
  is in the pool, whatever they requested. Example: every 12-year-old is in the
  Majors pool.
- **Other ages in the range:** only players who requested this division. Example:
  an 11-year-old who requested AAA is not in the Majors pool.
- **Switch, "Pool by age only":** ignores the requested division, so everyone in
  the age range is in.
- **Players not yet placed only:** a player already on a team (from an earlier
  draft, or moved by an admin) is never in a later pool.
- **Coming down from the division above:** when a draft is finished, its undrafted
  players drop into the next pool:
  - 10–11 year-olds left over in Majors join the AAA pool;
  - 8–9 year-olds left over in AAA join the AA group.
  - The rule is "undrafted players whose age fits the next division's range". The
    board shows them as "From Majors".
- **Admin overrides, any time, with a note:**
  - take a player out of the pool;
  - put a player in;
  - move a player to another division's pool.

  Example: a 12-year-old allowed to play in Juniors. Every override is audited
  and shown on the setup page.

The setup page shows the pool by age, with counts, must-draft counts, coach's kids
and sibling groups. It warns about:

- players with no ratings;
- age groups whose draft report hasn't been released;
- more players than roster spots.

### Teams and roster sizes

- The draft uses the division's teams from the Teams page.
- **Roster size** per team, default 12. One number for the draft, and any team can
  be changed.
- **Too many players:** the setup page says how many won't fit. The admin adds a
  team or raises roster sizes before starting.
- **Too few players:** the draft ends when the pool is empty.

### Pick order

- **Snake** (default) or **straight** (same order every round).
- **First-round order:**
  - **Draw** button: a random draw, saved and audited, shown to everyone once
    made; or
  - set by hand, when the draw happens outside the app.
  - The order is locked when the draft starts.

### Rules (switches and settings)

**Age order**

- **Open** (default): any eligible age can be picked at any time, but every
  must-draft player has to be taken by the end.
  - The board always marks the **last N open picks** as "Must take a 12", where N
    is the number of 12-year-olds still available.
  - Each time a 12 is taken, N drops by one and the marks shrink.
  - In your example (round 11, 10 twelve-year-olds left), the last 10 picks are
    marked. If the next pick is a 12, the last 9 are marked.
  - When a marked pick comes up, the app only offers must-draft players. An admin
    can override with a note.
- **Oldest first:** all 12s, then all 11s, then all 10s.
  - The board shows which age is being drafted.
  - The next age opens when the older one is used up.
- **Later, if needed:** "each team takes at least N players of age X". It's left out
  for now; the setup is built so rules like this can be added.

**Coach's kids** (choose one)

- **a. Fixed rounds:** the team's coach's kids fill its picks in the chosen rounds,
  for example rounds 1 and 2.
  - With two kids (the manager's and the coach's), the admin sets which kid takes
    which round. Default: the manager's kid in the first listed round.
- **b. Round per kid:** the admin sets each kid's round on the setup page.
  - The app suggests a round from the kid's ranking: with 8 teams, ranked 15th
    means round 2.
  - The app makes that pick for the team when the round comes.
- **c. By a round:** the team picks its kids itself, any time up to round N.
  - If a kid is still unpicked when the team's round N pick comes, the app makes
    that pick with the kid.
- **d. Placed before the draft:** the kids go on the team before round 1.
  - See open question 1 for whether a placed kid uses up one of the team's picks.

In **Oldest first**, rules a–c apply within the kid's own age. Example: rule a with
round 1 puts a 10-year-old coach's kid at the team's first pick once the 10s open.

Automatic picks show on the board as "Coach's kid".

**Siblings**

- **Switch, "Siblings play together"** (on by default).
- When one sibling is drafted, the other is placed on the same team with that
  team's next pick, marked "Sibling".
- Siblings in different pools (different divisions) are not affected.

**Pick timer**

- Off by default. When on, a countdown (for example 2 minutes) shows on every
  screen and turns red when time runs out.
- Nothing is picked automatically: the admin still makes the pick.

---

## 3. The draft room

**Admin view (laptop):**

- **The board:** rounds down, teams across, the team on the clock highlighted.
  Must-draft marks and automatic picks are shown on it.
- **The available players:** a list with bib, name, LL age, the evaluator, coach
  and prior-year overalls, flags, and coach's kid and sibling markers. It filters
  by age and must-draft, and sorts by any column.
- **Making a pick:** select a player → **Pick for <team>** → confirm. The pick
  appears on every screen within a few seconds.
- **Starting the draft:** **Start draft** locks the setup.
- **Automatic picks:** coach's kids and siblings are placed by the app when their
  turn comes. The admin sees them happen and doesn't have to do anything.
- **No undo:** a wrong pick is fixed with **Move player** (below), with a note.
- **Pause and resume.**
- **Finish the draft:** drops the undrafted players into the next pool.

**Manager and coach view** (phone or laptop; only that division's managers and
coaches, plus admins and registrars):

- **Live:** the same board, updated live.
- **The available players:** sortable by:
  - evaluator average;
  - coach average (with the high and low dropped);
  - prior-year rating;
  - **their own scores**.
- **Next best available:** under the current sort, the top available player is
  highlighted.
- **Same privacy as the draft report:**
  - averages only;
  - no other coach's own scores;
  - evaluators stay anonymous.
- **Stars and private notes:** the same as on the draft report (they carry over).
  Only the coach can see them, and admins can't.
- **"My team" panel:** their roster so far.
- **Read-only:** coaches never pick in the app.

**Projector view** (admin, full screen): the board only, in large type, with no
ratings.

Live updates: the screens check for changes every few seconds. This is the same
approach as check-in and calling, and it works on venue Wi-Fi.

---

## 4. Generated teams (AA, Seniors, any division)

A **Make teams** page for a division (admin):

- **Players:**
  - the group (AA: everyone in its age range who requested AA, plus the 8–9s left
    over from AAA);
  - its teams and their roster sizes.
- **What to balance on:** tick any of the following.
  - evaluator, coach, prior-year;
  - with none ticked, the teams are completely random.
- **Players with no ratings** get the group's middle rating, so they don't all end
  up on one team.
- **Age:** a second balancer.
- **Coach's kids** always go to their parent's team.
- **Siblings** always go together.
- **Building the teams:**
  - coach's kids and sibling groups are placed first;
  - then the rest are dealt out snake-style by rating;
  - then players are swapped between teams until rating totals and age mix are as
    even as possible.
- **Preview:** each team's average rating, age counts and players. **Make again**
  gives a new mix.
- **Adjust by hand:** move a player between teams, with the totals updating.
- **Save:** places everyone, audited with the settings used.

Seniors with one team: **Put everyone on Team 1**.

---

## 5. After the draft: rosters

**Rosters page** (admin):

- every division, every team: manager, coach, assistants and players;
- unplaced players listed separately.

**Moving a player:**

- **Move player** (any time, during or after the draft):
  - to another team, back to the pool, or to another division;
  - needs a note;
  - audited, and shown in the team's history.
- This also covers fixing a wrong pick, and trades the board approves.

**Placing a player on a team:**

- sets the registration's division and team (`player_seasons.team_id`);
- the requested division from Sports Connect is kept in its own column, so it isn't
  lost.

**CSV export:** one row per player. It is a plain layout with many fields, so the
headings can be renamed for Sports Connect later:

- season, division, team, manager name and email, coach name and email;
- player first and last name, Sports Connect Player Id, Registration Number, bib;
- LL age;
- coach's kid, sibling group;
- how the player was placed (draft round and pick, coach's kid, sibling, from
  Majors, generated, moved by admin).

Birthdates are not included; the Player Id identifies the child.

**Releasing rosters** (per division, like releasing draft reports):

- managers and coaches see their own team;
- coaches can then re-rate their own players at the end of the season (already on
  the roadmap as "coming later").

---

## 6. Who sees what

| | Admin | Registrar | Division's manager/coach | Assistant coach | Other coaches, evaluators |
|---|---|---|---|---|---|
| Teams and staff setup | edit | see | own team | own team | no |
| Draft setup | edit | see | no | no | no |
| Draft room | picks | watch | watch, sort, star, note | no | no |
| Ratings in the room | everything | none (names, bibs, ages) | averages + own scores | no | no |
| Rosters | edit, move, CSV | see, CSV | own team after release | own team after release | no |

Registrars watch without ratings, because registrars never see scores today. See
open question 4.

---

## 7. Build order

Each step is one branch with its own migration and runtime test, merged and tested
before the next:

1. **Teams and staff:**
   - the Teams page and teams CSV;
   - manager, coach and assistant roles;
   - coach's-kid parent links;
   - sibling groups, with suggestions from the import's account fingerprint.
2. **Draft setup:**
   - drafts, pool rules and overrides;
   - roster sizes, the draw and the order;
   - the rule switches, copied forward.
3. **The draft room:**
   - the admin board and picking;
   - automatic coach's-kid and sibling picks;
   - must-draft marks;
   - the watcher view with sorting and the next best player;
   - the projector view, the timer, and finishing with fall-through.
4. **Rosters:**
   - Move player with notes;
   - the Rosters page and CSV export;
   - releasing rosters to managers and coaches.
5. **Make teams:** the generator.
6. **Rehearsal:**
   - a fixture option (`--teams`) that loads teams, staff, coach's kids and
     siblings;
   - a scripted mock Majors draft in the browser test;
   - help pages for admins and coaches;
   - roadmap steps under "After evaluations".

Evaluation-day work keeps priority until Dec 31. Steps 1–4 are what the Feb 1–4
drafts need. Step 5 is needed by Feb 6.

---

## Open questions

1. **Coach's kids placed before the draft (rule d):** does each placed kid use up
   one of the team's picks (which round: first, last?), or are they extra, so the
   team still makes 12 picks?
2. **Siblings:** when one sibling is drafted, should the other use the team's
   *next* pick (proposed), or the pick in the following round that best matches
   their ranking?
3. **Must-draft picks:** should the app block a non-must-draft player on a marked
   pick (with an admin override and note, proposed), or only warn?
4. **Registrars in the draft room:** watch the board only, with no ratings
   (proposed, matching today's rule), or see ratings like coaches?
5. **Sibling suggestions:** is it OK to keep a fingerprint of the Sports Connect
   account email (not the email itself) to suggest siblings? The alternative is to
   enter every sibling group by hand.
6. **Draft reports:** should the draft room refuse to start until the division's
   age groups are released to coaches, or only warn?
