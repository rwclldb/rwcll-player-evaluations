"""Builds docs/TEST-PLAN-SEASON-SETUP.xlsx (season setup walkthrough). Run: python scripts/build-test-plan-season-setup.py docs/TEST-PLAN-SEASON-SETUP.xlsx (needs openpyxl)."""
import sys
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule

OUT = sys.argv[1]
FONT = "Arial"
GREEN = "1B5E20"
LIGHT = "E3EFE5"
BANNER_FILL = PatternFill("solid", fgColor=GREEN)
HEAD_FILL = PatternFill("solid", fgColor=LIGHT)
INPUT_FILL = PatternFill("solid", fgColor="FFF9DB")
EXAMPLE_FONT = Font(name=FONT, size=9, italic=True, color="7F7F7F")
thin = Side(style="thin", color="B7C4BA")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP = Alignment(wrap_text=True, vertical="top")


def f(size=10, bold=False, color="000000", italic=False):
    return Font(name=FONT, size=size, bold=bold, color=color, italic=italic)


# ---------------------------------------------------------------- the script
# (phase, minutes, summary) then steps: (id, who, where, what to do, what you should see, must_pass)
PHASES = [
    ("Phase 0: Before we start", 10, "Start from an empty league and sign in as the admin.", [
        ("0.1", "Admin", "Terminal (local) or PowerShell (hosted)",
         "LOCAL: run  npm run fixtures:load -- --reset --bare  then  npm run dev  and open http://localhost:3000.\n"
         "HOSTED: npx supabase link --project-ref <ref>, npx supabase db reset --linked, then\n"
         "npm run fixtures:load -- --hosted --confirm-project=<ref> --bare, and open the Vercel address.",
         "The loader ends with: PASS: bare league loaded: 2 admin accounts, Spring 2026 (closed) and Spring 2027.", True),
        ("0.2", "Admin", "Sign-in page",
         "Sign in as admin.jordan@example.com with FIXTURE_PASSWORD (.env.local locally, .env.hosted.local for hosted).",
         "You land on the dashboard. The menu shows Players, Sessions, People, Assignments, Imports, Data Review, Draft Reports, Reports "
         "(on a phone or narrow window they are under the menu button).", True),
        ("0.3", "Admin", "Players",
         "Open Players.",
         "Season Spring 2027, 0 registrations. No bib / No age group / Added on site all show (0).", False),
        ("0.4", "Admin", "Database check 0 (optional)",
         "In the Supabase SQL Editor (hosted) or Studio http://127.0.0.1:54323 (local), run check 0 from the DB checks sheet.",
         "2 accounts, 2 seasons, 0 registrations, 0 prior-year ratings.", False),
        ("0.5", "Admin", "Mailpit (local only)",
         "LOCAL: open http://127.0.0.1:54324 in another tab. HOSTED: skip; use \"Give me a link\" / \"Create without email\" in Phase 1.",
         "An empty inbox. Every app email lands here when you test locally.", False),
    ]),
    ("Phase 1: Accounts (People)", 15, "Invite coaches from the Sports Connect volunteer report, then the independent evaluators.", [
        ("1.1", "Admin", "People, Invite from a list",
         "Season Spring 2027. Choose rwcll-fictional-test-league/sports-connect-volunteers-spring-2027.csv.",
         "Preview: 10 rows, 9 selected. Finley Moss is listed twice (Majors and Juniors); the second row is unticked. "
         "Every role is Coach (Coach, Assistant Coach and Team Manager all become coaches). Each row shows its Sports Connect role and division.", True),
        ("1.2", "Admin", "People, Invite from a list",
         "New accounts: LOCAL choose \"Email each an invitation\"; HOSTED choose \"Create without email\". Press Invite selected.",
         "LOCAL: \"9 invited by email\" and 9 emails in Mailpit titled \"You've been invited\". "
         "HOSTED: \"9 account(s) created (no email sent ...)\". All 9 show Coach and \"Hasn't signed in yet\".", True),
        ("1.3", "Admin", "People, Invite from a list",
         "Same with rwcll-fictional-test-league/independent-evaluators-spring-2027.csv.",
         "Preview: 6 rows, all Independent evaluator. Result: 6 invited (or created).", True),
        ("1.4", "Admin", "People, Accounts",
         "Search \"jamie\".",
         "Two accounts: coach.jamie@example.com (Coach) and eval.jamie@example.com (Evaluator): one person, two accounts.", False),
        ("1.5", "Admin", "People, Accounts",
         "On coach.jamie@example.com choose Evaluator and press Add.",
         "REFUSED: an account can't be both a coach and an independent evaluator in the same season.", True),
        ("1.6", "Admin", "People, Invite one person",
         "Name Test Admin, email test.admin@example.com, role League admin, How they get in: \"Give me a link to send myself\". Invite.",
         "\"Account created for test.admin@example.com. Send them this link ...\" with a link and a Copy button. "
         "Then remove the Admin role from Test Admin (the x on the Admin chip): \"Role removed.\"", False),
        ("1.7", "Admin", "People, Accounts",
         "On your own account (admin.jordan) remove the Admin role.",
         "REFUSED: you can't remove your own administrator role.", True),
        ("1.8", "Coach", "Private window",
         "Get Avery in: LOCAL open the invitation email to coach.avery@example.com in Mailpit and press its link; "
         "OR (local or hosted) as admin press Sign-in link on coach.avery and open that link in a private window. "
         "Choose a password and save it.",
         "You land in the app signed in as Avery. Menu: Evaluations, Draft Reports, My Notes. Evaluations has no age groups yet. "
         "Back on People (admin), Avery now shows Active.", True),
        ("1.9", "Admin", "People, Accounts",
         "Disable eval.orion@example.com, then Enable it again.",
         "\"Account disabled. They can no longer sign in.\" then \"Account enabled.\"", False),
    ]),
    ("Phase 2: Registrations (Sports Connect import)", 20, "Stage the registration file, use the two bulk buttons, then decide the 17 rows that need a person.", [
        ("2.1", "Admin", "Imports, Sports Connect import",
         "Choose rwcll-fictional-test-league/generated/sports-connect-spring-2027-full.csv and season Spring 2027. Press Save Batch for Review, then open the batch.",
         "\"Saved staging batch #N with 368 rows.\" The batch page shows a Bulk review panel at the top.", True),
        ("2.2", "Admin", "Import batch, Bulk review",
         "Read the out-of-scope programs listed, then press Ignore out-of-scope rows.",
         "\"77 out-of-scope row(s) ignored.\" (A, Tee Ball, softball, Challenger and similar.)", True),
        ("2.3", "Admin", "Import batch, Bulk review",
         "Press Approve and commit clean rows.",
         "\"274 clean row(s) approved as new players and committed.\" The panel then shows 0 and 0.", True),
        ("2.4", "Admin", "Open Administrator Row Review",
         "7 pairs of different children share a name (14 rows): Luke Rivera, Jasper Hughes, Jonah Powell, Ethan Rogers, "
         "Lucas Phillips, Julian Reed, Owen Price. Birthdates and Player Ids differ: approve each as a NEW player and commit.",
         "Each commits. After the first of a pair is committed, the second shows it as a possible match; you still choose new.", False),
        ("2.5", "Admin", "Row Review",
         "Gray Hayes and Harper Oak share Player Id 77100077. Resolve the duplicate warning on Gray (different children), "
         "approve and commit Gray. Then try to approve and commit Harper.",
         "Gray commits. Harper is REFUSED: \"Player Id 77100077 is already registered this season to Gray Hayes. "
         "Fix the Player Id in Sports Connect and import this row again.\" Leave Harper in review.", True),
        ("2.6", "Admin", "Row Review",
         "Val Hayes has no birthdate. Approve as new and commit.",
         "Val commits.", False),
        ("2.7", "Admin", "Players",
         "Open Players, then the No age group filter.",
         "290 registrations. No age group (1): Val Hayes.", True),
        ("2.8", "Admin", "Players, Val Hayes",
         "Open Val. Age group 11, Reason \"No birthdate; parent confirmed age 11\". Save changes.",
         "\"Saved.\" Change history shows Age group: - -> 11. On the list Val shows \"Age set by admin\" and No age group is (0).", True),
        ("2.9", "Admin", "Players, any player",
         "Change the first name and press Save without a reason.",
         "REFUSED: give a reason for changing the name, birthdate, or age group. Nothing changes.", False),
    ]),
    ("Phase 3: Prior-year coach ratings", 10, "Upload last season's end-of-season coach ratings and match them to this season's players.", [
        ("3.1", "Admin", "Imports, Prior-year ratings",
         "Match to players in Spring 2027. Choose rwcll-fictional-test-league/generated/spring-2026-coach-ratings.csv. Preview.",
         "38 rows: 0 imported, 33 ready, 3 to review, 2 held, 0 rejected.", True),
        ("3.2", "Admin", "Prior-year upload, Check these",
         "For Sage Vale and Taylor Carter (name and birthdate agree, Player Id changed) and Umaya Arbor (registered as \"Uma Arbor\") choose \"Same child\".",
         "Each row offers the registered player with birthdate, Player Id, age and bib.", False),
        ("3.3", "Admin", "Prior-year upload",
         "Press Import selected ratings.",
         "\"36 prior-year rating(s) imported.\"", True),
        ("3.4", "Admin", "Prior-year upload, Held",
         "Micah Oakes (a look-alike) and Kit Lindqvist (not returning) are held. Press Check held rows again, then tick both and Dismiss.",
         "Check again: \"No held rows match a player yet.\" Dismiss: \"2 row(s) dismissed.\"", False),
        ("3.5", "Admin", "Imports, Prior-year ratings",
         "Upload the same file again.",
         "36 rejected (already imported), 2 held (the dismissed players). Nothing imports twice.", True),
    ]),
    ("Phase 4: Bibs", 15, "Bibs from a spreadsheet, then fill the gaps by hand.", [
        ("4.1", "Admin", "Players, Upload bibs",
         "Choose rwcll-fictional-test-league/generated/bib-numbers-by-player-id.csv. Preview.",
         "Will set (287). Nothing else.", True),
        ("4.2", "Admin", "Bib upload",
         "Press Apply bibs.",
         "\"287 bib(s) set.\"", True),
        ("4.3", "Admin", "Players, No bib",
         "Open the No bib filter.",
         "3 players: Gale Oak, Indigo Vale, Jamie Carter (the fixture leaves them without bibs on purpose).", False),
        ("4.4", "Admin", "Players, each of the three",
         "Give them bibs 901, 902 and 903 on their edit pages (no reason needed for a bib). These are outside the fixture range (201-548).",
         "\"Saved.\" No bib shows (0).", True),
        ("4.5", "Admin", "Players, any other player",
         "Give a fourth player bib 901.",
         "REFUSED: \"Bib 901 is already used by <name> this season.\"", True),
        ("4.6", "Admin", "Players, Upload bibs",
         "Upload rwcll-fictional-test-league/generated/bib-numbers-with-errors.csv. Compare with its Expected Result column. Don't apply.",
         "Conflicts (1): Eli Turner (245 belongs to Wren Carter). Already set (2): Alex Arbor, Elliot Carter. "
         "Held (2): Player Id 99999999, Player Id 77100077 (shared Id). Rejected (5): bib 201 twice, \"A12\", blank, Hugo Long (out of scope), Elliot Carter twice.", True),
        ("4.7", "Admin", "Players, Upload bibs (optional)",
         "Make a 2-line CSV (Player Id, Evaluation Number) giving one player a different bib than they have. Preview, leave the change unticked, Apply.",
         "The row is under Changes with a checkbox. After Apply the player keeps the old bib (\"Kept the current bib\").", False),
    ]),
    ("Phase 5: A walk-up player", 5, "A child shows up on evaluation day who isn't registered.", [
        ("5.1", "Admin", "Players, Add player on site",
         "Step 1: last name Hayes, press Check.",
         "Hayes players already registered this season are listed with a \"Find them\" link, not as choices to add again.", False),
        ("5.2", "Admin", "Add player on site",
         "First name Test, last name Walkup, no birthdate, age group 9, bib 950, reason \"Walk-up at evaluations\". Add player.",
         "The player page says \"Added on site\" and \"No Sports Connect Player Id yet\". Players, Added on site (1).", True),
    ]),
    ("Phase 6: Sessions and dates", 10, "One session per age group, with the evaluation date and a makeup date.", [
        ("6.1", "Admin", "Sessions",
         "Create the 10 missing age sessions for Spring 2027.",
         "Ages 7 to 16 exist, all in Setup.", True),
        ("6.2", "Admin", "Sessions, Global primary event schedule",
         "01/23/2027, 09:00 to 13:00, location Red Morton Park. Preview eligible sessions, then apply.",
         "Every age group shows \"Primary event scheduled\".", True),
        ("6.3", "Admin", "Sessions, Global makeup event schedule",
         "01/30/2027, same times and place. Preview, then apply.",
         "Every age group has a makeup event.", False),
        ("6.4", "Admin", "Sessions, Age 15",
         "Change age 15's primary event to start at 13:00.",
         "Only age 15 changes.", False),
    ]),
    ("Phase 7: Assignments", 10, "Assign coaches and evaluators to age groups (ages 7 and 8 are enough to test).", [
        ("7.1", "Admin", "Assignments",
         "Ages 7-8: Avery, Bailey, Cameron (coaches) and Kendall (evaluator). Optional, the rest: 9-10 Cameron, Dakota, Elliot + Kendall (9), Lane (10); "
         "11-12 Elliot, Finley, Harper + Lane, Nico; 13-14 Harper, Indigo, Jamie (coach) + Micah, Nico (13), Jamie (eval, 14); "
         "15-16 Indigo, Jamie (coach), Avery + Micah, Jamie (eval).",
         "Each age group lists its people. Orion has no assignment.", True),
    ]),
    ("Phase 8: Ready for evaluation day", 10, "Open one age group and look at it the way a coach will.", [
        ("8.1", "Admin", "Sessions, Age 7",
         "Press Open Session.",
         "Age 7 is Open. (Opening refuses without a primary event and at least one evaluator.)", True),
        ("8.2", "Admin", "Dashboard, Evaluation-Day Roster",
         "Roster for age 7, sorted by bib. Print preview, then cancel.",
         "Bibs and names with blank Check-in and Notes columns; it fits the page.", False),
        ("8.3", "Admin", "Sessions",
         "Turn the prior-year switch on for Spring 2027.",
         "\"Prior-year ratings while scoring: Shown\".", False),
        ("8.4", "Coach", "Phone-sized private window",
         "Sign in as Avery. Evaluations, Age 7.",
         "Age 7 \"Scoring open\", players listed by bib with search. A player opens the scoring page with Save & Next, Save, Not Evaluated and a Private note box. "
         "Don't save anything.", True),
        ("8.5", "Admin", "Draft Reports, Age 10",
         "Open the age 10 report.",
         "The Prior-Year column is filled for players with 2026 ratings (for example Quinn Hayes). The banner says coaches can't see it yet.", False),
        ("8.6", "Admin", "Sessions, Age 7",
         "Return to Setup (nobody has saved an evaluation).",
         "Age 7 is back in Setup.", False),
    ]),
    ("Phase 9: Things that must NOT work", 5, "Coaches and evaluators try admin pages by typing the address.", [
        ("9.1", "Coach", "Address bar (as Avery)",
         "Go to /protected/players, /protected/people, /protected/prior-year and /protected/import-batches.",
         "Each one sends you back to the dashboard. No admin data is shown.", True),
        ("9.2", "Coach", "Draft Reports (as Avery)",
         "Open Draft Reports.",
         "\"No draft reports have been released yet.\"", True),
        ("9.3", "Evaluator", "Private window",
         "As admin make a Sign-in link for eval.orion and open it in a private window; set a password. Open Evaluations.",
         "No age groups. Orion can't score anyone.", True),
    ]),
    ("Phase 10: Wrap-up", 5, "Write down what you thought.", [
        ("10.1", "Admin", "Notes and problems sheet",
         "Fill in the Notes and problems sheet: anything confusing, anything that didn't work, one thing that worked well, and a score.",
         "A completed sheet.", False),
        ("10.2", "Admin", "Terminal (local)",
         "To get the normal test league back: npm run fixtures:load -- --reset --open-sessions (or --scored for draft reports).",
         "PASS: pre-evaluation dataset loaded.", False),
    ]),
]

DB_CHECKS = [
    ("0", "Before Phase 1", "Empty league",
     "select (select count(*) from auth.users) as accounts,\n       (select count(*) from public.seasons) as seasons,\n"
     "       (select count(*) from public.player_seasons) as registrations,\n       (select count(*) from public.historical_evaluations) as prior_year_ratings;",
     "accounts 2, seasons 2, registrations 0, prior_year_ratings 0"),
    ("1", "After Phase 1", "Roles for Spring 2027",
     "select r.role_name, count(*) from public.user_roles r left join public.seasons s on s.id = r.season_id\n"
     "where r.season_id is null or s.name = 'Spring 2027' group by 1 order by 1;",
     "administrator 2, coach 9, independent_evaluator 6"),
    ("2", "After Phase 2", "Registrations and import rows",
     "select (select count(*) from public.player_seasons) as registrations,\n"
     "       (select count(*) from public.player_seasons where league_age is null) as no_age_group;\n"
     "select review_state, count(*) from public.sports_connect_import_rows group by 1 order by 1;",
     "290 registrations, 0 with no age group (after 2.8). Import rows: committed 290, ignored 77, and Harper Oak's row not committed."),
    ("3", "After Phase 3", "Prior-year ratings",
     "select (select count(*) from public.historical_evaluations) as ratings_imported;\n"
     "select review_state, match_status, count(*) from public.historical_evaluation_import_rows group by 1, 2 order by 1, 2;",
     "36 imported. First upload: 36 imported, 2 rejected (dismissed). Second upload: 36 invalid, 2 held."),
    ("4", "After Phase 4", "Bibs",
     "select count(*) filter (where evaluation_number is not null) as with_bib,\n       count(*) filter (where evaluation_number is null) as without_bib\n"
     "from public.player_seasons;\n"
     "select evaluation_number, count(*) from public.player_seasons where evaluation_number is not null group by 1 having count(*) > 1;",
     "with_bib 290, without_bib 0. The second query returns no rows (no bib used twice)."),
    ("5", "After Phase 5", "Walk-up player",
     "select p.first_name, p.last_name, ps.league_age, ps.evaluation_number, ps.registration_source, ps.external_player_id\n"
     "from public.player_seasons ps join public.players p on p.id = ps.player_id where ps.registration_source = 'on_site';",
     "Test Walkup, 9, 950, on_site, (blank)"),
    ("6", "After Phases 6-7", "Sessions, events, assignments",
     "select es.league_age, es.status,\n       (select count(*) from public.evaluation_session_events e where e.evaluation_session_id = es.id) as events,\n"
     "       (select count(*) from public.evaluator_assignments a where a.evaluation_session_id = es.id) as people_assigned\n"
     "from public.evaluation_sessions es order by 1;",
     "10 rows (ages 7-16), 2 events each, people assigned as in step 7.1."),
    ("A", "Any time", "Recent admin actions (audit log)",
     "select created_at, action, target_table, left(coalesce(reason, ''), 60) as reason\nfrom public.audit_log order by created_at desc limit 30;",
     "Every change in the plan appears: imports, bibs, prior-year imports, role changes, account invites, age changes."),
]

wb = Workbook()

# ---------------------------------------------------------------- Overview
ov = wb.active
ov.title = "Overview"
ov.sheet_view.showGridLines = False
ov.column_dimensions["A"].width = 4
ov.column_dimensions["B"].width = 44
ov.column_dimensions["C"].width = 70
ov.column_dimensions["D"].width = 14
ov["B1"] = "RWCLL Player Evaluations"
ov["B1"].font = f(18, True, GREEN)
ov["B2"] = "Test plan: season setup, up to evaluation day"
ov["B2"].font = f(13, True)
ov["B3"] = ("A hands-on walkthrough of everything an admin does before evaluation day, on the fictional league. "
            "Run it locally first, then on the hosted test server. Expected numbers were checked on 2026-11-11 against the fixture files.")
ov["B3"].font = f(10)
ov["B3"].alignment = WRAP
ov.merge_cells("B3:D3")
ov.row_dimensions[3].height = 30
ov["B5"] = "Date run:"
ov["C5"] = ""
ov["B6"] = "Where (local / hosted):"
ov["B7"] = "Tester:"
for r in (5, 6, 7):
    ov[f"B{r}"].font = f(10, True)
    ov[f"C{r}"].fill = INPUT_FILL
    ov[f"C{r}"].border = BOX

row = 9
ov[f"B{row}"] = "The plan at a glance"
ov[f"B{row}"].font = f(12, True, GREEN)
row += 1
for col, text in zip("BCD", ("Phase", "What happens", "Minutes")):
    c = ov[f"{col}{row}"]
    c.value = text
    c.font = f(10, True)
    c.fill = HEAD_FILL
    c.border = BOX
first_phase_row = row + 1
for name, minutes, summary, _ in PHASES:
    row += 1
    ov[f"B{row}"] = name
    ov[f"C{row}"] = summary
    ov[f"D{row}"] = minutes
    for col in "BCD":
        ov[f"{col}{row}"].font = f(10, col == "B")
        ov[f"{col}{row}"].alignment = WRAP
        ov[f"{col}{row}"].border = BOX
last_phase_row = row
row += 1
ov[f"C{row}"] = "Total minutes"
ov[f"C{row}"].font = f(10, True)
ov[f"C{row}"].alignment = Alignment(horizontal="right")
ov[f"D{row}"] = f"=SUM(D{first_phase_row}:D{last_phase_row})"
ov[f"D{row}"].font = f(10, True)

row += 2
ov[f"B{row}"] = "Results so far (filled in from the Script sheet)"
ov[f"B{row}"].font = f(12, True, GREEN)
summary_start = row + 1
results = [
    ("Steps", '=COUNTA(Script!A:A)-COUNTIF(Script!A:A,"Phase*")-COUNTIF(Script!A:A,"#")-COUNTIF(Script!A:A,"Example")'),
    ("Pass", '=COUNTIF(Script!G:G,"Pass")'),
    ("Fail", '=COUNTIF(Script!G:G,"Fail")'),
    ("Skipped", '=COUNTIF(Script!G:G,"Skipped")'),
    ("Not done yet", f"=B{summary_start}-B{summary_start+1}-B{summary_start+2}-B{summary_start+3}"),
    ("Must-pass steps", '=COUNTIF(Script!F:F,"★")'),
    ("Must-pass steps that failed", '=COUNTIFS(Script!F:F,"★",Script!G:G,"Fail")'),
]
for i, (label, formula) in enumerate(results):
    r = summary_start + i
    ov[f"C{r}"] = label
    ov[f"C{r}"].font = f(10, label.startswith("Must-pass steps that"))
    ov[f"C{r}"].alignment = Alignment(horizontal="right")
    ov[f"D{r}"] = formula
    ov[f"D{r}"].font = f(10, True)
    ov[f"D{r}"].border = BOX
# The "Not done yet" formula refers to the column-D cells; fix the column letter.
ov[f"D{summary_start+4}"] = f"=D{summary_start}-D{summary_start+1}-D{summary_start+2}-D{summary_start+3}"
ov.conditional_formatting.add(f"D{summary_start+6}", CellIsRule(operator="greaterThan", formula=["0"],
                              fill=PatternFill("solid", fgColor="F8D7DA"), font=Font(name=FONT, bold=True, color="9C0006")))
row = summary_start + len(results) + 1

ov[f"B{row}"] = "How to fill it in"
ov[f"B{row}"].font = f(12, True, GREEN)
legend = [
    "Script sheet: pick Pass, Fail or Skipped in the Result column (yellow), and write anything odd in Notes (yellow).",
    "A star (★) in the Must-pass column marks the minimum the app has to do. Any must-pass Fail means it isn't ready for real people.",
    "The words on screen may differ slightly from the sheet. That's fine; note it if a button was hard to find.",
    "Stuck for 3 minutes? Write the step number and what you saw in Notes, mark it Fail or Skipped, and move on.",
    "Database checks (optional) are on the DB checks sheet. They only read data. Run them in the Supabase SQL Editor (hosted) or Studio (local).",
    "The grey italic row at the top of the Script sheet is an example of a filled-in row.",
]
for text in legend:
    row += 1
    ov[f"B{row}"] = "•  " + text
    ov[f"B{row}"].font = f(10)
    ov[f"B{row}"].alignment = WRAP
    ov.merge_cells(f"B{row}:D{row}")
    ov.row_dimensions[row].height = 28

row += 2
ov[f"B{row}"] = "The cast and their logins"
ov[f"B{row}"].font = f(12, True, GREEN)
row += 1
for col, text in zip("BCD", ("Role", "Login (email) and password", "Played by")):
    c = ov[f"{col}{row}"]
    c.value = text
    c.font = f(10, True)
    c.fill = HEAD_FILL
    c.border = BOX
cast = [
    ("Admin (league administrator)", "admin.jordan@example.com, password FIXTURE_PASSWORD from .env.local (local) or .env.hosted.local (hosted)"),
    ("Coach (Avery Linden)", "coach.avery@example.com, password you choose in step 1.8"),
    ("Evaluator with no assignment (Orion Vance)", "eval.orion@example.com, password you choose in step 9.3"),
]
for role, login in cast:
    row += 1
    ov[f"B{row}"] = role
    ov[f"C{row}"] = login
    ov[f"D{row}"].fill = INPUT_FILL
    for col in "BCD":
        ov[f"{col}{row}"].font = f(10)
        ov[f"{col}{row}"].alignment = WRAP
        ov[f"{col}{row}"].border = BOX
row += 1
ov[f"B{row}"] = ("One person can play every role: use a normal window for the admin and a private window for the coach or evaluator. "
                 "Every account here is fictional (@example.com).")
ov[f"B{row}"].font = f(9, italic=True, color="595959")
ov[f"B{row}"].alignment = WRAP
ov.merge_cells(f"B{row}:D{row}")
ov.row_dimensions[row].height = 26

row += 2
ov[f"B{row}"] = "Local or hosted"
ov[f"B{row}"].font = f(12, True, GREEN)
notes = [
    "Local: app at http://localhost:3000, Supabase Studio http://127.0.0.1:54323, every email lands in Mailpit http://127.0.0.1:54324.",
    "Hosted: use the Vercel address. Emails to @example.com go nowhere, so use \"Give me a link\" / \"Create without email\" and the Sign-in link button on People.",
    "Hosted needs, once: all migrations applied, SUPABASE_SECRET_KEY on Vercel, and the Vercel address in Supabase Authentication > URL Configuration (Site URL and Redirect URLs).",
    "Files used are in the project folder: rwcll-fictional-test-league/ and rwcll-fictional-test-league/generated/.",
]
for text in notes:
    row += 1
    ov[f"B{row}"] = "•  " + text
    ov[f"B{row}"].font = f(10)
    ov[f"B{row}"].alignment = WRAP
    ov.merge_cells(f"B{row}:D{row}")
    ov.row_dimensions[row].height = 28

# ---------------------------------------------------------------- Script
sc = wb.create_sheet("Script")
sc.sheet_view.showGridLines = False
headers = ["#", "Who", "Where", "What to do", "What you should see", "Must-pass", "Result", "Notes"]
widths = [6, 10, 22, 55, 55, 9, 11, 34]
for i, (h, w) in enumerate(zip(headers, widths), start=1):
    col = sc.cell(row=1, column=i).column_letter
    sc.column_dimensions[col].width = w
    c = sc.cell(row=1, column=i, value=h)
    c.font = f(10, True)
    c.fill = HEAD_FILL
    c.border = BOX
    c.alignment = Alignment(vertical="center", wrap_text=True)
sc.freeze_panes = "A2"

result_dv = DataValidation(type="list", formula1='"Pass,Fail,Skipped"', allow_blank=True,
                           prompt="Pass, Fail or Skipped", promptTitle="Result")
sc.add_data_validation(result_dv)

r = 2
example = ["Example", "Admin", "Players", "Open Players.", "Season Spring 2027, 0 registrations.", "", "Pass",
           "The No bib filter was hard to spot on my phone."]
for i, v in enumerate(example, start=1):
    c = sc.cell(row=r, column=i, value=v)
    c.font = EXAMPLE_FONT
    c.alignment = WRAP
    c.border = BOX

for name, minutes, summary, steps in PHASES:
    r += 1
    sc.cell(row=r, column=1, value=name)
    sc.merge_cells(start_row=r, start_column=1, end_row=r, end_column=8)
    c = sc.cell(row=r, column=1)
    c.value = f"{name}   ({summary} About {minutes} minutes.)"
    c.font = f(11, True, "FFFFFF")
    c.fill = BANNER_FILL
    c.alignment = Alignment(vertical="center", wrap_text=True)
    sc.row_dimensions[r].height = 22
    for sid, who, where, todo, see, must in steps:
        r += 1
        values = [sid, who, where, todo, see, "★" if must else "", None, None]
        for i, v in enumerate(values, start=1):
            c = sc.cell(row=r, column=i, value=v)
            c.font = f(10, bold=(i == 1 and must))
            c.alignment = WRAP
            c.border = BOX
        sc.cell(row=r, column=6).alignment = Alignment(horizontal="center", vertical="top")
        sc.cell(row=r, column=6).font = f(12, True, "B8860B")
        for col in (7, 8):
            sc.cell(row=r, column=col).fill = INPUT_FILL
        result_dv.add(sc.cell(row=r, column=7))
        longest = max(len(todo), len(see))
        sc.row_dimensions[r].height = max(30, min(150, 13 * (longest // 52 + 1)))
last_script_row = r
sc.conditional_formatting.add(f"G3:G{last_script_row}", CellIsRule(operator="equal", formula=['"Pass"'],
                              fill=PatternFill("solid", fgColor="D4EDDA")))
sc.conditional_formatting.add(f"G3:G{last_script_row}", CellIsRule(operator="equal", formula=['"Fail"'],
                              fill=PatternFill("solid", fgColor="F8D7DA")))
sc.conditional_formatting.add(f"G3:G{last_script_row}", CellIsRule(operator="equal", formula=['"Skipped"'],
                              fill=PatternFill("solid", fgColor="E2E3E5")))
sc.auto_filter.ref = f"A1:H{last_script_row}"
sc.print_title_rows = "1:1"
sc.page_setup.orientation = "landscape"
sc.page_setup.fitToWidth = 1
sc.page_setup.fitToHeight = 0
sc.sheet_properties.pageSetUpPr.fitToPage = True

# ---------------------------------------------------------------- DB checks
db = wb.create_sheet("DB checks")
db.sheet_view.showGridLines = False
for col, w in zip("ABCDEF", (6, 16, 28, 80, 50, 11)):
    db.column_dimensions[col].width = w
db["A1"] = "Database checks (read-only). Paste the SQL into the Supabase SQL Editor (hosted) or Studio's SQL editor (local) and run it."
db["A1"].font = f(10, True, GREEN)
db.merge_cells("A1:F1")
for i, h in enumerate(["Check", "When", "What", "SQL (read-only)", "Expected", "Result"], start=1):
    c = db.cell(row=2, column=i, value=h)
    c.font = f(10, True)
    c.fill = HEAD_FILL
    c.border = BOX
db_dv = DataValidation(type="list", formula1='"Pass,Fail,Skipped"', allow_blank=True)
db.add_data_validation(db_dv)
for i, (cid, when, what, sql, expected) in enumerate(DB_CHECKS, start=3):
    for j, v in enumerate([cid, when, what, sql, expected, None], start=1):
        c = db.cell(row=i, column=j, value=v)
        c.font = Font(name="Consolas", size=9) if j == 4 else f(10)
        c.alignment = WRAP
        c.border = BOX
    db.cell(row=i, column=6).fill = INPUT_FILL
    db_dv.add(db.cell(row=i, column=6))
    db.row_dimensions[i].height = max(45, 13 * (sql.count("\n") + 2))
db.freeze_panes = "A3"

# ---------------------------------------------------------------- Notes and problems
np_ = wb.create_sheet("Notes and problems")
np_.sheet_view.showGridLines = False
for col, w in zip("ABCD", (10, 80, 16, 20)):
    np_.column_dimensions[col].width = w
np_["A1"] = "One line per problem. Blocker = I couldn't continue. Annoying = it worked but was confusing or slow. Idea = something that would help."
np_["A1"].font = f(10, True, GREEN)
np_.merge_cells("A1:D1")
for i, h in enumerate(["Step #", "What happened, or what confused you", "Blocker / Annoying / Idea", "Who saw it too?"], start=1):
    c = np_.cell(row=2, column=i, value=h)
    c.font = f(10, True)
    c.fill = HEAD_FILL
    c.border = BOX
    c.alignment = WRAP
kind_dv = DataValidation(type="list", formula1='"Blocker,Annoying,Idea"', allow_blank=True)
np_.add_data_validation(kind_dv)
for i in range(3, 23):
    for j in range(1, 5):
        c = np_.cell(row=i, column=j)
        c.border = BOX
        c.fill = INPUT_FILL
        c.font = f(10)
        c.alignment = WRAP
    kind_dv.add(np_.cell(row=i, column=3))
    np_.row_dimensions[i].height = 24
np_["A25"] = "My score, from 1 (I wouldn't trust it) to 5 (I'd use it next season):"
np_["A25"].font = f(10, True)
np_.merge_cells("A25:C25")
np_["D25"].fill = INPUT_FILL
np_["D25"].border = BOX
np_["A27"] = "The three most confusing moments:"
np_["A27"].font = f(10, True)
for i, r in enumerate(range(28, 31), start=1):
    np_[f"A{r}"] = f"{i}."
    np_[f"A{r}"].font = f(10)
    np_.merge_cells(f"B{r}:D{r}")
    np_[f"B{r}"].fill = INPUT_FILL
    np_[f"B{r}"].border = BOX
np_["A32"] = "One thing that worked well:"
np_["A32"].font = f(10, True)
np_.merge_cells("B33:D33")
np_["B33"].fill = INPUT_FILL
np_["B33"].border = BOX

for ws in wb.worksheets:
    ws.sheet_properties.tabColor = GREEN if ws.title == "Script" else "8FBC8F"

from openpyxl.workbook.properties import CalcProperties
wb.calculation = CalcProperties(fullCalcOnLoad=True)
wb.save(OUT)
print("saved", OUT, "script rows to", last_script_row)
