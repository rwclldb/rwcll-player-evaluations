// Column lists for every CSV upload, shown on the upload page with a "Download blank CSV" button.
// The header names here are ones the parsers accept (see COLUMN_ALIASES in lib/csv-upload.ts).

export type TemplateColumn = {
  name: string;
  /** "required", "optional", or a short rule such as "or name + birthdate". */
  need: "required" | "optional" | string;
  note?: string;
};
export type CsvTemplate = { file: string; columns: TemplateColumn[]; tip?: string };

import { REQUIRED_HEADERS } from "@/lib/sports-connect-preview";

export const SPORTS_CONNECT_TEMPLATE: CsvTemplate = {
  file: "sports-connect-registrations-template.csv",
  columns: REQUIRED_HEADERS.map((name) => ({
    name,
    need: name === "Registration Number" ? "optional" : "required",
    note: name === "Registration Number" ? "may be blank" : undefined,
  })),
  tip: "Export the Enrollment Details report from Sports Connect; it already has these columns. Extra columns are ignored.",
};

export const BIB_TEMPLATE: CsvTemplate = {
  file: "bib-numbers-template.csv",
  columns: [
    { name: "Player Id", need: "or name + birthdate", note: "Sports Connect Player Id" },
    { name: "Player First Name", need: "or Player Id" },
    { name: "Player Last Name", need: "or Player Id" },
    { name: "Player Birth Date", need: "or Player Id", note: "MM/DD/YYYY" },
    { name: "Evaluation Number", need: "required", note: "also accepted: Bib, Registration Number" },
  ],
  tip: "Match each row by Player Id, or by first name + last name + birthdate.",
};

export const PEOPLE_TEMPLATE: CsvTemplate = {
  file: "coaches-and-evaluators-template.csv",
  columns: [
    { name: "Volunteer First Name", need: "optional" },
    { name: "Volunteer Last Name", need: "optional" },
    { name: "Email", need: "required" },
    { name: "Volunteer Role", need: "optional", note: "Head Coach, Assistant Coach, Manager, Evaluator" },
    { name: "Division Name", need: "optional", note: "AA, AAA, Majors, Juniors, Seniors; one row per team" },
  ],
  tip: "The Sports Connect volunteer report works as is. A coach with two teams can be on two rows.",
};

export const PRIOR_YEAR_TEMPLATE: CsvTemplate = {
  file: "prior-year-coach-ratings-template.csv",
  // Same names as the Sports Connect enrollment export with the coaches' DR (draft rating) columns.
  columns: [
    { name: "Division Name", need: "optional", note: "\"AA Ball - Little League Baseball\" is fine" },
    { name: "Player Id", need: "optional", note: "Sports Connect Player Id; best match" },
    { name: "Player First Name", need: "required" },
    { name: "Player Last Name", need: "required" },
    { name: "Player Birth Date", need: "optional", note: "MM/DD/YYYY" },
    { name: "Team Name", need: "optional", note: "\"AA 01 - De Leon\": coach taken from after the dash" },
    { name: "DR Hitting", need: "rating", note: "1-5, blank if not rated" },
    { name: "DR Throwing", need: "rating" },
    { name: "DR Grounders", need: "rating" },
    { name: "DR Fly Balls", need: "rating" },
    { name: "DR Running-Awareness", need: "rating" },
    { name: "DR Pitching Mechanics", need: "rating", note: "optional skill" },
    { name: "DR Pitching Accuracy/Control", need: "rating", note: "optional skill" },
    { name: "DR Pitching Arm Strength", need: "rating", note: "optional skill" },
    { name: "DR Catching/Receiving", need: "rating", note: "optional skill" },
    { name: "DR Catching/Blocking", need: "rating", note: "optional skill" },
    { name: "Season", need: "optional", note: "or type it on the page" },
    { name: "Coach Name", need: "optional", note: "overrides the name from Team Name" },
  ],
  tip: "The Sports Connect enrollment export with DR columns works as is. Players with no ratings are skipped; totals, averages (DR Total, Easy Rating), emails and order numbers are ignored and never stored.",
};

