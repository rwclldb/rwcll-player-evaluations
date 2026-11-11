# RWCLL fictional test league

Synthetic test data for RWCLL Player Evaluations. Every name, ID, email, birthdate, and score is fake. Never load this into a live league.

**Only players are rated.** Coaches rate players; nobody rates coaches.

## Two datasets

| Dataset | Use it to test | Contains |
|---|---|---|
| **Pre-evaluation** | Import, bibs, prior-year matching, live scoring | Registrations, bib numbers, Spring 2026 coach ratings of players, accounts. **No Spring 2027 scores.** |
| **Scored** | Draft reports, lock/release, CSV/PDF, sorting | Everything above, plus a full set of Spring 2027 evaluations and the report values they should produce. |

Session states (setup, open, locked, released) and the prior-year switch are exercised by the tests themselves. They are not pre-seeded.

## Files

Hand-edited inputs (in this folder):

| File | What it is |
|---|---|
| `fictional_player_roster.csv` | 45 scenario players. Each has scenario tags and notes. Birthdates match the 2027 age chart. |
| `fictional_people.csv` | 2 admins, 10 coaches (one not returning, so no account), 6 independent evaluators, 1 account with no role. Emails are the login names. COA-10 and EVA-06 are the same person with two accounts. |
| `SCENARIO-MATRIX.md` / `.csv` | Lifecycle acceptance scenarios. |

Generated (in `generated/`, rebuild with `node scripts/generate-fictional-league.cjs`). **Do not edit these by hand.**

| File | What it is |
|---|---|
| `sports-connect-spring-2027-scenarios.csv` | The 45 scenario players in exact Sports Connect format. Small, every edge case. |
| `sports-connect-spring-2027-full.csv` | The 45 scenario players plus the 323-row fake sample (368 rows, 290 in the evaluation pool). Realistic size. |
| `scenario-notes.csv` | For each scenario player: tags and the expected import result. |
| `bib-numbers-by-player-id.csv` | Bib upload keyed by Sports Connect Player Id. |
| `bib-numbers-by-name-and-birthdate.csv` | The same bibs keyed by name plus birthdate. |
| `bib-numbers-with-errors.csv` | Bad uploads (duplicate bib, non-numeric, blank, unknown player, out-of-scope player, one player listed twice). The `Expected Result` column says what should happen. |
| `spring-2026-coach-ratings.csv` | Prior-year end-of-season coach ratings of players, on the same form as evaluations (5 core skills plus optional pitching and catching). Sparse, as real data will be. |
| `spring-2026-expected-matches.csv` | For each prior-year row: the player it should match and the admin action (confirm, review then confirm, or keep unmatched). |
| `scored/spring-2027-evaluations.csv` | 1,230 Spring 2027 evaluations (submitted, draft, not evaluated) by coaches and independent evaluators. |
| `scored/expected-draft-report.csv` | The coach and evaluator averages, per-skill averages, prior-year averages, and flags the draft report should show. |

## Rules baked into the expected report

- Only **submitted** evaluations count. Drafts and "not evaluated" are excluded and counted separately.
- Blank ratings are skipped, never zero.
- Skill average = mean of the non-blank submitted ratings for that skill.
- **Coach overall** and **evaluator overall** are each the mean of the available core-skill averages (5 core skills only). They are never combined.
- Pitching and catching = mean of the available sub-skill averages. They are shown separately, not in the overall.
- Prior-year values assume the admin made the decisions in `spring-2026-expected-matches.csv`.
- Numbers are rounded to 2 decimals. Compare with a tolerance of 0.005.

## Key scenarios

| Players | Scenario |
|---|---|
| PLY-001, 002 | Identical scores (tie for sort tests) |
| PLY-007, 008 | Same Sports Connect Player Id. In real data this shouldn't happen, so the app flags it. PLY-007 commits; PLY-008 is held in import review until the Id is fixed, and isn't in the pool. |
| PLY-009, 010, 033 | No bib number; flagged, never invented |
| PLY-011, 043 | Injured: partial scores; PLY-043 marked "not evaluated" by evaluators |
| PLY-013, 014, 044 | Absent or exempt: no evaluations at all |
| PLY-017 to 021 | Prior-year history; 019 and 020 changed Player Id; 021 changed name |
| PLY-022 | Missing birthdate; admin must set the age before evaluation |
| PLY-025 | One coach marked "not evaluated" (not a zero) |
| PLY-026 | Submitted with a blank core skill (must be flagged); prior year is also partial |
| PLY-027, 028 | Evaluators disagree sharply; two prior-year coaches also disagree |
| PLY-029, 030 | Out-of-scope divisions (Softball Majors, Challenger); not in the pool and no bib |
| PLY-035, 036 | Coach COA-10 left an unsubmitted draft |
| PLY-038 | Prior-year look-alike ("Micah Oakes"); must stay unmatched |
| PLY-039 | Partial prior-year spreadsheet |
| PLY-040 to 042 | Prior-year coach (COA-07) isn't returning and has no account |

## Evaluator coverage (scored dataset)

| Ages | Coaches | Independent evaluators |
|---|---|---|
| 7–8 | COA-01, 02, 03 | EVA-01 |
| 9–10 | COA-03, 04, 05 | EVA-01 (age 9), EVA-02 (age 10) |
| 11–12 | COA-05, 06, 08 | EVA-02, EVA-04 |
| 13–14 | COA-08, 09, 10 | EVA-03, EVA-04 (age 13), EVA-06 (age 14) |
| 15–16 | COA-09, 10, 01 | EVA-03, EVA-06 |

EVA-05 has no assignment and must not be able to score anyone. NOR-01 has no role and must see nothing.
