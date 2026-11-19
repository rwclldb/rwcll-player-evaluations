// Admin roadmap: turns admin_season_roadmap() output into stages and steps with a live status.
// Pure functions (no React, no Supabase) so the rules can be tested on their own.

export type StageKey = "before" | "week" | "day" | "after" | "draft" | "end";
export type StepStatus = "done" | "attention" | "todo" | "info" | "later";
export type StepLink = { href: string; label: string; primary?: boolean };
export type Step = { key: string; title: string; detail: string; status: StepStatus; links: StepLink[] };
export type Stage = { key: StageKey; title: string; short: string; blurb: string };

export type RoadmapSession = {
  id: number;
  league_age: number;
  status: "setup" | "open" | "locked";
  released: boolean;
  players: number;
  no_bib: number;
  coaches: number;
  evaluators: number;
  submitted: number;
  drafts: number;
  players_scored_by_evaluator: number;
  players_scored_by_coach: number;
  players_touched: number;
  primary_date: string | null;
  primary_start: string | null;
  makeups: number;
  last_event_date: string | null;
};

export type RoadmapData = {
  season: { id: number; name: string; is_closed: boolean };
  /** Possible-duplicate player pairs waiting for a decision (all seasons); filled in by the page. */
  duplicates?: number;
  /** Teams and family links for the Teams and draft stage; filled in by the page (teamsSummary). */
  teams?: TeamsSummary;
  stage: StageKey;
  today: string;
  first_primary_date: string | null;
  last_event_date: string | null;
  registrations: { total: number; no_bib: number; no_age: number; on_site: number };
  imports: { registration_batches: number; registration_rows_to_review: number; bib_rows_held: number };
  prior_year: { players_with_prior: number; rows_pending: number; shown_while_scoring: boolean };
  people: { coaches: number; evaluators: number; not_signed_in: number; unassigned: number };
  sessions: RoadmapSession[];
};

export type TeamsSummary = {
  /** Per division: how many teams, and how many lack a manager or a coach. */
  divisions: { name: string; teams: number; incomplete: number }[];
  coachKids: number;
  coachKidsUnlinked: number;
  siblingGroups: number;
  suggestions: number;
  /** Per division: is there a draft, and is its first-round order set (drafts_overview). */
  drafts?: { name: string; draft: boolean; orderSet: boolean; status: string | null }[];
};

type SetupJson = { divisions: { name: string; teams: { staff: { role: string }[] }[] }[] };
type FamilyJson = { coach_kids: { parents: unknown[] }[]; sibling_groups: unknown[]; suggestions: unknown[] };
type DraftsJson = { name: string; draft: { status: string; order_set: boolean } | null }[];
/** Roadmap numbers from team_setup() and family_overview(). */
export function teamsSummary(setup: SetupJson | null, families: FamilyJson | null, drafts: DraftsJson | null = null): TeamsSummary {
  return {
    divisions: (setup?.divisions ?? []).map((d) => ({
      name: d.name, teams: d.teams.length,
      incomplete: d.teams.filter((t) => !t.staff.some((x) => x.role === "manager") || !t.staff.some((x) => x.role === "coach")).length,
    })),
    coachKids: families?.coach_kids.length ?? 0,
    coachKidsUnlinked: families?.coach_kids.filter((k) => k.parents.length === 0).length ?? 0,
    siblingGroups: families?.sibling_groups.length ?? 0,
    suggestions: families?.suggestions.length ?? 0,
    drafts: (drafts ?? []).map((x) => ({ name: x.name, draft: !!x.draft, orderSet: !!x.draft?.order_set, status: x.draft?.status ?? null })),
  };
}

/** The database suggests End of season once every age group is released; until the season is closed, that's Teams and draft. */
export function suggestedStage(d: Pick<RoadmapData, "stage" | "season">): StageKey {
  return d.stage === "end" && !d.season.is_closed ? "draft" : d.stage;
}

export const STAGES: Stage[] = [
  { key: "before", title: "Before evaluations", short: "Before", blurb: "Get players, bibs, people and the schedule in place. Most of this happens weeks ahead." },
  { key: "week", title: "Evaluation week", short: "Eval week", blurb: "Final checks in the days before. Open scoring, print rosters, make sure everyone can sign in." },
  { key: "day", title: "Evaluation day", short: "Eval day", blurb: "Keep an eye on scoring, add walk-ups, and help anyone who's stuck." },
  { key: "after", title: "After evaluations", short: "After", blurb: "Tidy up, lock each age group, check the numbers, then release draft reports to coaches." },
  { key: "draft", title: "Teams and draft", short: "Draft", blurb: "Set up teams with a manager and coach, link coach's kids and siblings, then run the Juniors, Majors and AAA drafts and make the AA teams." },
  { key: "end", title: "End of season", short: "End", blurb: "Coaches re-rate their own players for next year, then the season is closed." },
];

export const stageIndex = (k: StageKey) => STAGES.findIndex((s) => s.key === k);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ages = (list: RoadmapSession[]) => {
  const a = list.map((s) => s.league_age);
  return a.length <= 4 ? `Age${a.length === 1 ? "" : "s"} ${a.join(", ")}` : `${a.length} age groups`;
};

export function formatDate(iso: string | null, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

export function formatTime(t: string | null) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function daysBetween(fromIso: string, toIso: string) {
  const f = Date.parse(`${fromIso}T00:00:00Z`);
  const t = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((t - f) / 86_400_000);
}

/** Problems that would stop an age group running well on the day. */
export function readinessProblems(s: RoadmapSession): string[] {
  const p: string[] = [];
  if (s.players === 0) p.push("no players");
  if (s.no_bib > 0) p.push(`${plural(s.no_bib, "player")} without a bib`);
  if (s.evaluators === 0) p.push("no independent evaluator");
  if (!s.primary_date) p.push("no evaluation day scheduled");
  return p;
}

export function buildSteps(d: RoadmapData, stage: StageKey): Step[] {
  const S = d.sessions;
  const reg = d.registrations;
  const sid = d.season.id;
  const ppl = d.people;

  switch (stage) {
    case "before": {
      const noEvaluator = S.filter((s) => s.evaluators === 0);
      const unscheduled = S.filter((s) => !s.primary_date);
      const bibIssues = reg.no_bib + reg.no_age + d.imports.bib_rows_held;
      return [
        {
          key: "age-groups", title: "Create the age groups",
          status: S.length > 0 ? "done" : "todo",
          detail: S.length > 0 ? `${plural(S.length, "age group")} (ages ${S[0].league_age}–${S[S.length - 1].league_age})` : "One age group per league age, 7 to 16.",
          links: [{ href: "/protected/sessions", label: S.length > 0 ? "Sessions" : "Create age groups", primary: S.length === 0 }],
        },
        {
          key: "registrations", title: "Import registrations",
          status: d.imports.registration_batches === 0 && reg.total === 0 ? "todo" : d.imports.registration_rows_to_review > 0 ? "attention" : "done",
          detail: d.imports.registration_rows_to_review > 0
            ? `${plural(d.imports.registration_rows_to_review, "row")} waiting for your review · ${plural(reg.total, "player")} registered`
            : reg.total > 0 ? `${plural(reg.total, "player")} registered` : "Upload the Sports Connect registration export.",
          links: [
            { href: "/protected/import-preview", label: "Upload CSV", primary: reg.total === 0 },
            { href: "/protected/import-batches", label: "Review imports", primary: d.imports.registration_rows_to_review > 0 },
          ],
        },
        {
          key: "bibs", title: "Give every player a bib",
          status: reg.total === 0 ? "todo" : bibIssues > 0 ? "attention" : "done",
          detail: reg.total === 0 ? "Bibs come from your upload or the Players page."
            : bibIssues === 0 ? "Every player has an age and a bib."
            : [reg.no_bib && `${plural(reg.no_bib, "player")} without a bib`, reg.no_age && `${plural(reg.no_age, "player")} without an age`,
               d.imports.bib_rows_held && `${plural(d.imports.bib_rows_held, "uploaded bib")} on hold`].filter(Boolean).join(" · "),
          links: [
            { href: "/protected/players/bibs", label: "Upload bibs", primary: reg.no_bib > 0 },
            ...(reg.no_bib > 0 ? [{ href: `/protected/players?season=${sid}&show=nobib`, label: "Show who's missing" }] : []),
            ...(reg.no_age > 0 ? [{ href: `/protected/players?season=${sid}&show=noage`, label: "Show missing ages" }] : []),
          ],
        },
        {
          key: "duplicates", title: "Check for duplicate players",
          status: (d.duplicates ?? 0) > 0 ? "attention" : reg.total > 0 ? "done" : "todo",
          detail: (d.duplicates ?? 0) > 0
            ? `${plural(d.duplicates ?? 0, "pair")} of player records may be the same child. Merge them or mark them as different children.`
            : "Same name and birthdate, or the same Player Id, on two records. None right now.",
          links: [{ href: "/protected/players/duplicates", label: "Possible duplicates", primary: (d.duplicates ?? 0) > 0 }],
        },
        {
          key: "prior-year", title: "Upload last season's coach ratings",
          status: d.prior_year.rows_pending > 0 ? "attention" : d.prior_year.players_with_prior > 0 ? "done" : "todo",
          detail: d.prior_year.rows_pending > 0
            ? `${plural(d.prior_year.rows_pending, "row")} waiting for review · ${plural(d.prior_year.players_with_prior, "player")} have ratings`
            : d.prior_year.players_with_prior > 0 ? `${plural(d.prior_year.players_with_prior, "player")} have prior-year ratings`
            : "Optional. Upload the end-of-season ratings from last year's coaches.",
          links: [{ href: "/protected/prior-year", label: d.prior_year.rows_pending > 0 ? "Review rows" : "Prior-year upload", primary: d.prior_year.rows_pending > 0 }],
        },
        {
          key: "people", title: "Invite coaches and evaluators",
          status: ppl.coaches + ppl.evaluators === 0 ? "todo" : ppl.not_signed_in > 0 ? "attention" : "done",
          detail: ppl.coaches + ppl.evaluators === 0 ? "Invite by email, one at a time or from a list."
            : `${plural(ppl.coaches, "coach", "coaches")} · ${plural(ppl.evaluators, "evaluator")}${ppl.not_signed_in > 0 ? ` · ${ppl.not_signed_in} haven't signed in yet` : " · everyone has signed in"}`,
          links: [{ href: "/protected/people", label: "People", primary: ppl.coaches + ppl.evaluators === 0 }],
        },
        {
          key: "assignments", title: "Assign age groups",
          status: S.length === 0 || ppl.coaches + ppl.evaluators === 0 ? "todo" : noEvaluator.length > 0 || ppl.unassigned > 0 ? "attention" : "done",
          detail: [noEvaluator.length > 0 && `${ages(noEvaluator)} ${noEvaluator.length === 1 ? "has" : "have"} no evaluator`,
                   ppl.unassigned > 0 && `${plural(ppl.unassigned, "person", "people")} not assigned anywhere`].filter(Boolean).join(" · ")
                  || (S.length > 0 ? "Every age group has an evaluator." : "Needs age groups and people first."),
          links: [
            { href: "/protected/assignments", label: "By age group", primary: noEvaluator.length > 0 },
            { href: "/protected/assignments?view=person", label: "By person", primary: noEvaluator.length === 0 && ppl.unassigned > 0 },
            { href: "/protected/assignments?view=divisions", label: "From coaches' divisions" },
          ],
        },
        {
          key: "schedule", title: "Schedule evaluation days",
          status: S.length === 0 ? "todo" : unscheduled.length > 0 ? (unscheduled.length === S.length ? "todo" : "attention") : "done",
          detail: S.length === 0 ? "Needs age groups first."
            : unscheduled.length > 0 ? `${ages(unscheduled)} ${unscheduled.length === 1 ? "has" : "have"} no evaluation day`
            : `Evaluations ${formatDate(d.first_primary_date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}${S.some((s) => s.makeups > 0) ? " · makeups scheduled" : ""}`,
          links: [{ href: "/protected/sessions", label: "Sessions", primary: unscheduled.length > 0 }],
        },
        {
          key: "prior-switch", title: "Board decision: prior-year ratings while scoring",
          status: "info",
          detail: `Currently ${d.prior_year.shown_while_scoring ? "shown" : "hidden"} on the scoring screen. Draft reports always include them.`,
          links: [{ href: "/protected/sessions", label: "Change setting" }],
        },
      ];
    }

    case "week": {
      const notReady = S.map((s) => ({ s, p: readinessProblems(s) })).filter((x) => x.p.length > 0);
      const inSetup = S.filter((s) => s.status === "setup");
      return [
        {
          key: "readiness", title: "Readiness check",
          status: S.length === 0 ? "todo" : notReady.length > 0 ? "attention" : "done",
          detail: S.length === 0 ? "No age groups yet."
            : notReady.length === 0 ? "Every age group has players, bibs, an evaluator and a scheduled day."
            : notReady.slice(0, 3).map((x) => `Age ${x.s.league_age}: ${x.p.join(", ")}`).join(" · ") + (notReady.length > 3 ? ` · +${notReady.length - 3} more` : ""),
          links: [
            ...(reg.no_bib > 0 ? [{ href: `/protected/players?season=${sid}&show=nobib`, label: "Players without bibs", primary: true }] : []),
            ...(S.some((s) => s.evaluators === 0) ? [{ href: "/protected/assignments", label: "Assignments", primary: true }] : []),
            ...(S.some((s) => !s.primary_date) ? [{ href: "/protected/sessions", label: "Schedule", primary: true }] : []),
            ...(notReady.length === 0 ? [{ href: "/protected/sessions", label: "Sessions" }] : []),
          ],
        },
        {
          key: "open", title: "Open scoring",
          status: S.length === 0 ? "todo" : inSetup.length > 0 ? "todo" : "done",
          detail: inSetup.length > 0 ? `${ages(inSetup)} ${inSetup.length === 1 ? "is" : "are"} still in Setup. Coaches and evaluators can score once an age group is open.`
            : S.length > 0 ? `All ${S.length} age groups are open for scoring.` : "",
          links: [{ href: "/protected/sessions", label: "Open age groups", primary: inSetup.length > 0 }],
        },
        {
          key: "signin", title: "Make sure everyone can sign in",
          status: ppl.not_signed_in > 0 ? "attention" : ppl.coaches + ppl.evaluators > 0 ? "done" : "todo",
          detail: ppl.not_signed_in > 0 ? `${plural(ppl.not_signed_in, "person", "people")} haven't signed in yet. Send them a sign-in link.` : "Everyone with a role has signed in at least once.",
          links: [{ href: "/protected/people", label: "People", primary: ppl.not_signed_in > 0 }],
        },
        {
          key: "rosters", title: "Print check-in rosters",
          status: "info",
          detail: "One page per age group, sorted by bib or name, with Check-in and Notes columns.",
          links: [{ href: "/protected/roster?age=all", label: "All ages" }, { href: "/protected/roster?age=all&sort=name", label: "By name" }, { href: "/protected/timetable", label: "Who scores when" }, { href: "/protected/qr", label: "QR codes" }],
        },
        {
          key: "prior-switch", title: "Board decision: prior-year ratings while scoring",
          status: "info",
          detail: `Currently ${d.prior_year.shown_while_scoring ? "shown" : "hidden"} on the scoring screen.`,
          links: [{ href: "/protected/sessions", label: "Change setting" }],
        },
      ];
    }

    case "day": {
      const players = S.reduce((n, s) => n + s.players, 0);
      const scored = S.reduce((n, s) => n + s.players_scored_by_evaluator, 0);
      return [
        {
          key: "progress", title: "Watch scoring progress",
          status: "info",
          detail: `${scored} of ${players} players have an independent evaluator score. Scoring Progress shows each coach and evaluator, with who hasn't saved lately.`,
          links: [{ href: "/protected/progress", label: "Scoring Progress", primary: true }, { href: "/protected/evaluation-review", label: "Data Review" }],
        },
        {
          key: "checkin", title: "Check players in",
          status: "info",
          detail: "Registrars (or you) tap each player as they arrive, add missing bibs, and coaches see who's here. Give someone the Registrar role on People.",
          links: [{ href: "/protected/check-in", label: "Check-in", primary: true }, { href: "/protected/timetable", label: "Who scores when" }],
        },
        {
          key: "call", title: "Call players up",
          status: "info",
          detail: "The announcer reads out bibs and taps each player as they're called; scorers see \"Now up\" and \"Called\" on their phones. Give someone the Announcer role on People.",
          links: [{ href: "/protected/announce", label: "Call players" }, { href: "/protected/end-of-day", label: "End-of-day check" }],
        },
        {
          key: "walkups", title: "Add a walk-up player",
          status: "info",
          detail: `Not registered yet? Add them on site with a bib. ${reg.on_site > 0 ? `${plural(reg.on_site, "player")} added on site so far.` : ""}`,
          links: [{ href: "/protected/players/new", label: "Add player on site", primary: true }, { href: `/protected/players?season=${sid}&show=onsite`, label: "Added on site" }],
        },
        {
          key: "help", title: "Help someone sign in",
          status: ppl.not_signed_in > 0 ? "attention" : "info",
          detail: ppl.not_signed_in > 0 ? `${plural(ppl.not_signed_in, "person", "people")} still haven't signed in. "Sign-in link" makes a one-time link you can text.` : "Make a one-time sign-in link from the People page.",
          links: [{ href: "/protected/people", label: "People" }],
        },
        {
          key: "find", title: "Find a player",
          status: "info",
          detail: "Look up a name, bib or age group, or fix a birthdate.",
          links: [{ href: `/protected/players?season=${sid}`, label: "Players" }, { href: "/protected/roster?age=all", label: "Rosters" }],
        },
      ];
    }

    case "after": {
      const drafts = S.reduce((n, s) => n + s.drafts, 0);
      const stillOpen = S.filter((s) => s.status !== "locked");
      const unreleased = S.filter((s) => !s.released);
      return [
        {
          key: "drafts", title: "Clear up unfinished ratings",
          status: drafts > 0 ? "attention" : "done",
          detail: drafts > 0 ? `${plural(drafts, "draft")} won't count in reports until submitted.` : "No drafts left. Only submitted ratings count.",
          links: [{ href: "/protected/evaluation-review", label: "Data Review", primary: drafts > 0 }],
        },
        {
          key: "missed", title: "Check nobody was missed",
          status: "info",
          detail: "Players checked in but never called, called but missing a score, or never checked in. Never-called players go on the makeup day's lists.",
          links: [{ href: "/protected/end-of-day", label: "End-of-day check" }],
        },
        {
          key: "backup", title: "Download a season backup",
          status: "info",
          detail: "A zip of spreadsheets with every score and the draft report averages, in case the app is down on draft night. Keep it somewhere private.",
          links: [{ href: `/protected/seasons/${d.season.id}#backup`, label: "Season backup" }],
        },
        {
          key: "lock", title: "Lock each age group",
          status: S.length > 0 && stillOpen.length === 0 ? "done" : "todo",
          detail: stillOpen.length > 0 ? `${ages(stillOpen)} ${stillOpen.length === 1 ? "is" : "are"} not locked. Locking stops all edits; you can unlock if needed.` : "All age groups are locked.",
          links: [{ href: "/protected/sessions", label: "Lock age groups", primary: stillOpen.length > 0 }],
        },
        {
          key: "check", title: "Check the draft reports",
          status: "info",
          detail: "You see every age group now. Coaches and evaluators see one only after you release it.",
          links: [{ href: "/protected/draft-reports", label: "Draft reports", primary: true }],
        },
        {
          key: "release", title: "Release reports to coaches",
          status: S.length > 0 && unreleased.length === 0 ? "done" : "todo",
          detail: unreleased.length > 0 ? `${ages(unreleased)} not released yet.` : "Every age group is released.",
          links: [{ href: "/protected/sessions", label: "Release age groups", primary: unreleased.length > 0 && stillOpen.length === 0 }],
        },
        {
          key: "export", title: "Export or print for the draft",
          status: "info",
          detail: "CSV download and a print view for each age group.",
          links: [{ href: "/protected/draft-reports", label: "Draft reports" }, { href: "/protected/reports", label: "Season export" }],
        },
      ];
    }

    case "draft": {
      const t = d.teams ?? { divisions: [], coachKids: 0, coachKidsUnlinked: 0, siblingGroups: 0, suggestions: 0 };
      const drafted = t.divisions.filter((x) => ["Juniors", "Majors", "AAA", "AA"].includes(x.name));
      const noTeams = drafted.filter((x) => x.teams === 0).map((x) => x.name);
      const incomplete = t.divisions.reduce((n, x) => n + x.incomplete, 0);
      const total = t.divisions.reduce((n, x) => n + x.teams, 0);
      const teamsPage = `/protected/teams?season=${sid}`;
      const families = `/protected/teams/families?season=${sid}`;
      return [
        {
          key: "teams", title: "Set up teams, managers and coaches",
          status: total > 0 && noTeams.length === 0 && incomplete === 0 ? "done" : incomplete > 0 ? "attention" : "todo",
          detail: total === 0 ? "No teams yet. Add them by hand, or upload a spreadsheet (the Sports Connect volunteer report works)."
            : [noTeams.length ? `No teams yet in ${noTeams.join(", ")}.` : "", incomplete ? `${plural(incomplete, "team")} without a manager or coach.` : "",
               !noTeams.length && !incomplete ? `${plural(total, "team")}: ${t.divisions.filter((x) => x.teams).map((x) => `${x.name} ${x.teams}`).join(", ")}.` : ""].filter(Boolean).join(" "),
          links: [{ href: teamsPage, label: "Teams", primary: true }],
        },
        {
          key: "kids", title: "Link coach's kids to their parent",
          status: t.coachKidsUnlinked > 0 ? "attention" : t.coachKids > 0 ? "done" : "todo",
          detail: t.coachKidsUnlinked > 0 ? `${plural(t.coachKidsUnlinked, "coach's kid")} with no parent linked. The draft places a kid on the parent's team only when they're linked.`
            : t.coachKids > 0 ? `${plural(t.coachKids, "coach's kid")}, all linked.` : "None yet. Kids registered with a coach's sign-in email are suggested.",
          links: [{ href: families, label: "Coach's kids", primary: t.coachKidsUnlinked > 0 }],
        },
        {
          key: "siblings", title: "Confirm siblings and suggestions",
          status: t.suggestions > 0 ? "attention" : t.siblingGroups > 0 ? "done" : "todo",
          detail: t.suggestions > 0 ? `${plural(t.suggestions, "suggestion")} from the registration file waiting (same family account, or a coach's email).`
            : `${plural(t.siblingGroups, "sibling group")}. Siblings in the same division go to the same team.`,
          links: [{ href: families, label: "Siblings", primary: t.suggestions > 0 }],
        },
        { key: "release-first", title: "Release the draft reports", status: "info", detail: "A draft can't start until its age groups are released to coaches (After evaluations).", links: [{ href: "/protected/sessions", label: "Sessions" }] },
        (() => {
          const want = ["Juniors", "Majors", "AAA"].filter((n) => (t.drafts ?? []).some((x) => x.name === n));
          const missing = want.filter((n) => !(t.drafts ?? []).some((x) => x.name === n && x.draft));
          const noOrder = want.filter((n) => (t.drafts ?? []).some((x) => x.name === n && x.draft && !x.orderSet));
          return {
            key: "setup-drafts", title: "Set up each draft",
            status: (want.length > 0 && missing.length === 0 && noOrder.length === 0 ? "done" : "todo") as StepStatus,
            detail: missing.length ? `Not set up yet: ${missing.join(", ")}. Each draft has its pool, roster size, first-round order and rules (copied from last year).`
              : noOrder.length ? `First-round order not set: ${noOrder.join(", ")}.` : "Juniors, Majors and AAA are set up with their order.",
            links: [{ href: "/protected/drafts", label: "Drafts", primary: missing.length + noOrder.length > 0 }],
          };
        })(),
        { key: "run-drafts", title: "Run the Juniors, Majors and AAA drafts", status: "later", detail: "Coming next: the draft room. Admins and registrars pick; the division's managers and coaches watch live.", links: [] },
        { key: "aa-teams", title: "Make the AA teams", status: "later", detail: "Coming next: balanced teams from the ratings, with coach's kids and siblings kept together.", links: [] },
        { key: "team-rosters", title: "Release rosters and export", status: "later", detail: "Coming next: every team's roster, moves with notes, and a CSV for Sports Connect.", links: [] },
      ];
    }

    case "end":
      return [
        { key: "rerate", title: "Coaches re-rate their own players", status: "later", detail: "Coming later. For now, collect ratings in a spreadsheet and use the Prior-year upload next season.", links: [{ href: "/protected/prior-year", label: "Prior-year upload" }] },
        { key: "final-backup", title: "Download a final backup", status: "info", detail: "Before closing, keep a copy of the season's scores, reports and people as spreadsheets.", links: [{ href: `/protected/seasons/${d.season.id}#backup`, label: "Season backup" }] },
        { key: "close", title: "Close the season", status: d.season.is_closed ? "done" : "todo", detail: d.season.is_closed ? "Closed. Nothing in it can change unless an admin reopens it (audited)." : "Freezes scores, imports, bibs and player edits. Needs a reason and the season's name typed; reopening is audited too.", links: [{ href: `/protected/seasons/${d.season.id}`, label: d.season.is_closed ? "Season page" : "Close the season" }] },
        { key: "next", title: "Set up next season", status: "info", detail: "Division setup carries forward. Teams, roles and evaluations don't.", links: [{ href: "#seasons", label: "Create a season" }] },
      ];
  }
}

export function stepProgress(steps: Step[]) {
  const counted = steps.filter((s) => s.status === "done" || s.status === "todo" || s.status === "attention");
  return { done: counted.filter((s) => s.status === "done").length, total: counted.length };
}

/** League calendar date (Pacific), as YYYY-MM-DD. */
export function leagueToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
