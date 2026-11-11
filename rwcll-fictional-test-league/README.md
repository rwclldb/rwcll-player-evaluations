# RWCLL fictional test league fixture pack

This pack contains only synthetic test specifications and CSV fixture definitions. It has **not** been loaded into any database.

Files:
- `FICTIONAL-LEAGUE-SPEC.md` — assumptions, source findings, safety rules, and lifecycle approach.
- `SCENARIO-MATRIX.md` / `.csv` — prioritized acceptance scenarios and blocked-feature markers.
- `fictional_player_roster.csv` — 45 fictional players with stable fixture keys and scenario tags.
- `fictional_people.csv` — 2 admins, 10 coaches, and 5 independent evaluators.

Before loading:
1. Validate current schema and migration state in local development.
2. Confirm intended age calculations against the season age chart.
3. Design stable-key-to-database-ID mapping and fixture setup/teardown.
4. Obtain explicit approval before database writes; hosted Supabase remains untouched.


## Historical data files (added for lifecycle test #3)

- `historical_player_seasons.csv`: 18 synthetic Spring 2026 registrations for players marked `prior_season_registration=YES` in the roster.
- `historical_player_evaluations.csv`: synthetic prior-season player evaluation records. Missing ratings and evaluator disagreements are intentional.
- `historical_coach_evaluations.csv`: synthetic coach feedback with complete, incomplete, new-coach, and conflicting attribution cases.
- `historical_match_review_cases.csv`: explicit identity-match review cases and expected dispositions.

All names, IDs, scores, dates, teams, and evaluations in these files are fictional test fixtures. They are not official RWCLL records. The synthetic birth dates and listed ages are not authoritative; validate age behavior against the official age chart separately.

Important: historical rows with fixture cases such as `EXTERNAL_ID_CHANGED`, `NAME_CHANGED`, `MISSING_CORE_RATING`, `EVALUATOR_DISAGREEMENT`, `INCOMPLETE`, or `CONFLICTING` are deliberately unusual. Do not normalize them away before testing. Expected behavior is to preserve source data and flag ambiguous or incomplete records for review rather than silently merging, deleting, or assigning zero scores.
