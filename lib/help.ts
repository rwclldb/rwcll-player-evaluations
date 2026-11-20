// In-app help: one guide per role, shown at /protected/help/<guide> and printable as a quick-start sheet.
//
// Keep this file in step with the app. When a screen changes, update the matching section here.
// Writing rules:
//   [[Label]]  a button, tab or link exactly as it reads on screen. scripts/test-help-content.cjs checks that every
//              [[Label]] still appears in the app's code, so renamed buttons make the test fail.
//   **text**   bold.
// Blocks: a plain string is a paragraph; { steps } is a numbered list; { list } a bulleted list; { tip } a callout.

export type HelpBlock = string | { steps: string[] } | { list: string[] } | { tip: string };
export type HelpSection = { id: string; title: string; blocks: HelpBlock[] };
export type HelpGuide = { key: GuideKey; title: string; audience: string; intro: string; sections: HelpSection[] };
export type GuideKey = "coach" | "evaluator" | "registrar" | "announcer";

const signingIn: HelpSection = {
  id: "signing-in",
  title: "Signing in",
  blocks: [
    "Accounts are set up by the league. You'll get either an invitation email or a sign-in link from a league admin.",
    { steps: [
      "Open the link and choose a password (at least 8 characters). On a phone, tap the eye in the password box to see what you typed.",
      "To open the app on a phone, you can also scan a QR code from the league (on printed guides and at the field). If you're not signed in yet, you sign in first and then land on that page.",
      "After that, sign in with your email and password. On a phone, add the site to your home screen so it's one tap away.",
      "Forgot your password? Use [[Forgot password?]] on the sign-in page, or ask a league admin for a new sign-in link.",
    ] },
    "To change your name or password, tap the person icon at the top, then [[Your account]] (on a phone: the menu, then [[Your account]]). Light or dark screen and Sign out are there too. Your sign-in email can only be changed by a league admin.",
  ],
};

const scoring = (who: "coach" | "evaluator"): HelpSection => ({
  id: "scoring",
  title: "Scoring players",
  blocks: [
    who === "coach"
      ? "Open [[Evaluations]] and pick an age group. You can score the age groups you are assigned to; ask a league admin if one is missing. Scoring opens when an admin opens the age group, usually on evaluation day."
      : "Open [[Evaluations]] and pick your age group. Scoring opens when an admin opens the age group, usually on evaluation day.",
    { steps: [
      "Players are listed by bib number. Tap a player, or type a bib in [[Go to bib #]] and tap [[Go]].",
      "Rate each skill from 1 (lowest) to 5 (highest). The five core skills are hitting, throwing, grounders, fly balls and running/awareness. Pitching and catching are optional.",
      "Didn't see a skill? Leave it on [[Not scored]]. Blank skills are never counted as zero.",
      "Answer the pitching and catching questions if you know ([[Not sure]] is fine).",
      "Tap [[Save & Next]] to save and go straight to the next bib, or [[Save]] to stay on this player.",
    ] },
    "Saving needs at least one core skill. If a player didn't take part at all, tap [[Not Evaluated (clears ratings)]].",
    "You can change your scores any time until the league locks the age group. Your scores count in the draft report as soon as you save.",
    { list: [
      "**Saved**: your scores are in. **Not evaluated**: you marked the player as not evaluated. **Not started**: nothing saved yet.",
      "**Here**: the registrar checked the player in today.",
      "**Called**: the announcer has called the player up. **Now up**, at the top of the list and on each player, shows the latest bibs called; tap one to open that player.",
      "**CK**: a coach's kid. Score them like everyone else; the league decides how coach's kids are drafted.",
      "**Exempt**: the league excused the player from attending, from being evaluated, or both. You can still score them if they take part.",
      "**Prior-year coach rating** (blue box): last season's coach ratings, when the league has turned them on.",
    ] },
    { tip: "If you tap a rating and then move to another player without saving, the app asks before throwing the change away." },
  ],
});

const noSignal: HelpSection = {
  id: "no-signal",
  title: "No signal at the field",
  blocks: [
    "Keep scoring. When the phone has no connection, each save is kept on the phone and the player shows **On phone (not sent)**. Save & Next still moves to the next player.",
    { list: [
      "An amber badge at the top shows how many saves are waiting (for example \"2 not sent\"). Tap it to see which players.",
      "When the signal comes back, the saves are sent automatically, on any page, and the badge disappears.",
      "Don't refresh the page, clear the browser's data, or sign out while the badge is showing.",
      "If the badge turns red, the league's system refused a save (for example, the age group was locked). Tap it to read why, then tell a league admin. [[Send now]] tries again; [[Discard]] throws that save away.",
    ] },
  ],
};

const draftReports = (who: "coach" | "evaluator"): HelpSection => ({
  id: "draft-reports",
  title: "Draft reports",
  blocks: [
    "After evaluations, the league releases each age group's draft report. Open [[Draft Reports]] and choose the age group.",
    { list: [
      "**Coach average**: the average of all coaches' scores. The number in parentheses leaves out the single highest and lowest coach score for that skill (when 3 or more coaches scored it).",
      "**Evaluator average**: the independent evaluators' average, kept separate from coaches.",
      "**Prior year**: last season's coach ratings for the player.",
      "Tap a column heading to sort. Tap a row to see each skill" + (who === "coach" ? ", your own scores and your private note (you can edit the note there)." : " and your own scores."),
      "Shared notes from independent evaluators appear in the expanded row, labelled only \"Independent evaluator\".",
      "**Flags** in the last column (for example \"No bib\" or \"1 blank skill\") point out something to know about a player's numbers. Tap a flag to see what it means.",
      "Tap the star next to a name to add the player to your private shortlist, then use [[My stars]] to show only them. Nobody else sees your stars.",
      "[[PDF]] saves the report as a PDF file, in the order and with the filter you see (sort by a column or use [[My stars]] first); handy to bring to the draft. [[CSV]] downloads it for a spreadsheet; [[Print]] prints it.",
    ] },
    who === "coach"
      ? "You never see another coach's individual scores, only the averages, and evaluators' names are never shown to coaches."
      : "Coaches never see your name next to your scores or notes.",
  ],
});

export const GUIDES: HelpGuide[] = [
  {
    key: "coach",
    title: "Coach quick start",
    audience: "Coaches",
    intro: "How to score players on evaluation day, keep private notes, and use the draft reports. Everything works on a phone.",
    sections: [
      signingIn,
      {
        id: "before",
        title: "Before evaluation day",
        blocks: [
          "Your home page shows **Your evaluations**: the date, the age groups listed for you with times and place, and any makeup days. The button changes from waiting, to [[Score]] when scoring opens, to [[Draft report]] once the report is released.",
          { tip: "Sign in once before evaluation day so you know your password works." },
        ],
      },
      scoring("coach"),
      {
        id: "notes",
        title: "Private notes",
        blocks: [
          "Each player's scoring page has a **Private note** box. Only you can ever read it; league admins can't either. It's saved with [[Save]] or [[Save & Next]].",
          "[[My Notes]] lists every note you've written this season. You can change your notes any time, even after scoring is locked.",
        ],
      },
      noSignal,
      draftReports("coach"),
      {
        id: "draft-room",
        title: "Watching the draft",
        blocks: [
          "If you're the Manager or Coach of a team, you can follow your division's draft live on your phone or laptop. League admins make every pick; you watch and plan.",
          { steps: [
            "On the home page, tap [[Watch the draft]] under Drafts.",
            "The [[Board]] shows every pick by round and team; your team is marked (you), and the team on the clock is highlighted. Picks appear within a few seconds.",
            "[[Players]] lists who is still available. Sort by the evaluator average, the coach average, the coach average with the high and low left out, last year's rating, or your own scores. The top player is marked [[Next best]].",
            "Tap the star to add a player to [[My stars]], and the note icon to write a private note. Only you can see them; they're the same stars and notes as on the draft report.",
            "[[My team]] lists your players so far.",
          ] },
          "Coach's kids go to their parent's team automatically, and siblings play together. Picks marked [[Must draft]] near the end are kept for players who have to be drafted, such as every 12-year-old in Majors.",
        ],
      },
      {
        id: "your-team",
        title: "Your team",
        blocks: [
          "Once the league releases your division's rosters, your home page shows your team. Tap [[See the roster]] for the players with their bib numbers and ages. Managers, coaches and assistant coaches all see it.",
          "Tap [[Print]] to print it or save it as a PDF. If a player is missing or on the wrong team, ask a league admin: they move players and every move is logged.",
        ],
      },
      {
        id: "end-of-season",
        title: "Rating your team at the end of the season (managers)",
        blocks: [
          "When the season ends, the league opens end-of-season ratings and each team's **manager** gets a **Rate your players** card on the home page. Coaches and assistants don't rate; one rating per player per team.",
          { steps: [
            "Tap [[Start rating]]. Your players are listed with **To do**, **Rated** or **Not rated**.",
            "Tap a player and score them 1 to 5 on the five core skills, the same scale as evaluation day. Pitching and catching are optional. Leave a skill blank (**Not scored**) if you didn't see it.",
            "Tap [[Save & Next]] to save and go to the next player still to do, or [[Save]] to stay. [[All players]] goes back to the list.",
            "If you can't rate a player at all (they hardly played, for example), tap [[Not rated]].",
          ] },
          "You can change a rating until the league closes ratings. After that you can still look at what you saved.",
          { tip: "Next season, these ratings show as the player's prior-year ratings to the coaches and evaluators who score them, and on the draft report." },
        ],
      },
      {
        id: "faq",
        title: "Questions",
        blocks: [
          { list: [
            "**I scored the wrong player.** Open that player, fix the scores and tap [[Save]], or tap [[Not Evaluated (clears ratings)]]. This works until the age group is locked.",
            "**An age group I expected isn't listed.** Ask a league admin to add you to it.",
            "**A player isn't on the list.** Players are listed by age group. If they're new, the registrar adds them at check-in.",
            "**The age group says it's locked.** Scoring has closed. Ask a league admin if something needs fixing.",
          ] },
        ],
      },
    ],
  },
  {
    key: "evaluator",
    title: "Independent evaluator quick start",
    audience: "Independent evaluators",
    intro: "How to score your age group on evaluation day and write shared notes for coaches.",
    sections: [
      signingIn,
      {
        id: "before",
        title: "Before evaluation day",
        blocks: [
          "Your home page shows **Your evaluations**: the date, your age group with time and place, and any makeup days.",
          { tip: "Sign in once before evaluation day so you know your password works." },
        ],
      },
      scoring("evaluator"),
      {
        id: "notes",
        title: "Shared notes",
        blocks: [
          "Each player's scoring page has a **Shared note** box for things coaches should know. It's saved with [[Save]] or [[Save & Next]].",
          "Coaches see shared notes in the draft report after it's released, labelled \"Independent evaluator\" without your name. League admins see your name. Notes lock with the age group.",
          "[[My Notes]] lists the notes you've written.",
        ],
      },
      noSignal,
      draftReports("evaluator"),
    ],
  },
  {
    key: "registrar",
    title: "Registrar guide",
    audience: "Registrars",
    intro: "Checking players in on evaluation day, adding walk-ups and bibs, keeping registrations up to date, and printing rosters and timetables. Registrars never see scores, notes or draft reports.",
    sections: [
      signingIn,
      {
        id: "home",
        title: "Your home page",
        blocks: [
          "**Evaluation Day** shows the next evaluation day and, on the day, how many players are checked in. From there: [[Check players in]], [[Call players]] (if there's no announcer), [[Add a walk-up]], [[Print rosters]], [[Who scores when]], [[Players]] and [[Registration imports]].",
        ],
      },
      {
        id: "check-in",
        title: "Checking players in",
        blocks: [
          { steps: [
            "Open [[Check-in]]. Today's evaluation day is picked for you; tap another day to switch.",
            "Find the player: type a name or bib number in the search box, or tap an age.",
            "Tap the player to check them in. A green tick and **Here** appear, and coaches see **Here** on their scoring list.",
            "Tapped the wrong player? Tap them again. The message says **Undone**.",
          ] },
          { list: [
            "[[Not here yet]] shows only players still to arrive; [[Everyone]] shows the whole list.",
            "On makeup days, the list shows only players who weren't called up earlier and haven't been scored, so a child who came but was missed is listed again.",
            "No bib yet? Tap [[+ Bib]], type the number and tap [[Save]]. A bib already in use is refused with the name of who has it.",
            "Several people can check in at once; the list refreshes every 30 seconds.",
            "Players marked **Exempt from attending** aren't expected: they're left out of [[Not here yet]], the count and makeup days. Check them in if they come anyway.",
          ] },
        ],
      },
      {
        id: "walk-ups",
        title: "Walk-ups (not registered)",
        blocks: [
          { steps: [
            "Tap [[Add a walk-up]] (also on the Check-in page).",
            "Type the last name (and first name) and tap [[Check]]. If the league already knows the child from an earlier season, pick them so they aren't added twice.",
            "Fill in the age group (league age), birthdate if known, and a bib, then tap [[Add player]].",
            "You're taken back to Check-in. Find the player and tap to check them in.",
          ] },
          "When the child later appears in a Sports Connect upload, their registration is linked to the walk-up.",
        ],
      },
      {
        id: "players",
        title: "Fixing a player's details",
        blocks: [
          "Open [[Players]], search, and open the player. You can fix the name, birthdate, age group and bib, and mark a coach's kid. Name, birthdate and age-group changes need a short reason. Tap [[Save changes]].",
          "Birthdates are private: lists only show **✓ DOB** (on file) or **No DOB**. On a player's page the birthdate stays hidden until you tap [[Show]] (which is recorded) or [[Change]] to type a new one. Coaches and evaluators only ever see the Little League age.",
          "Once anyone has scored the player, the age group can't change. Every change is recorded and shown at the bottom of the page.",
          "**Exemptions**: when the league excuses a player, open [[Record an exemption]] on their page, choose what they're excused from (attending, being evaluated, or both), give the reason and, if someone else decided, who approved it, then tap [[Record exemption]]. Coaches and evaluators see only that the player is exempt, not the reason. [[Change or remove the exemption]] replaces or removes it (with a reason); the old one stays in the history. [[Players]] has an [[Exempt]] filter.",
        ],
      },
      {
        id: "imports",
        title: "Uploading the Sports Connect export",
        blocks: [
          { steps: [
            "Export the season's registrations from Sports Connect as a CSV.",
            "Open [[Imports]], then [[Sports Connect import]]. Choose the file and the season, check the preview, and tap [[Save Batch for Review]].",
            "Open the batch. Players already in the app are compared, not added twice: unchanged ones are marked up to date, and payment status and missing bibs update on their own.",
            "Under **Players already registered**, tick any changes to accept (a corrected name or birthdate, for example) and tap [[Apply ticked changes]], or [[Keep app values]].",
            "Under **Bulk review**, [[Ignore out-of-scope rows]] (Tee Ball and other programs) and [[Approve and commit clean rows]] (new players with no problems).",
            "Anything left needs a decision one row at a time in [[Open Administrator Row Review]].",
          ] },
          { tip: "Upload the full export as often as you like. Nothing is ever removed, and players missing from a later file are only listed." },
          "Each player's Little League age comes from the season's official age chart, which a league admin uploads once a season. If the preview says **No age chart for this season**, ask an admin to upload it before you save the batch.",
        ],
      },
      {
        id: "bibs",
        title: "Uploading bib numbers",
        blocks: [
          "If bibs come in a spreadsheet, open [[Players]], then [[Upload bibs]]. Choose the file and tap [[Preview]]. Review new bibs and changes (tick the changes to accept), then tap [[Apply bibs]].",
          "Rows that don't match a player are held; [[Check held rows again]] after the next registration upload.",
        ],
      },
      {
        id: "printing",
        title: "Rosters and timetables",
        blocks: [
          { list: [
            "[[Rosters]]: one page per age group with Check-in and Notes columns. Sort by [[Bib number]] or [[Last name, first name]] and tap [[Print]].",
            "[[Who scores when]]: each age group's time and place with its coaches and evaluators, [[By age group]] or [[By person]] (handy to give each coach their times). Tap [[Print]].",
            "[[QR codes]]: printable codes that open the app, each age group's scoring list, and the coach quick start. Post them at the fields. Print them from the league's website, not a test computer.",
          ] },
        ],
      },
      {
        id: "teams",
        title: "Teams, coach's kids and siblings",
        blocks: [
          "Before the draft, every team needs a Manager and a Coach. They are the two who sit in the draft room, and their kids follow the coach's-kid draft rules. Assistant coaches are listed on the team only.",
          { steps: [
            "Open [[Teams]]. Under each division, tap the Add team button, or upload a spreadsheet with [[Upload teams from a spreadsheet]]. The Sports Connect volunteer report works as is.",
            "On each team, choose the Manager and the Coach, add any assistants, and tap [[Save]]. Only people with the coach role this season are listed; someone already on another team in the same division is greyed out.",
            "Tap [[Coach's kids and siblings]]. Accept or dismiss each suggestion: players registered by the same family account ([[Group as siblings]]), or with a coach's own email (link as that coach's kid).",
            "Every player marked \"Coach's kid\" needs a parent linked. Choose the coach and tap [[Link]]. Twins: link each twin to the same parent.",
          ] },
          "Siblings in the same division go to the same team in the draft. Add a group with [[New sibling group]] if the suggestions missed one.",
        ],
      },
      {
        id: "draft-setup",
        title: "Setting up a draft",
        blocks: [
          "Drafts run oldest first: Juniors, then Majors, then AAA. Players a draft doesn't take drop to the next division whose ages fit.",
          { steps: [
            "Open [[Drafts]] and tap [[Open setup]] on a division (or set one up). A new draft starts with last season's rules for that division.",
            "Check the [[Rules]]: the must-draft ages, roster size, snake or straight order, open or oldest first, the coach's-kid rule, siblings, and the pick timer. Tap [[Save rules]].",
            "Under [[Teams and first-round order]], tap [[Draw the order]], or set it by hand if the draw happened outside the app. One team can have a bigger roster.",
            "Under [[Coach's kids]], check each kid's round. Rounds come from the rule; change one if needed.",
            "Look through [[The pool]]. To put a player in, take one out, or move one to another division, use Change… or Add a player to this pool, with a short note saying why. Every change is logged.",
          ] },
          "The box at the top lists anything still to do before the draft can start, such as an order that isn't set or age groups not released to coaches yet.",
        ],
      },
      {
        id: "running-the-draft",
        title: "Running the draft",
        blocks: [
          { steps: [
            "On the setup page, tap [[Start the draft…]] and confirm. The rules, order and roster sizes lock.",
            "In the draft room, tap a player in the list, check the bar at the bottom, and tap Pick for the team on the clock.",
            "Coach's kids and siblings are picked automatically when their turn comes. When a sibling doesn't have to be in this draft, choose [[Take with next pick]] or [[Send down]].",
            "Near the end, picks marked must draft only take must-draft players. To pick someone else, type a short note saying why; it's kept with the pick.",
            "Use [[Pause]] for a break and [[Resume]] to carry on. Open [[Projector]] on the screen in the room.",
            "When the picks are done, tap [[Finish draft]]. Undrafted players drop to the next division whose ages fit.",
          ] },
          "There's no undo. To fix a wrong pick while the draft is running, move that player back to the pool on [[Team rosters]]: the pick opens again and comes up next.",
        ],
      },
      {
        id: "make-teams",
        title: "Making teams without a draft",
        blocks: [
          "Any division can have its teams made by the app instead of a draft. RWCLL does this for AA, and for Seniors when there's more than one team.",
          { steps: [
            "Add the division's teams first (Teams page). For AA, wait until the AAA draft is finished: its left-over 8- and 9-year-olds join the AA pool.",
            "On [[Drafts]], tap [[Make teams]] on the division (also on Team rosters).",
            "Tick what to balance on: evaluator, coach and prior-year ratings (none ticked makes random teams). Leave [[Balance ages too]] on to spread each age across the teams.",
            "Check the teams. [[Make again]] gives a different mix; use a player's team box to move them by hand.",
            "Tap Place to save. Players already on a team stay there; coach's kids go to their parent's team and siblings stay together.",
          ] },
          "Afterwards the teams are on Team rosters, where players can still be moved (with a note) and rosters released.",
        ],
      },
      {
        id: "team-rosters",
        title: "Team rosters and moves",
        blocks: [
          { steps: [
            "Open [[Team rosters]]. Each division lists its teams with their staff and players, and how each player got there (round and pick, coach's kid, sibling, or moved).",
            "To move a player, tap the arrows next to their name, choose the team (or back to the pool) and type a short note. Every move is logged and listed under [[Moves]].",
            "Players not on a team are listed under [[Unplaced]], grouped by the pool they're in. Place them on a team the same way.",
            "When a division is final, tap [[Release rosters]]. Each team's manager, coach and assistants then see their own team on their home page.",
            "Tap [[Download CSV]] for a spreadsheet of every team's players, to rename the columns for Sports Connect.",
          ] },
        ],
      },
    ],
  },
  {
    key: "announcer",
    title: "Announcer guide",
    audience: "Announcers",
    intro: "Calling players up by bib on evaluation day and ticking each one off, so every child is seen. Announcers see names, bibs and ages only: never scores, notes or reports.",
    sections: [
      signingIn,
      {
        id: "home",
        title: "Your home page",
        blocks: [
          "**Evaluation Day** shows the next evaluation day and, on the day, how many players have been called. Tap [[Call players]] to start. [[Who scores when]] has each age group's time and place.",
        ],
      },
      {
        id: "calling",
        title: "Calling players",
        blocks: [
          { steps: [
            "Open [[Call players]]. Today is picked for you; tap another day to switch. Tap the age group on the field.",
            "**Next up** shows the next bibs to call: players who are checked in and not called yet, in bib order. Read them out.",
            "As each player comes up, tap their row. A green tick and **Called** with the time appear, and the scorers see **Called** and **Now up** on their phones.",
            "Tapped the wrong bib? Tap it again. The message says **Undone**.",
          ] },
          { list: [
            "Players who haven't checked in are greyed out with **Not here**. Tick [[Hide players not here]] to hide them. Late arrivals turn normal as soon as check-in taps them in (the list refreshes every 20 seconds).",
            "Find a bib or name with the search box when a child comes up out of order.",
            "**Exempt** players may be excused from being evaluated; they're not suggested in **Next up**. Call them if they take part.",
            "**No bib: ask check-in** means the child has no bib yet; the registrar can give one at the check-in table.",
          ] },
        ],
      },
      {
        id: "makeups",
        title: "Makeup days",
        blocks: [
          "On a makeup day the list shows only players still to be seen: those never called and never scored, including children who came but were missed. Call them the same way.",
        ],
      },
    ],
  },
];

export const guideFor = (key: string) => GUIDES.find((g) => g.key === key);
