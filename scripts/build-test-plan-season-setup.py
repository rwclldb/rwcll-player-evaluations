"""Builds docs/TEST-PLAN-SEASON-SETUP.xlsx (season setup walkthrough).
Run: python scripts/build-test-plan-season-setup.py docs/TEST-PLAN-SEASON-SETUP.xlsx (needs openpyxl)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_plan_xlsx import build  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/TEST-PLAN-SEASON-SETUP.xlsx"

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
    ("Phase 2: Registrations (Sports Connect import)", 25, "Upload the age chart, stage the registration file, use the two bulk buttons, then decide the 17 rows that need a person.", [
        ("2.0", "Admin", "Players, Age chart",
         "Open Imports, Sports Connect import, choose the file in 2.1 and season Spring 2027, and look at the preview (don't save). Then open Players, Age chart "
         "(season Spring 2027), drop rwcll-fictional-test-league/little-league-baseball-age-chart-2027.csv on the box (or click it and choose the file), "
         "check the preview and press Save as the Spring 2027 chart.",
         "Before: the preview flags rows \"No age chart for this season (upload it on Age chart)\" and shows no ages. The upload preview says \"ages 4-16, 156 birth months\"; "
         "after saving: \"Saved: 156 birth months.\", a grid of ages 4 to 16 with the file name, and \"Players whose age doesn't match the chart (0)\". "
         "Roadmap, Before evaluations: Upload the age chart is Done.", True),
        ("2.1", "Admin", "Imports, Sports Connect import",
         "Choose rwcll-fictional-test-league/generated/sports-connect-spring-2027-full.csv and season Spring 2027. Press Save Batch for Review, then open the batch.",
         "\"Saved staging batch #N with 444 rows.\" The batch page shows a Bulk review panel at the top.", True),
        ("2.2", "Admin", "Import batch, Bulk review",
         "Read the out-of-scope programs listed, then press Ignore out-of-scope rows.",
         "\"86 out-of-scope row(s) ignored.\" (A, Tee Ball, softball, Challenger and similar.)", True),
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
         "357 registrations. No age group (1): Val Hayes.", True),
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
         "42 rows: 0 imported, 37 ready, 3 to review, 2 held, 0 rejected.", True),
        ("3.2", "Admin", "Prior-year upload, Check these",
         "For Sage Vale and Taylor Carter (name and birthdate agree, Player Id changed) and Umaya Arbor (registered as \"Uma Arbor\") choose \"Same child\".",
         "Each row offers the registered player with birthdate, Player Id, age and bib.", False),
        ("3.3", "Admin", "Prior-year upload",
         "Press Import selected ratings.",
         "\"40 prior-year rating(s) imported.\"", True),
        ("3.4", "Admin", "Prior-year upload, Held",
         "Micah Oakes (a look-alike) and Kit Lindqvist (not returning) are held. Press Check held rows again, then tick both and Dismiss.",
         "Check again: \"No held rows match a player yet.\" Dismiss: \"2 row(s) dismissed.\"", False),
        ("3.5", "Admin", "Imports, Prior-year ratings",
         "Upload the same file again.",
         "40 rejected (already imported), 2 held (the dismissed players). Nothing imports twice.", True),
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
         "Give them bibs 901, 902 and 903 on their edit pages (no reason needed for a bib). These are outside the fixture range (201-676).",
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
     "357 registrations, 0 with no age group (after 2.8). Import rows: committed 357, ignored 86, and Harper Oak's row not committed. "
     "select count(*) from public.season_age_charts; gives 156 (the Spring 2027 chart from 2.0)."),
    ("3", "After Phase 3", "Prior-year ratings",
     "select (select count(*) from public.historical_evaluations) as ratings_imported;\n"
     "select review_state, match_status, count(*) from public.historical_evaluation_import_rows group by 1, 2 order by 1, 2;",
     "40 imported. First upload: 40 imported, 2 rejected (dismissed). Second upload: 40 invalid, 2 held."),
    ("4", "After Phase 4", "Bibs",
     "select count(*) filter (where evaluation_number is not null) as with_bib,\n       count(*) filter (where evaluation_number is null) as without_bib\n"
     "from public.player_seasons;\n"
     "select evaluation_number, count(*) from public.player_seasons where evaluation_number is not null group by 1 having count(*) > 1;",
     "with_bib 357, without_bib 0. The second query returns no rows (no bib used twice)."),
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

SUBTITLE = "Test plan: season setup, up to evaluation day"
INTRO = ("A hands-on walkthrough of everything an admin does before evaluation day, on the fictional league. "
            "Run it locally first, then on the hosted test server. Expected numbers were checked against the fixture files (updated 2026-11-23 for the draft-sized league).")
CAST = [
    ("Admin (league administrator)", "admin.jordan@example.com, password FIXTURE_PASSWORD from .env.local (local) or .env.hosted.local (hosted)"),
    ("Coach (Avery Linden)", "coach.avery@example.com, password you choose in step 1.8"),
    ("Evaluator with no assignment (Orion Vance)", "eval.orion@example.com, password you choose in step 9.3"),
]
HOSTING_NOTES = [
    "Local: app at http://localhost:3000, Supabase Studio http://127.0.0.1:54323, every email lands in Mailpit http://127.0.0.1:54324.",
    "Hosted: use the Vercel address. Emails to @example.com go nowhere, so use \"Give me a link\" / \"Create without email\" and the Sign-in link button on People.",
    "Hosted needs, once: all migrations applied, SUPABASE_SECRET_KEY on Vercel, and the Vercel address in Supabase Authentication > URL Configuration (Site URL and Redirect URLs).",
    "Files used are in the project folder: rwcll-fictional-test-league/ and rwcll-fictional-test-league/generated/.",
]
EXAMPLE = ["Example", "Admin", "Players", "Open Players.", "Season Spring 2027, 0 registrations.", "", "Pass",
           "The No bib filter was hard to spot on my phone."]

build(OUT, SUBTITLE, INTRO, PHASES, DB_CHECKS, CAST, HOSTING_NOTES, EXAMPLE)
