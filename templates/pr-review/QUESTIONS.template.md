# QUESTIONS.md — the fixed questionnaire (the questions lens answers
# EVERY one, in order, PASS / FAIL / N-A + one line of evidence with
# file:line; a FAIL becomes a finding only with named affected code,
# and P0/P1 only with a failing repro)

1. Does every behavior the diff claims have a test that FAILS if the
   implementation is reverted? (name it, or FAIL)
2. Is every decision the diff changes made in exactly one place? (grep
   the synonyms; every twin site must route through one owner)
3. Does every new/changed input field the parser accepts reach a
   consumer? (field-by-field: who reads it)
4. Are all waits OBSERVED state, never timers? (sleep/timeout/settle
   in the diff: what state could be observed instead)
5. Do failure paths report infra as infra, never as an answer? (break
   each new call: where does the error land)
6. Are mid-flight states handled — pause, resume, retry, death — not
   just the happy path? (for each new state machine: the unhappy arcs)
7. Does the change touch tests as well as code — and if it changed
   tests, did it change ASSERTIONS (a red flag: fitting the test to
   broken behavior) or only fixtures?
8. Is every file in the diff claimed by the PR's own text/pr.md? (an
   unclaimed file is a finding for the trace lens too)
9. If the change deletes something, is every reader of the deleted
   thing updated or refused honestly? (deletions stay deleted; their
   callers must not linger)
10. Would this change survive its own review — does the PR body state
    the safe path for each rule it touches?
