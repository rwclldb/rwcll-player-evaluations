# RWCLL fictional league — lifecycle scenario matrix

Priorities: **P0** = foundational acceptance; **P1** = important follow-on; **P2** = repeatability and lifecycle hardening. Status reflects source inspection, not a claim that the test has passed.

| ID | Priority | Phase | Scenario / expected result | Status |
|---|---|---|---|---|
| LFC-01 | P0 | End-of-season closeout | Spring 2026 records remain readable and unchanged after Spring 2027 setup | Season close/reopen + audit workflow not verified in UI; closeout acceptance BLOCKED pending workflow validation |
| LFC-02 | P0 | Create Spring 2027 season | New season carries division configuration only; no teams, coach assignments, or current evaluations copied | Season creation can be tested; carry-forward rules need explicit assertions |
| LFC-03 | P0 | Registration import | Stage generated/sports-connect-spring-2027-scenarios.csv (45 rows), preview flags, review matches, commit only approved rows | Implemented source workflow; test status/payment and row-level outcomes |
| LFC-04 | P0 | Duplicate external IDs | PLY-007 and PLY-008 share one external Sports Connect ID; neither auto-merges | Import review/commit safeguards exist; verify duplicate resolution paths |
| LFC-05 | P0 | Registration status coverage | Completed, Pending, Unpaid, Unknown all remain present and payment status is preserved | Current branch includes migration allowing all payment statuses in evaluations; runtime behavior should be verified |
| LFC-06 | P0 | Age boundary | Include age 7; no age 6 in active pool; validate official 2027 age chart | Age sessions support ages 7–16; age computation/chart import requires explicit data validation |
| LFC-07 | P0 | Primary/makeup schedule | Each age group has primary event and optional makeup; global schedule must not overwrite existing event | Session-event UI/schema present; per-player attendance is BLOCKED by missing attendance model |
| LFC-08 | P0 | Attendance/exemption | Absent, makeup-present, injured-present, admin-approved exemption with reason | BLOCKED: dedicated attendance/exemption schema and workflow not found in current migrations |
| LFC-09 | P0 | Evaluator assignments | Two admins, six independent evaluators (EVA-05 unassigned), one no-role account; assignment to age sessions and authorization boundaries | Assignment UI/schema present; test separate accounts and direct database access |
| LFC-10 | P0 | Evaluation scoring | Core skills, optional pitching/catching, unknown experience answers, drafts, Not Evaluated | Evaluation entry/draft path exists; verify score completeness, optional scores and Not Evaluated semantics |
| LFC-11 | P0 | Evaluator disagreement | Two evaluators record intentionally different scores for one player | Evaluate separate independent submissions; verify admin can inspect without leaking identities to coaches |
| LFC-12 | P0 | Role/row-level security | Admin, coach, independent evaluator, unassigned coach and non-admin direct URL/DB access | PARTIAL: focused tests exist, broad role/RLS matrix remains open |
| LFC-13 | P1 | Prior-year coach ratings of players | Prior season has complete, incomplete, missing, and conflicting source records | Schema/report display exist; full historical import review/commit is BLOCKED/incomplete |
| LFC-14 | P1 | Historical matching | Same player with changed external ID/name variant; ambiguous candidates require admin review | Matching must be explicit; no automatic merge; import UI coverage incomplete |
| LFC-15 | P1 | Post-evaluation roster assignments | Assign players to teams after evaluation, one team per player per season; enforce top-age rule | BLOCKED/partial: team reference exists but complete player-team assignment UI/workflow not confirmed |
| LFC-16 | P1 | Administrator reports | Current scores, historical section, payment status, age/division context, missing evaluation flags | Admin player reports and CSV export exist; verify counts/reconciliation |
| LFC-17 | P1 | Coach report scope | Coach sees draft reports only after admin releases; prior-year ratings visible for all rated players (live-evaluation visibility follows the per-season switch) | Team-scoped route exists and must be replaced (decision 2026-11-10) |
| LFC-18 | P1 | CSV reconciliation | Exported rows/counts agree with UI and source fixture; historical rows separate from current ratings | Export exists; validate row counts, category mapping, null handling |
| LFC-19 | P2 | Repeatability/reset | Rebuild the same fixture in disposable local database with stable synthetic keys | Fixture design supports repeatability; seed/import automation to be designed after schema validation |
| LFC-20 | P2 | Next-season transition | Create a later season while preserving prior history and requiring new assignments | Carry-forward rules are documented; full lifecycle test depends on close/reopen and assignment validation |
