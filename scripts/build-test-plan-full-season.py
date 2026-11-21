"""Builds docs/TEST-PLAN-FULL-SEASON.xlsx: the whole season, every role, from an empty league to the draft.
Part A (by hand, on an empty league): accounts, registrations, prior-year ratings, bibs, sessions, evaluation week,
evaluation day, the makeup day, lock and release, draft reports. Part B (on the full fictional league): teams, families,
draft setup, the Juniors, Majors and AAA drafts, Make teams, team rosters.

It reuses the steps of the season-setup and draft plans (scripts/build-test-plan-season-setup.py and
scripts/build-test-plan-draft.py), so a change there shows up here too. End-of-season ratings are left out.
Run: python scripts/build-test-plan-full-season.py docs/TEST-PLAN-FULL-SEASON.xlsx (needs openpyxl)."""
import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_plan_xlsx import build  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/TEST-PLAN-FULL-SEASON.xlsx"


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), os.path.join(HERE, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


setup = load("build-test-plan-season-setup")
draft = load("build-test-plan-draft")


def phase(plan, prefix):
    found = [p for p in plan.PHASES if p[0].startswith(prefix)]
    if len(found) != 1:
        raise SystemExit(f"phase {prefix!r} not found exactly once")
    return found[0]


def text(s, offset):
    """Phase N -> Stage N + offset in step and check text."""
    return re.sub(r"Phases? (\d+)(?:-(\d+))?", lambda m: "Stage " + str(int(m.group(1)) + offset) + (f"-{int(m.group(2)) + offset}" if m.group(2) else ""), s)


def stage(number, plan, prefix, offset, title=None, minutes=None, summary=None, drop=(), extra=()):
    """A phase of an existing plan as stage `number`: step ids renumbered (x.y -> number.y), some dropped, new ones added."""
    name, mins, summ, steps = phase(plan, prefix)
    old = name.split(":")[0].split()[-1]
    out = []
    for sid, who, where, what, see, must in steps:
        if sid in drop:
            continue
        out.append((f"{number}.{sid.split('.', 1)[1]}", who, text(where, offset), text(what, offset), text(see, offset), must))
    out += list(extra)
    return (f"Stage {number}: {title or name.split(': ', 1)[1]}", minutes or mins, summary or summ, out)


# ---------------------------------------------------------------- Part A: an empty league, by hand
PART_A = [
    stage(0, setup, "Phase 0:", 0, extra=[
        ("0.6", "Admin", "Terminal (local) or Vercel (hosted test server)",
         "Turn on the test tools: add ENABLE_TEST_TOOLS=true to .env.local and restart npm run dev "
         "(or in PowerShell: $env:ENABLE_TEST_TOOLS='true'; npm run dev). HOSTED test server: Vercel, Settings, Environment Variables, then redeploy. "
         "Never on the real site.",
         "The Evaluation day menu ends with Test dates. It says \"Spring 2027 has its real dates.\" and \"No evaluation dates yet.\"", True),
    ]),
    stage(1, setup, "Phase 1:", 0, title="Accounts and roles (People)", minutes=25,
          summary="Invite coaches and evaluators from lists, then a registrar and an announcer, and sign in as each.", extra=[
        ("1.10", "Admin", "People, Invite one person",
         "Name Riley Registrar, email registrar.riley@example.com, role \"Registrar: check-in and registrations\", "
         "How they get in: Give me a link to send myself. Invite, then copy the link.",
         "\"Account created for registrar.riley@example.com. Send them this link ...\" with a Copy button.", True),
        ("1.11", "Admin", "People, Invite one person",
         "Same for Alex Announcer, announcer.alex@example.com, role \"Announcer: calls bibs on evaluation day\".",
         "A link for Alex.", True),
        ("1.12", "Registrar", "Another browser (or browser profile)",
         "Open Riley's link and choose a password.",
         "Home is \"Evaluation Day\". Menu: Check-in, Call players, Players, Imports, Rosters, Who scores when, Teams, Drafts, Team rosters. "
         "No Evaluations, Draft Reports or People.", True),
        ("1.13", "Announcer", "A private window of that other browser",
         "Open Alex's link and choose a password.",
         "Home offers Call players and Who scores when; the menu has only those two.", True),
        ("1.14", "Admin", "Roadmap, Before evaluations",
         "Find the step \"Make sure everyone can sign in\".",
         "It lists everyone who hasn't signed in yet (not Avery, Riley or Alex) with Email invite again, Sign-in link and Copy all emails.", False),
    ]),
    stage(2, setup, "Phase 2:", 0, minutes=35, extra=[
        ("2.10", "Registrar", "Riley's window, Players",
         "Search Alex Arbor and open him. Press Show next to the birthdate.",
         "The birthdate is hidden until Show. After Show it appears, and Change history at the bottom says \"Birthdate shown\". "
         "Lists only ever show \"✓ DOB\" or \"! No DOB\".", True),
        ("2.11", "Registrar", "Excel, then Imports, Sports Connect import",
         "Copy rwcll-fictional-test-league/generated/sports-connect-spring-2027-full.csv. In the copy change Alex Arbor's Player First Name to "
         "Alexander and delete Bailey Hayes's row; save as CSV. Import it for Spring 2027 (Save Batch for Review) and open the batch.",
         "Nothing is added twice. \"Players already registered\" shows Alex Arbor with the name change waiting for a tick; the others are up to date or show only differences you can review. "
         "\"Registered but not in this file\" lists Bailey Hayes (nothing is removed). Out-of-scope rows ignored before are ignored again.", True),
        ("2.12", "Registrar", "Import batch, Players already registered",
         "Leave Alex's change unticked and press Keep app values.",
         "The row is reviewed; Alex keeps his name in Players.", False),
    ]),
    stage(3, setup, "Phase 3:", 0),
    stage(4, setup, "Phase 4:", 0),
    stage(5, setup, "Phase 5:", 0, title="A walk-up player, an exemption and coach's kids", minutes=15,
          summary="A child who isn't registered, a player excused from scoring, and the coach's twins.", extra=[
        ("5.3", "Registrar", "Riley's window, Players, Eli Turner (age 7)",
         "Record an exemption: Excused from \"Being evaluated (doesn't need scores)\", reason \"Broken wrist, board approved\", "
         "approved by \"League president\". Record exemption.",
         "\"Exemption: Being evaluated\" with the reason, who approved and who recorded it. Players shows an Exempt badge and the Exempt filter (1).", True),
        ("5.4", "Admin", "Players, Fern Linden and Moss Linden (age 7)",
         "On each, press Mark as coach's kid.",
         "\"Coach's kid: Yes\". Players, Coach's kids filter (2).", False),
        ("5.5", "Admin", "Players, Possible duplicates",
         "Open Possible duplicates. If a pair is listed, open it and choose Not a duplicate with a reason.",
         "Pairs show both records' seasons, ages, bibs and scores, never birthdates. Not a duplicate hides the pair (Flag again brings it back).", False),
    ]),
    stage(6, setup, "Phase 6:", 0),
    stage(7, setup, "Phase 7:", 0, title="Assignments and the prior-year switch", extra=[
        ("7.2", "Admin", "Sessions, Season-wide settings",
         "Turn the prior-year switch on for Spring 2027.",
         "\"Prior-year ratings while scoring: Shown\".", False),
        ("7.3", "Admin", "Evaluation day, Who scores when",
         "Look at ages 7 and 8, then By person.",
         "Ages 7 and 8: Avery, Bailey, Cameron and Kendall with the 01/23/2027 times at Red Morton Park. Printable.", False),
    ]),
    ("Stage 8: Evaluation week", 25, "A week before: rosters, QR codes, help, open the first age groups, and look as a coach.", [
        ("8.1", "Admin", "Evaluation day, Test dates",
         "Press Make today the week before.",
         "\"Dates moved: a week before evaluations ...\". An amber strip across the top says the dates aren't the real ones. "
         "Main days are \"in 7 days\", makeups \"in 14 days\".", True),
        ("8.2", "Admin", "Roadmap",
         "Open the Roadmap.",
         "The suggested stage is Evaluation week (rosters, QR codes, who hasn't signed in).", True),
        ("8.3", "Admin", "Evaluation day, Rosters",
         "Age 7, sorted by bib. Print preview, then cancel.",
         "16 players with blank Check-in and Notes columns; Fern and Moss Linden marked CK; no birthdates. Fits the page.", False),
        ("8.4", "Admin", "Evaluation day, QR codes",
         "Open QR codes, then print preview.",
         "A large \"Scan to open RWCLL Evaluations\" code, the coach quick start, and one code per age group. "
         "LOCAL: a warning that the codes point at localhost (print them from the hosted site).", False),
        ("8.5", "Admin", "Help (the ? in the header)",
         "Open the coach guide and print it.",
         "A printable quick start for coaches; your own guides come first under \"For you\".", False),
        ("8.6", "Admin", "People",
         "Press Sign-in link on eval.kendall@example.com; open it in a third browser (or profile) and choose a password. "
         "Optional: do the same for coach.bailey and coach.cameron.",
         "Kendall lands on Home with a \"Your evaluations\" card for ages 7 and 8.", True),
        ("8.7", "Admin", "Sessions, ages 7 and 8",
         "Press Open Session on age 7, then on age 8.",
         "Both are Open. (Opening refuses without a main event and at least one evaluator.)", True),
        ("8.8", "Coach", "Avery, phone-size private window (F12, Ctrl+Shift+M)",
         "Home, then Evaluations, Age 7. Then Age 8 and open Aiden Bailey. Don't save.",
         "Home: \"Your evaluations\" with ages 7 and 8, the date in 7 days and Red Morton Park. Age 7: 16 players by bib with search; "
         "Fern and Moss show Coach's kid, Eli Turner shows Exempt; only the LL age, never a birthdate. "
         "Aiden Bailey shows his prior-year ratings (the switch is on).", True),
        ("8.9", "Admin", "People, View as",
         "Press View as on coach.avery and open the link in a private window of a browser Avery isn't using. Pick a score and press Save.",
         "A purple \"Admin preview\" banner. Saving says \"Admin preview is read-only: nothing is saved.\" End preview signs out.", True),
    ]),
    ("Stage 9: Evaluation day", 45, "Check-in, calling, scoring on phones (also with no signal), and watching progress.", [
        ("9.1", "Admin", "Evaluation day, Test dates",
         "Press Make today evaluation day.",
         "Main days are \"today\", makeups \"in 7 days\". The amber strip says \"evaluation day is today\".", True),
        ("9.2", "Admin", "Roadmap",
         "Open the Roadmap.",
         "The suggested stage is Evaluation day, with Check players in, Call players up and Watch scoring progress.", True),
        ("9.3", "Registrar", "Riley's window",
         "Home, then Check players in. Filter age 7 and tap six players.",
         "The day is today. Each tapped player is checked in and the \"X of Y here\" count goes up.", True),
        ("9.4", "Registrar", "Check-in",
         "Tap one of the six again.",
         "\"Undone: <name>\". The player stays on the screen so a slip can be fixed. Tap once more to check them in again.", False),
        ("9.5", "Announcer", "Alex's window (phone size)",
         "Call players: today, Age 7. Tap the first three bibs under Next up.",
         "Next up shows bibs that are here and not called yet. The \"X of Y called\" count shows 3, and the here count matches check-in. "
         "Hide players not here leaves only the six.", True),
        ("9.6", "Coach", "Avery's window",
         "Evaluations, Age 7.",
         "The six show Here, the three show Called, and a Now up strip lists the three called players (latest first).", True),
        ("9.7", "Coach", "Avery",
         "Tap the first player in Now up. Score all five core skills and press Save & Next. On the next player score only Hitting and Throwing and Save.",
         "Both save. The second is allowed with blanks (flagged later, not blocked). Save & Next went straight to the next bib.", True),
        ("9.8", "Coach", "Avery",
         "On another player press Not Evaluated. On another, write a Private note \"Great arm\" with a score and Save.",
         "Not Evaluated is recorded (not a zero). The note saves with the score.", False),
        ("9.9", "Evaluator", "Kendall's window",
         "Score the three called players (all five core skills). On one, write a Shared note \"Strong hitter\".",
         "Saves work. Kendall sees only Kendall's own notes.", True),
        ("9.10", "Coach", "Bailey and Cameron (optional, if you set their passwords in 8.6)",
         "Each scores the first called player.",
         "With three coaches on one player, the draft report will show the coach average with the high and low dropped (Stage 12).", False),
        ("9.11", "Coach", "Avery, no signal",
         "DevTools, Network, Offline (on a real phone: airplane mode). Score a player and press Save & Next. Then go back Online.",
         "Offline: the player shows \"On phone (not sent)\" and the header \"1 not sent\"; Save & Next still moves on. "
         "Online: within about 15 seconds the badge goes and the score is saved.", True),
        ("9.12", "Admin", "Evaluations, Scoring progress",
         "Open Scoring progress.",
         "Ages 7 and 8 first. Each scorer has a bar out of the players registered at that age; age 7 is out of 15 (Eli Turner is exempt from evaluation). "
         "\"3 called\" for age 7, and for each scorer who hasn't scored a called player: \"called by the announcer but not scored\".", True),
    ]),
    ("Stage 10: Makeup day and the end-of-day check", 15, "A week later: only players still missing are listed, and nobody is lost.", [
        ("10.1", "Admin", "Evaluation day, End-of-day check",
         "Still on evaluation day: open End-of-day check.",
         "Age 7: \"Called, but a score is missing\" names each assigned scorer without a score for a called player; \"Checked in, never called\" lists the other three.", True),
        ("10.2", "Admin", "Test dates",
         "Press Make today a makeup day.",
         "Makeups are \"today\", main days \"7 days ago\".", True),
        ("10.3", "Registrar", "Check-in",
         "Reload Check-in (today is the makeup day). Filter age 7.",
         "Players called or scored at the main event aren't listed; everyone else at age 7 is, including checked-in players who were never called.", True),
        ("10.4", "Announcer", "Call players",
         "Reload. Age 7.",
         "The same rule: only players not called and not scored yet.", False),
        ("10.5", "Admin", "End-of-day check",
         "Reload.",
         "Now also \"Never checked in\": age 7 players who didn't come on the main day (players excused from attending aren't listed).", False),
    ]),
    ("Stage 11: After evaluations: review, lock and release", 25, "Data Review, a correction, lock and release, the export and a backup.", [
        ("11.1", "Admin", "Test dates, then Roadmap",
         "Press Make evaluations finished, then open the Roadmap.",
         "The suggested stage is After evaluations.", True),
        ("11.2", "Admin", "Evaluations, Data Review",
         "Age 7. On Avery's score with only Hitting and Throwing press View / correct. Add Grounders 3, reason \"Coach told me the grounders score\". Save.",
         "Saved. The card shows \"Corrected by admin\"; the original saved time is kept.", True),
        ("11.3", "Admin", "Sessions, Age 7",
         "Press Lock Scoring and confirm.",
         "Age 7 is Locked. In Avery's window age 7 can't be saved any more.", True),
        ("11.4", "Coach", "Avery, Draft Reports",
         "Open Draft Reports.",
         "\"No draft reports have been released yet.\" (Locked isn't released.)", True),
        ("11.5", "Admin", "Sessions, ages 7 and 8",
         "Release to Coaches on age 7. Lock Scoring and Release to Coaches on age 8.",
         "Both Released. Undoing either needs a reason (Unlock Scoring, Unrelease).", True),
        ("11.6", "Admin", "Reports, Season Export",
         "Download the season CSV and open it in Excel.",
         "One row per evaluation (with the scorer) and the prior-year rows; every row, not just the first 1,000.", False),
        ("11.7", "Admin", "Roadmap, Seasons, Spring 2027, Download season backup",
         "Download the backup and open the zip.",
         "Readable CSVs (draft-report, scores, players, prior-year, people, schedule), tables/ and a README. No birthdates, private notes or stars.", False),
    ]),
    ("Stage 12: Draft reports, as each role", 25, "What admins, coaches and evaluators see once an age group is released.", [
        ("12.1", "Admin", "Reports, Draft Reports, Age 7",
         "Look at the columns; click the Coach column; tap a flag.",
         "Evaluator, Coach and Prior-year averages kept apart; sorted by evaluator overall until you click. "
         "Flags: Not rated on unscored players, N not evaluated, Not called (calling was used). Each flag explains itself; admins get Fix links.", True),
        ("12.2", "Coach", "Avery, Draft Reports, Age 7",
         "Expand the player Avery wrote a note on. Star two players, then My stars.",
         "Averages only: no other coach's scores and no evaluator names. The shared note says \"Independent evaluator\". "
         "Avery's private note is there and can be edited. My stars shows the two.", True),
        ("12.3", "Coach", "Avery",
         "If Bailey and Cameron scored in 9.10: find that player.",
         "The coach average has a second number in parentheses: the average with the highest and lowest coach score left out.", False),
        ("12.4", "Coach", "Avery",
         "Press CSV, then PDF, then Print.",
         "Each has the same order and the My stars filter. The PDF is landscape with a legend.", False),
        ("12.5", "Evaluator", "Kendall, Draft Reports, Age 7",
         "Expand a few rows.",
         "Kendall sees the report (released), Kendall's own shared notes and scores, and no coach's private notes.", True),
        ("12.6", "Coach", "Avery, Draft Reports, Age 8",
         "Find Aiden Bailey, Dylan Reed, Finn Hayes and Rhys Zielinski.",
         "Their Prior-year column is filled from the 2026 ratings imported in Stage 3.", False),
        ("12.7", "Admin", "Test dates",
         "Press Put the real dates back.",
         "\"The real dates are back.\" The amber strip is gone; the table shows Jan 23, 2027 (main) and Jan 30, 2027 (makeups) again.", True),
    ]),
    ("Stage 13: Things that must NOT work (Part A)", 10, "Each role tries pages that aren't theirs by typing the address.", [
        stage(13, setup, "Phase 9:", 0)[3][0],  # 13.1: Avery tries admin pages (season-setup step 9.1)
        ("13.2", "Registrar", "Riley's window",
         "Type /protected/evaluations, /protected/draft-reports, /protected/my-notes, /protected/people and /protected/sessions.",
         "Each sends Riley home. Registrars never see scores, notes or draft reports.", True),
        ("13.3", "Announcer", "Alex's window",
         "Type /protected/players, /protected/check-in and /protected/draft-reports.",
         "Each sends Alex home.", True),
        ("13.4", "Coach", "Avery",
         "Type /protected/progress, /protected/evaluation-review, /protected/check-in and /protected/test-dates.",
         "Each sends Avery home.", True),
        ("13.5", "Evaluator", "Private window",
         "As admin press Sign-in link on eval.orion; open it and choose a password. Open Evaluations and Draft Reports.",
         "No age groups to score (Orion has no assignment). Draft Reports shows nothing that isn't released.", True),
    ]),
]

# ---------------------------------------------------------------- Part B: the full league, teams and the draft
OFF = 14  # draft plan phase N becomes stage N + 14
PART_B = [
    stage(14, draft, "Phase 0:", OFF, title="Load the full league for the draft", minutes=15,
          summary="WIPES everything from Part A: fill in the Notes sheet first. Loads the scored, draft-sized league and jumps it to draft day."),
    *[stage(n + OFF, draft, f"Phase {n}:", OFF) for n in range(1, 9)],
    stage(23, draft, "Phase 10:", OFF, title="Things that must NOT work (Part B)", drop=("10.5",)),
    ("Stage 24: Wrap-up", 5, "Write down what you thought.", [
        ("24.1", "Admin", "Notes and problems sheet",
         "Fill in the Notes and problems sheet: anything confusing, anything that didn't work, one thing that worked well, and a score.",
         "A completed sheet.", False),
        ("24.2", "Admin", "Terminal (local)",
         "To start again: Part A from npm run fixtures:load -- --reset --bare; Part B from npm run demo:load then npm run demo:draft-day.",
         "PASS lines from the loader.", False),
    ]),
]

PHASES = PART_A + PART_B

ids = [s[0] for p in PHASES for s in p[3]]
dupes = sorted({i for i in ids if ids.count(i) > 1})
if dupes:
    raise SystemExit(f"duplicate step ids: {dupes}")

# ---------------------------------------------------------------- DB checks
DB_CHECKS = (
    [(f"S{c[0]}", text(c[1], 0), c[2], c[3], c[4]) for c in setup.DB_CHECKS]
    + [
        ("E1", "After Stage 9", "Evaluation day, age 7: check-ins, calls and scores",
         "select (select count(*) from public.player_checkins c join public.evaluation_session_events e on e.id = c.event_id\n"
         "         join public.evaluation_sessions es on es.id = e.evaluation_session_id where es.league_age = 7) as checkins,\n"
         "       (select count(*) from public.player_calls c join public.evaluation_session_events e on e.id = c.event_id\n"
         "         join public.evaluation_sessions es on es.id = e.evaluation_session_id where es.league_age = 7) as calls;\n"
         "select u.email, e.status, count(*) from public.evaluations e join public.evaluation_sessions es on es.id = e.evaluation_session_id\n"
         "join auth.users u on u.id = e.evaluator_user_id where es.league_age = 7 group by 1, 2 order by 1, 2;",
         "checkins 6, calls 3. Scores as you entered them: Avery's submitted ones and 1 not_evaluated, Kendall 3 submitted, Bailey and Cameron 1 each if you did 9.10."),
        ("E2", "After Stage 11", "Lock and release",
         "select league_age, status, published_at is not null as released from public.evaluation_sessions order by 1;",
         "Ages 7 and 8: locked, released. Ages 9-16: setup."),
        ("E3", "After Stage 12", "Test dates put back",
         "select event_type, event_date, count(*) from public.evaluation_session_events group by 1, 2 order by 1, 2;\n"
         "select count(*) as moved_seasons from public.test_date_backups;",
         "makeup 2027-01-30 (10), primary 2027-01-23 (10). moved_seasons 0."),
        ("E4", "Any time in Part A", "Evaluation-day actions (audit log)",
         "select created_at, action, target_table, left(coalesce(reason, ''), 50) as reason from public.audit_log\n"
         "where action in ('player_checked_in', 'player_check_in_undone', 'player_called', 'evaluation_admin_corrected', 'test_dates_set',\n"
         "  'test_dates_restored', 'birthdate_revealed', 'player_exemption_set')\n"
         "order by created_at desc limit 40;",
         "Each check-in, undo, call, correction (with its reason), birthdate shown, exemption and test-date move appears."),
    ]
    + [(f"D{c[0]}", text(c[1], OFF), c[2], c[3], c[4]) for c in draft.DB_CHECKS if c[0] != "5"]
)

# ---------------------------------------------------------------- who can do what
ROLES = ["Admin", "Registrar", "Announcer", "Coach", "Evaluator"]
ROLE_ROWS = [
    ("Roadmap (admin home)", "Yes", "No", "No", "No", "No", "1.14, 8.2"),
    ("People, Sessions, Assignments, Data Review, Season Export, Scoring progress, End-of-day check, Test dates", "Yes", "No", "No", "No", "No", "13.2, 13.4"),
    ("Prior-year upload, Age chart upload, Possible duplicates", "Yes", "Age chart: look only", "No", "No", "No", "2.0, 3.1"),
    ("Players (edit name, age, bib), Sports Connect import, bib upload, walk-ups, exemptions", "Yes", "Yes", "No", "No", "No", "2.11, 5.3"),
    ("See a birthdate", "One at a time with Show (logged)", "One at a time with Show (logged)", "No", "No", "No", "2.10, 8.8"),
    ("Check-in, Rosters, QR codes", "Yes", "Yes", "No", "No", "No", "9.3"),
    ("Call players, Who scores when", "Yes", "Yes", "Yes", "No", "No", "9.5"),
    ("Score players (Evaluations)", "No", "No", "No", "Assigned open age groups", "Assigned open age groups", "9.7, 9.9"),
    ("Private notes", "No (not even admins)", "No", "No", "Own only", "No", "9.8, 12.2"),
    ("Shared notes", "All, with author", "No", "No", "Released, as \"Independent evaluator\"", "Own only", "9.9, 12.5"),
    ("Draft Reports", "Every age, any time", "No", "No", "Released ages", "Released ages", "11.4, 12.2"),
    ("Another coach's individual scores", "Yes (Data Review)", "No", "No", "No (averages only)", "No", "12.2"),
    ("Stars", "Own only", "No", "No", "Own only", "Own only", "12.2"),
    ("Teams, Drafts (setup and running), Team rosters, Make teams", "Yes", "Yes", "No", "No", "No", "Part B"),
    ("Watch a draft", "Yes", "Yes", "No", "Manager and Coach of a team in that division (not assistants)", "No", "Part B, 23.1-23.2"),
    ("Your team (released rosters)", "-", "-", "-", "Manager, Coach and assistants of the team", "-", "Part B"),
    ("Read-only preview (View as)", "Starts it", "-", "-", "-", "-", "8.9"),
]

SUBTITLE = "Full season test plan: every role, from an empty league to the draft"
INTRO = ("Part A (Stages 0-13) builds the season by hand on an empty league: accounts, registrations, bibs, sessions, evaluation week and day, "
         "the makeup day, lock and release, and draft reports, with the admin, registrar, announcer, coaches and an evaluator. "
         "Part B (Stages 14-24) loads the full, scored league and runs teams and the drafts. The parts can be run on different days; "
         "Part B wipes Part A. Steps reused from the season-setup and draft plans keep their checked numbers (2026-11-23).")
CAST = [
    ("Admin (league administrator)", "admin.jordan@example.com, password FIXTURE_PASSWORD from .env.local (local) or .env.hosted.local (hosted)"),
    ("Coach: Avery Linden (ages 7 and 8)", "coach.avery@example.com, password you choose in step 1.8 (Part B: FIXTURE_PASSWORD)"),
    ("Coaches: Bailey and Cameron (optional)", "coach.bailey@example.com, coach.cameron@example.com, Sign-in link in step 8.6"),
    ("Evaluator: Kendall (ages 7 and 8)", "eval.kendall@example.com, Sign-in link in step 8.6"),
    ("Evaluator with no assignment: Orion", "eval.orion@example.com, Sign-in link in step 13.5"),
    ("Registrar: Riley", "registrar.riley@example.com, link from step 1.10 (Part B: FIXTURE_PASSWORD)"),
    ("Announcer: Alex", "announcer.alex@example.com, link from step 1.11"),
    ("Part B coaches", "coach.finley@example.com (Majors Cubs manager), lee.mercer@example.com (Pirates assistant): FIXTURE_PASSWORD"),
]
HOSTING_NOTES = [
    "One person can play every role: admin in a normal Chrome window; Avery in a phone-size private Chrome window (F12, Ctrl+Shift+M); "
    "Riley and Alex in another browser (normal and private); Kendall in a third browser or profile. Better: one tester per role, on real phones.",
    "Local: app at http://localhost:3000 with ENABLE_TEST_TOOLS=true, Studio http://127.0.0.1:54323, emails in Mailpit http://127.0.0.1:54324.",
    "Hosted test server: the Vercel address, ENABLE_TEST_TOOLS=true set in Vercel (never on the real site), every migration applied, "
    "Site URL and Redirect URLs set. Emails to @example.com go nowhere: use \"Give me a link\" and Sign-in link.",
    "Test dates (Evaluation day menu) move the season's evaluation dates so today is the day being tested; Stage 12 puts the real dates back.",
    "To rehearse only evaluation day with many people: npm run demo:load (ages 7-8 open and partly scored, dated today), then Stages 9-10.",
    "Files are in rwcll-fictional-test-league/ and rwcll-fictional-test-league/generated/.",
]
EXAMPLE = ["Example", "Registrar", "Check-in", "Filter age 7 and tap six players.", "Each is checked in.", "", "Pass",
           "The age filter was below the fold on my phone."]
EXTRA = [("Who can do what",
          "What each role should and shouldn't be able to do. The last column lists steps that check it. Anything a role can do that this says No to is a must-fix problem.",
          ["Page or action"] + ROLES + ["Checked in"], [44, 20, 20, 16, 26, 22, 14], ROLE_ROWS)]

if __name__ == "__main__":
    build(OUT, SUBTITLE, INTRO, PHASES, DB_CHECKS, CAST, HOSTING_NOTES, EXAMPLE, EXTRA)
