// Compares a row of the coach/volunteer file with the account that already has that email.
// Used by the People page's "Invite from a list" preview, so uploading the latest file again is safe.

export type SeasonRole = "coach" | "independent_evaluator";

/** An account as the People page knows it, for the season being imported. */
export type ExistingPerson = {
  email: string;
  name: string;
  /** This season's coach or evaluator role, if any (an account never holds both). */
  role: SeasonRole | null;
  /** This season's coach divisions (canonical names). */
  divisions: string[];
};

export type RowStatus = "new" | "add_role" | "role_conflict" | "changes" | "up_to_date";

export type RowPlan = {
  status: RowStatus;
  /** Divisions in the file that the coach doesn't have yet (added when the row is included). */
  addDivisions: string[];
  /** Divisions the coach has that the file doesn't list (removed only when ticked). */
  removeDivisions: string[];
  /** The file's name differs from a name the app already has (replaced only when ticked). */
  nameDiffers: boolean;
  currentName: string;
};

const norm = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * @param fileDivisions division names from the file (any case; unknown names are ignored)
 * @param known this season's division names
 * @param fileHasDivisions whether the file has a division column at all (no column means no removals are suggested)
 */
export function planPersonRow(
  row: { name: string; role: SeasonRole; fileDivisions: string[] },
  existing: ExistingPerson | undefined,
  known: string[],
  fileHasDivisions: boolean,
): RowPlan {
  const canonical = new Map(known.map((d) => [d.toLowerCase(), d]));
  const fileKnown = [...new Set(row.fileDivisions.map((d) => canonical.get(d.trim().toLowerCase())).filter((d): d is string => Boolean(d)))];
  const plan: RowPlan = { status: "new", addDivisions: [], removeDivisions: [], nameDiffers: false, currentName: existing?.name ?? "" };

  if (!existing) {
    plan.addDivisions = row.role === "coach" ? fileKnown : [];
    return plan;
  }
  plan.nameDiffers = Boolean(row.name.trim()) && Boolean(existing.name.trim()) && norm(row.name) !== norm(existing.name);

  if (existing.role && existing.role !== row.role) {
    return { ...plan, status: "role_conflict" };
  }
  if (row.role === "coach") {
    const have = new Set(existing.role === "coach" ? existing.divisions : []);
    plan.addDivisions = fileKnown.filter((d) => !have.has(d));
    plan.removeDivisions = fileHasDivisions && existing.role === "coach"
      ? existing.divisions.filter((d) => !fileKnown.includes(d))
      : [];
  }
  if (!existing.role) plan.status = "add_role";
  else if (plan.addDivisions.length || plan.removeDivisions.length || plan.nameDiffers) plan.status = "changes";
  else plan.status = "up_to_date";
  return plan;
}

/** People with a coach or evaluator role this season whose email isn't in the file. */
export function missingFromFile(existing: ExistingPerson[], fileEmails: Iterable<string>): ExistingPerson[] {
  const inFile = new Set([...fileEmails].map((e) => e.trim().toLowerCase()));
  return existing.filter((p) => p.role && !inFile.has(p.email.toLowerCase()))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}
