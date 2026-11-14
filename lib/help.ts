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
export type GuideKey = "coach" | "evaluator" | "registrar";

const signingIn: HelpSection = {
  id: "signing-in",
  title: "Signing in",
  blocks: [
    "Accounts are set up by the league. You'll get either an invitation email or a sign-in link from a league admin.",
    { steps: [
      "Open the link and choose a password (at least 8 characters).",
      "After that, sign in with your email and password. On a phone, add the site to your home screen so it's one tap away.",
      "Forgot your password? Use [[Forgot password?]] on the sign-in page, or ask a league admin for a new sign-in link.",
    ] },
    "To change your name or password, tap the person icon at the top (on a phone: the menu, then [[Your account]]). Your sign-in email can only be changed by a league admin.",
  ],
};

const scoring = (who: "coach" | "evaluator"): HelpSection => ({
  id: "scoring",
  title: "Scoring players",
  blocks: [
    who === "coach"
      ? "Open [[Evaluations]] and pick an age group. It shows the age groups the league has set up for you; ask a league admin if one is missing. Scoring opens when an admin opens the age group, usually on evaluation day."
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
      "**CK**: a coach's kid. Score them like everyone else; the league decides how coach's kids are drafted.",
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
      "Tap the star next to a name to add the player to your private shortlist, then use [[My stars]] to show only them. Nobody else sees your stars.",
      "[[CSV]] downloads the report for a spreadsheet; [[Print]] prints it.",
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
          "**Evaluation Day** shows the next evaluation day and, on the day, how many players are checked in. From there: [[Check players in]], [[Add a walk-up]], [[Print rosters]], [[Who scores when]], [[Players]] and [[Registration imports]].",
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
            "On makeup days, the list shows only players who weren't checked in earlier and haven't been scored.",
            "No bib yet? Tap [[+ Bib]], type the number and tap [[Save]]. A bib already in use is refused with the name of who has it.",
            "Several people can check in at once; the list refreshes every 30 seconds.",
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
          "Once anyone has scored the player, the age group can't change. Every change is recorded and shown at the bottom of the page.",
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
          ] },
        ],
      },
    ],
  },
];

export const guideFor = (key: string) => GUIDES.find((g) => g.key === key);
