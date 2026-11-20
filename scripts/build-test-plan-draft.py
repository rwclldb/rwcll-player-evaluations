"""Builds docs/TEST-PLAN-DRAFT.xlsx (teams, coach's kids and siblings, draft setup, the draft room, team rosters,
Make teams). Run: python scripts/build-test-plan-draft.py docs/TEST-PLAN-DRAFT.xlsx (needs openpyxl)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_plan_xlsx import build  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/TEST-PLAN-DRAFT.xlsx"

# (phase, minutes, summary) then steps: (id, who, where, what to do, what you should see, must_pass)
PHASES = [
    ("Phase 0: Before we start", 15, "Load the draft-sized league and jump it to draft day.", [
        ("0.1", "Admin", "Terminal (local) or PowerShell (hosted)",
         "LOCAL: npm run demo:load  then  npm run demo:draft-day  then  npm run dev, and open http://localhost:3000.\n"
         "HOSTED: npx supabase db reset --linked, then npm run fixtures:load -- --hosted --confirm-project=<ref> --demo, then the same with --draft-day "
         "instead of --demo, and open the Vercel address.",
         "demo:load lists \"REAL Teams upload ... 27 teams; skipped 2 rows\", \"13 coach's kids linked to a parent, 10 sibling groups confirmed\" and "
         "\"REAL drafts: Juniors (2 x 13), Majors (8 x 12) and AAA (8 x 12) set up\". draft-day ends with \"PASS: draft day\".", True),
        ("0.2", "Admin", "Normal browser window",
         "Sign in as admin.jordan@example.com.",
         "The roadmap is on stage 5, Teams and draft. Steps: teams done, coach's kids done, siblings \"Needs attention\" (2 suggestions).", True),
        ("0.3", "Coach", "Private window (phone size: F12, Ctrl+Shift+M)",
         "Sign in as coach.finley@example.com (Finley Moss: Majors Cubs manager and AAA Braves coach).",
         "Home shows a Drafts card listing Majors and AAA (\"not started yet\") with a Draft room button.", True),
    ]),
    ("Phase 1: Teams", 10, "The teams and staff loaded from the Sports Connect volunteer report.", [
        ("1.1", "Admin", "Draft menu, Teams",
         "Open Teams. Look at each division.",
         "Seniors 1, Juniors 2, Majors 8, AAA 8, AA 8 teams. Each has a Manager and a Coach. Giants: Elliot Brandt manages. "
         "Pirates also has an assistant, Lee Mercer.", True),
        ("1.2", "Admin", "Teams, a Majors team",
         "Open the Manager list on Cubs.",
         "Elliot Brandt is greyed out with \"on Giants\": a person can be on only one team per division.", False),
        ("1.3", "Admin", "Teams, Upload teams from a spreadsheet",
         "Upload rwcll-fictional-test-league/generated/sports-connect-volunteers-teams-spring-2027.csv.",
         "\"Skipped 2 rows: No team yet; Role \"Team Parent\" isn't manager, coach or assistant.\" Every team: Up to date. Apply 0 teams.", True),
        ("1.4", "Admin", "Teams, Seniors",
         "Add a Seniors team named Test Team, then Delete team… on it.",
         "The team appears, then goes away.", False),
    ]),
    ("Phase 2: Coach's kids and siblings", 10, "Suggestions from the registration file, and the links the draft uses.", [
        ("2.1", "Admin", "Draft menu, Coach's kids and siblings",
         "Look at Suggestions.",
         "Two: Ivo Sinclair (10) and Lily Sinclair (8) \"Siblings?\" (same family account), and Sami Bennett (12) as Jesse Bennett's kid "
         "(registered with the Tigers coach's sign-in email).", True),
        ("2.2", "Admin", "Coach's kids table",
         "Find the Ramirez twins and Nora Ortiz.",
         "Mateo and Lucia Ramirez: parent Elliot Brandt (Manager, Majors Giants). Nora Ortiz: Morgan Ortiz (Manager, Majors Rays; Coach, AAA Astros). "
         "13 coach's kids, none without a parent.", True),
        ("2.3", "Admin", "Suggestions",
         "Group as siblings on the Sinclairs. Not their kid on Sami Bennett.",
         "Both suggestions go away. Sibling groups: 11. The roadmap's siblings step turns Done.", True),
    ]),
    ("Phase 3: Draft setup", 15, "The pools, the rules and what must be fixed before a draft starts.", [
        ("3.1", "Admin", "Draft menu, Drafts",
         "Look at the cards (oldest first).",
         "Majors: 112 in the pool, 71 must be drafted, 8 teams, Order set. Juniors 27 / 27. AAA and Juniors also Setting up; AA and Seniors have Make teams.", True),
        ("3.2", "Admin", "Majors, Open setup",
         "Read the box at the top and the Coach's kids table.",
         "Ready to start, with a warning: 112 players and 96 roster spots, 16 won't be drafted. Kids: Owen Moss round 1 and Ivy Lawson round 2 (Cubs), "
         "Mateo and Lucia Ramirez rounds 1 and 2 (Giants), Gabe and Nora Ortiz rounds 1 and 2 (Rays). Penny Quill (9): Not in this pool.", True),
        ("3.3", "Admin", "Majors setup, The pool",
         "Filter Also in another pool. Then find Kit Holloway.",
         "11-year-olds who asked for Majors say \"Also in AAA pool\". Kit Holloway (12) asked for Juniors but is Must-draft age in Majors.", False),
        ("3.4", "Admin", "Majors setup, The pool",
         "On Nora Ortiz: Change…, Move to the AAA pool, note \"Plays AAA for Astros\", Save.",
         "Nora leaves the Majors pool and is listed under Changes by hand. In the kids table she shows Not in this pool.", True),
        ("3.5", "Admin", "Drafts, Juniors setup",
         "Read the box at the top.",
         "Blocked: 27 players must be drafted but there are only 26 roster spots. Must-draft ages 13 and 14 are both ticked.", True),
        ("3.6", "Admin", "Juniors setup, Teams and first-round order",
         "Set Angels' roster size to 14 and Save.",
         "The box now says Ready to start (Start the draft… appears).", True),
    ]),
    ("Phase 4: The Juniors draft", 10, "A short draft: start, automatic coach's-kid picks, finish.", [
        ("4.1", "Admin", "Juniors setup",
         "Start the draft…, then Yes, start the Juniors draft.",
         "The draft room opens. Angels' first pick is Wes Ferris (Coach's kid) whenever Angels come up in round 1; Iris Ferris in round 2.", True),
        ("4.2", "Admin", "Juniors draft room",
         "Make 4 picks: click a player, then Pick for <team> in the bar at the bottom.",
         "Each pick appears on the board at once; the team on the clock moves on (snake order).", True),
        ("4.3", "Admin", "Juniors draft room",
         "Finish draft, OK.",
         "The draft says Finished. The undrafted players are now listed under Unplaced on Team rosters.", False),
    ]),
    ("Phase 5: The Majors draft", 30, "The main draft, with a coach watching on a phone and the projector view.", [
        ("5.1", "Admin", "Majors setup",
         "Start the draft… and confirm. In another tab open the Projector button.",
         "Round 1: Owen Moss goes to Cubs, Mateo Ramirez to Giants and Gabe Ortiz to Rays automatically when their turn comes (Coach's kid).", True),
        ("5.2", "Coach", "Finley's window (Cubs manager)",
         "Home, Watch the draft.",
         "The board, with Cubs marked (you). Players tab: sort by Evaluator average, Coach average, Coach (high/low dropped), Prior year, My scores. "
         "The top player is marked Next best.", True),
        ("5.3", "Admin", "Majors draft room",
         "Pick Tess Whitaker (12) for the team on the clock.",
         "A yellow box: Leo Whitaker (age 10) is Tess Whitaker's sibling. Take him with the team's next pick, or send him down?", True),
        ("5.4", "Admin", "Majors draft room",
         "Take with next pick.",
         "The board shows \"Sibling: Leo Whitaker\" in that team's next slot; when it comes up he is placed automatically.", True),
        ("5.5", "Coach", "Finley's window",
         "Without reloading, watch the board while the admin picks.",
         "New picks appear within a few seconds. The pick clock counts down if a timer is set (Majors: none by default).", True),
        ("5.6", "Admin", "Majors draft room",
         "When Eli or Ada Nakamura (11-year-old twins) is picked, choose Send down for the other twin.",
         "The other twin leaves the Majors pool (they're left over for AAA).", False),
        ("5.7", "Admin", "Majors draft room",
         "Click Ivy Lawson when a team other than Cubs is on the clock.",
         "The bar says Coach's kid of Cubs: only that team can take them. The Pick button is disabled.", True),
        ("5.8", "Coach", "Finley's window, Players",
         "Tap the star on a player and the note icon; type a note and Save note. Then My team.",
         "The star stays; the note saves. My team lists Owen Moss and Ivy Lawson (round 2) and anyone else Cubs has.", True),
        ("5.9", "Admin", "Majors draft room",
         "Pause. Then Resume.",
         "Finley's window shows PAUSED within a few seconds, then carries on.", False),
        ("5.10", "Admin", "Majors draft room",
         "Keep picking 10- and 11-year-olds (untick nothing; just pick them) until the bar says Only must-draft players can be picked now "
         "(about 25 picks in). Type a note (\"Board approved\") and pick anyway.",
         "The pick is made and marked override on the board. Without a note the Pick button stays disabled.", True),
        ("5.11", "Admin", "Draft menu, Team rosters (new tab)",
         "Find the last player picked; Move, Back to the pool, note \"Wrong pick\", Save. Go back to the draft room.",
         "That pick is on the clock again (the slot reopened). Moves lists the move with \"pick reopened\".", True),
        ("5.12", "Admin", "Majors draft room",
         "Finish draft, OK (you don't need to make all 96 picks).",
         "The draft is Finished. Undrafted 10- and 11-year-olds join the AAA pool as Left over from Majors.", True),
    ]),
    ("Phase 6: The AAA draft", 10, "Left-over players, an AAA coach's kid, and a quick finish.", [
        ("6.1", "Admin", "Drafts, AAA setup",
         "Open the pool and filter by Everyone.",
         "Players from Majors show Left over from Majors. Nora Ortiz is in the AAA pool. Kids: Remy Reyes (Astros) and Nora Ortiz (Astros).", True),
        ("6.2", "Admin", "AAA setup",
         "Start the draft. Make a few picks. Finish draft.",
         "Astros' coach's kids are picked automatically in their rounds. Undrafted 8- and 9-year-olds join the AA pool.", True),
    ]),
    ("Phase 7: Make teams (AA and Seniors)", 10, "Balanced teams without a draft.", [
        ("7.1", "Admin", "Drafts, AA card, Make teams",
         "Look at the summary and the teams.",
         "Players to place on 8 teams, sizes no more than 1 apart (how many depends on what AAA left over). Team averages within a few hundredths. Blue Jays has Fern and Moss Linden (Coach's kid). "
         "Siblings are together.", True),
        ("7.2", "Admin", "Make AA teams",
         "Make again. Then untick Evaluator and Coach average.",
         "Make again gives a different mix that is still even. With nothing ticked: \"teams are completely random\"; sizes stay even.", False),
        ("7.3", "Admin", "Make AA teams",
         "Tick them again. Move one player with their team box. Then Place … players on these teams, OK.",
         "The summary counts 1 moved by hand. After Place you land on Team rosters: AA teams full, each player \"Team maker\".", True),
        ("7.4", "Admin", "Drafts, Seniors, Make teams",
         "Place.",
         "All 15 Seniors go on Athletics.", False),
    ]),
    ("Phase 8: Team rosters", 10, "Moves, release, CSV and the coaches' view.", [
        ("8.1", "Admin", "Team rosters",
         "Find any player; Move to another team with a note.",
         "The player moves; Moves lists it with the note; the player shows \"Moved from <team>\".", True),
        ("8.2", "Admin", "Team rosters, Majors",
         "Release rosters, OK.",
         "Majors shows Released to managers and coaches.", True),
        ("8.3", "Coach", "Finley's window",
         "Home, See the roster.",
         "Your team: Cubs, with the Cubs players, bibs and ages. Print works. (Braves isn't shown until AAA is released.)", True),
        ("8.4", "Admin", "Team rosters",
         "Download CSV and open it in Excel.",
         "One row per placed player: Division, Team, Manager (with email), Coach, Player Id, Bib, Coach's Kid, Sibling Group, Placed By "
         "(\"Draft round 3, pick 21\", \"Team maker\", \"Moved by admin: ...\").", True),
    ]),
    ("Phase 9: Things that must NOT work", 5, "People outside a division or role try to get in.", [
        ("9.1", "Coach", "Private window",
         "Sign in as coach.avery@example.com (AA Blue Jays manager). Open /protected/drafts/<Majors division id>/room (copy the address from the admin's room).",
         "\"This draft isn't open to you.\"", True),
        ("9.2", "Coach", "Private window",
         "Sign in as lee.mercer@example.com (Pirates assistant coach). Open the Majors room address.",
         "\"This draft isn't open to you.\" Assistants don't watch the draft.", True),
        ("9.3", "Coach", "Coach's window",
         "Type /protected/teams, /protected/drafts and /protected/team-rosters.",
         "Each sends the coach home.", True),
        ("9.4", "Registrar", "Private window",
         "Sign in as registrar.riley@example.com. Open Drafts and Team rosters.",
         "Both open (registrars run the draft like admins). Team rosters shows staff names without emails.", False),
    ]),
    ("Phase 10: Wrap-up", 5, "Write down what you thought.", [
        ("10.1", "Admin", "Notes and problems sheet",
         "Fill in the Notes and problems sheet.",
         "A completed sheet.", False),
        ("10.2", "Admin", "Terminal (local)",
         "To start again: npm run demo:load (then npm run demo:draft-day for draft day).",
         "PASS: demo league loaded.", False),
    ]),
]

DB_CHECKS = [
    ("1", "After Phase 0", "Teams per division",
     "select d.name, count(t.id) from public.season_divisions sd join public.divisions d on d.id = sd.division_id\n"
     "join public.seasons s on s.id = sd.season_id and s.name = 'Spring 2027'\nleft join public.teams t on t.season_division_id = sd.id group by 1 order by 1;",
     "AA 8, AAA 8, Juniors 2, Majors 8, Seniors 1"),
    ("2", "After Phase 2", "Coach's kids and siblings",
     "select (select count(*) from public.coach_kid_links) as kid_links,\n       (select count(*) from public.sibling_groups) as sibling_groups,\n"
     "       (select count(*) from public.family_suggestion_dismissals) as dismissed;",
     "kid_links 13, sibling_groups 11, dismissed 1"),
    ("3", "Any time", "Drafts and picks",
     "select d.name, dr.status, count(p.id) as picks,\n       count(p.id) filter (where p.kind <> 'pick') as automatic,\n"
     "       count(p.id) filter (where p.override_note is not null) as overrides\nfrom public.drafts dr join public.season_divisions sd on sd.id = dr.season_division_id\n"
     "join public.divisions d on d.id = sd.division_id left join public.draft_picks p on p.draft_id = dr.id group by 1, 2 order by 1;",
     "One row per draft. After Phase 5: Majors done, automatic picks include the coach's kids and Leo Whitaker, at least 1 override."),
    ("4", "After Phase 8", "Roster moves",
     "select kind, count(*), count(*) filter (where pick_removed) as picks_reopened from public.roster_moves group by 1;",
     "team_maker: the AA and Seniors players placed; move: your moves, 1 with a pick reopened."),
    ("A", "Any time", "Recent draft actions (audit log)",
     "select created_at, action, left(coalesce(reason, ''), 60) as reason from public.audit_log\n"
     "where action like 'draft%' or action like 'roster%' or action like 'team%' or action like 'coach_kid%' or action like 'sibling%'\n"
     "order by created_at desc limit 40;",
     "Every pick, decision, override note, move, release and team change appears."),
]

SUBTITLE = "Test plan: teams and the draft"
INTRO = ("A hands-on walkthrough of teams, coach's kids and siblings, draft setup, running the Juniors, Majors and AAA drafts, Make teams, "
         "and team rosters, on the draft-sized fictional league. Expected numbers were checked on 2026-11-23 against the fixture files.")
CAST = [
    ("Admin (league administrator)", "admin.jordan@example.com, password FIXTURE_PASSWORD from .env.local (local) or .env.hosted.local (hosted)"),
    ("Coach: Finley Moss (Majors Cubs manager, AAA Braves coach)", "coach.finley@example.com, password FIXTURE_PASSWORD"),
    ("Coach: Avery Linden (AA Blue Jays manager)", "coach.avery@example.com, password FIXTURE_PASSWORD"),
    ("Assistant coach: Lee Mercer (Majors Pirates)", "lee.mercer@example.com, password FIXTURE_PASSWORD"),
    ("Registrar: Riley", "registrar.riley@example.com, password FIXTURE_PASSWORD"),
]
HOSTING_NOTES = [
    "Local: app at http://localhost:3000. Run it in one window per person: normal window (admin), private window (coach), another browser or profile (registrar).",
    "Hosted: use the Vercel address. Every account here has the password FIXTURE_PASSWORD from .env.hosted.local.",
    "Hosted needs every migration up to 20261123090000 applied.",
    "The families used here and what each tests: rwcll-fictional-test-league/generated/draft-families-spring-2027.csv (Scenario column).",
]
EXAMPLE = ["Example", "Admin", "Teams", "Open Teams.", "Majors 8 teams, each with a Manager and a Coach.", "", "Pass",
           "Took a moment to find the Draft menu."]

build(OUT, SUBTITLE, INTRO, PHASES, DB_CHECKS, CAST, HOSTING_NOTES, EXAMPLE)
