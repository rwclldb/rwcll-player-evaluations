# RWCLL Player Evaluations — Sports Connect Import Workflow

**Status:** Proposed specification; no import code or database migration is implemented by this document.

## Purpose
Import every Sports Connect registration for a selected existing season, validate it, suggest possible returning-player matches, and require an administrator to confirm the preview before saving. The app records registration/payment status but does not process payments.

## Source fixture inspected
`Enrollment_Details - 2027 Fake Data RWCLL(2).csv` (fake/anonymized test data), with 323 rows and 14 columns. Exact important headers include `Program Name`, `Division Name`, `Player Id`, `Registration Number`, `Player First Name`, `Player Last Name`, `Player Birth Date`, and `Order Payment Status`. `Registration Number` is blank in every sample row. `2027 - little_league_age_chart.csv` contains age 4–16 lookup data.

## Step-by-step import UX
1. Administrator opens Imports and selects an existing season (for example, Spring 2027, 2027-01-01 through 2027-06-30). The importer never creates a season automatically.
2. Administrator uploads a CSV. Display filename, byte/row count, and recognized header mapping. If required columns are not recognized, ask the admin to map them before continuing.
3. Parse rows into a staging preview without writing player/registration records. Keep row number and raw source values for review. Escape spreadsheet formula-like cells when exporting reports; never execute CSV content.
4. Validate required values and normalize only for comparison. Preserve raw source values for audit. Validate player ID, player names, birthdate, payment status, program/division, optional registration number, and row shape.
5. Detect duplicates within the uploaded file and against existing registrations for the selected season. Duplicate nonblank Player IDs are blocking conflicts. Show all row numbers and conflicting values; do not auto-merge or let a duplicate external ID map to two player-season registrations.
6. Calculate 2027 Little League baseball age from the supplied official chart/rule (age as of August 31, 2027). Store the result on the season registration after commit. Unknown/out-of-chart birthdates require admin review rather than guessed ages.
7. Generate possible returning-player candidates using external ID, normalized name, and birthdate. A candidate is only a suggestion. The administrator explicitly chooses an existing permanent player, creates a new player, or leaves the row pending review. Never silently merge.
8. Map `Completed` and `Pending` to season registration status. Unknown/blank statuses require admin review. Pending is not an evaluation exclusion and must not appear on evaluation screens.
9. Classify source programs/divisions. Active evaluation divisions default to AA, AAA, Majors, Juniors, Seniors. Import A, Tee Ball, Wiffle Ball and unknown/out-of-scope programs but mark them for review and keep them out of the active evaluation pool until an admin resolves the flag.
10. If `Registration Number` is present, validate format and uniqueness in the season. If blank, keep it null; never auto-generate it during import. Evaluation remains possible without a number.
11. Preview summary: rows read; new players to create; existing-player matches explicitly confirmed; registrations to create/update; completed/pending counts; out-of-scope program counts; missing numbers; invalid rows; duplicate-ID conflicts; ambiguous matches; and all rows needing admin review.
12. Require explicit confirmation and commit the approved rows transactionally. Recommended initial safety behavior: unresolved duplicate-ID conflicts block commit of the batch; other clearly independent rows may only be committed if the UI clearly reports partial-commit semantics and the audit log records the decision. Never imply a failed batch was imported.
13. Show a final result summary and downloadable row-level error report. Reimporting the same file must not create duplicate season registrations; status changes update the existing season registration according to a reviewed update policy.

## Column mapping for supplied sample

| CSV column | Proposed handling |
|---|---|
| `Player Id` | Required season-scoped external ID; duplicate conflict within the selected season/file blocks unsafe commit. Not the internal player ID. |
| `Player First Name`, `Player Last Name` | Required for player display and candidate matching. |
| `Player Birth Date` | Required for age calculation; parse supported explicit formats and reject ambiguous/invalid dates. |
| `Division Name` | Preserve as source program/division label; classify active vs out-of-scope. Do not assign final draft division from this field. |
| `Program Name` | Preserve as source program label for import review. |
| `Order Payment Status` | Map `Completed`/`Pending`; unknown values need review. Show outside evaluation screens only. |
| `Registration Number` | Optional, season-specific; null when blank; do not auto-number. |
| `Player Gender` | Store only if the league has an approved use and retention need; otherwise avoid unnecessary personal-data retention. |
| `Account First Name`, `Account Last Name`, `User Email` | Sensitive family/account data. Do not persist by default unless a confirmed workflow requires it; keep only the minimum necessary data. |
| `Order Date`, `Order No` | Do not persist by default unless the league approves a defined audit/reporting use. Never use order number as player identity. |

## Identity and re-import rules
- Internal `players.id` remains permanent and app-generated.
- External Sports Connect ID is season-scoped and may change for the same child across seasons.
- Same external ID is evidence, not proof. Different external ID does not rule out a match.
- Name/birthdate only generate suggestions. Administrator confirmation is required before linking to an existing internal player.
- Same player should have at most one season registration for a given season (`UNIQUE(player_id, season_id)`).
- If a registration is already present for the same season/external ID, stage it as an update/reconciliation candidate, not a duplicate new registration.
- Duplicate external IDs in one season must never silently map to multiple children.

## Display/privacy requirements
- Registration status appears on authorized player lists, player details, and reports.
- Registration/payment status is not included in evaluation screen data queries, exports, or evaluator-facing payloads. Hiding a visual label alone is insufficient; query/view/API shape must exclude it.
- Pending registrations remain evaluation-eligible. The app does not accept or record payments beyond the source status.
- Import actions and admin match decisions should be auditable with actor, timestamp, batch, row, and decision/reason.

## Acceptance tests
- Valid file previews without writing to database.
- Correct 323-row sample: 323 unique nonblank Player IDs, 286 Completed, 37 Pending, 323 blank registration numbers, and 323 parseable birthdates.
- Duplicate Player ID in two source rows produces blocking conflict with both row numbers.
- Blank Player ID, invalid date, missing required name, unknown status, and malformed row are clearly flagged.
- A/Tee Ball/Wiffle Ball/unknown programs import as review-required and are not active-evaluation eligible by default.
- Existing-player candidates are never auto-linked; admin can confirm/create/defer.
- Same external ID in different seasons is permitted; changed ID still allows candidate suggestions.
- Re-import of unchanged file creates no duplicate player-season registrations.
- Pending and Completed both appear in evaluation eligibility and neither status is visible in evaluation UI/data payload.
- Missing registration numbers stay null; duplicate supplied numbers are flagged.
- No database write occurs before confirmation; commit is atomic or clearly reports any explicitly supported partial commit.
