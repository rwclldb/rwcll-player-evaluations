# Historical Data Fixture Guide

## Purpose
These files support lifecycle test #3: preserving and reviewing historical records from a completed Spring 2026 season while preparing Spring 2027.

## Relationships
- `fictional_player_roster.csv` is the current Spring 2027 fictional roster.
- `historical_player_seasons.csv` contains 18 Spring 2026 registrations linked to the same stable `fictional_player_key`.
- `historical_player_evaluations.csv` contains historical evaluation records linked through `historical_registration_key`.
- `historical_coach_evaluations.csv` contains prior-season coach feedback, including incomplete and conflicting records.
- `historical_match_review_cases.csv` lists cases that should require human review rather than a silent merge.

## Intentional edge cases
- External ID changed: candidate history exists but the external ID differs.
- Name changed: historical display name differs from current roster.
- Not evaluated: a returning player has a historical registration but no evaluation record.
- Missing core rating / incomplete ratings: do not treat missing values as zero.
- Evaluator disagreement: two source records differ; retain both.
- Conflicting match: more than one plausible candidate is supplied; do not silently attach the wrong player's history.
- Coach history incomplete/conflicting: preserve source rows and flag for review.

## Expected general behavior
1. Historical Spring 2026 records remain readable after Spring 2027 setup.
2. Spring 2027 setup must not overwrite or silently copy prior-season evaluations.
3. Stable fictional player keys link intended returning players across seasons, but import/matching tests should use the visible evidence and review flags—not assume every row is automatically approved.
4. Missing historical ratings are not zero ratings.
5. Conflicting records remain visible for human resolution.
6. These files are fictional and must not be imported into a live league or treated as real player records.
