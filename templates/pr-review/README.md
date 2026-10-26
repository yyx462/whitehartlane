# pr-review — the adversarial pre-merge rail

One command closes the PR→merge gap:

```
whl review <repo> --base main --head feat --from opencode:<sid>
```

The review is a **whl program** (this template, materialized by the
door): fresh reviewer minds hunt aggressively, then every blocking
finding must survive a mechanical proof. Acceptance merges; rejection
splits the feedback by responsible worker and hands it back.

The design distills what the strong teams converged on (research in
the session behind this template; receipts: Anthropic's /code-review
five-lens + rubric filter, Cursor Bugbot's parallel passes and
resolution-rate metric, OpenAI Codex's "introduced by this change" +
"provably affected" rules, Greptile's address-rate findings, obra's
fresh-context reviewer, Meta ACH's seeded mutants, Simon Willison's
"proven to work"): **give the reviewer a fresh context, let it hunt,
then throw away anything that cannot be verified.** whl adds the piece
they all want: a rail that RUNS a test and refuses to advance.

```
intake (gate)    resolve BASE/HEAD, two read-only checkouts, diff,
                 pr.md (claims WITHOUT the author transcript), one
                 shuffled hunk order per lens (order = attention)
lenses (fan-out) 4 fresh minds, one lens each:
                   principles (0.2) — invariants + twin paths + the
                                     repo's own direction docs
                   tests      (0.4) — adversarial test creation (write
                                     the test that would catch it)
                   momentum   (0.6) — the authoring trace cross-check
                                     + lifecycle/timing assumptions
                   questions  (0.8) — the fixed questionnaire
                 findings-check judges SHAPE while each lens lives
                 (one revise round); truth is not its job
prove (gate)     THE DECISION MODEL — a P0/P1 blocks only with a repro
                 that fails on HEAD twice (assert, not load-error) and
                 classifies against BASE:
                   fails HEAD, passes BASE           → introduced      BLOCK
                   fails both, diff touches the file → incomplete-fix  BLOCK
                   fails both, diff never touches it → pre-existing    advisory
                   load-error → bogus · one-of-two → flaky · passes → refuted
divide (solo)    on reject: one mind reads the findings + the AUTHORING
                 run's trace (trace/), maps each finding to the worker
                 whose deliverable claims its file, writes one
                 feedback/<name>.md per party (their findings ONLY +
                 the please-check-and-refine contract) + MAP.md with
                 the evidence. On accept: a no-op.
merge (gate)     accept → MERGE_CMD (or local git --no-ff). reject →
                 exit 1: the chain fails HONESTLY, the wake says why.
                 The one deliberately cold verdict.
```

## Why this shape

- **Chain, not coworker** — members exchange messages, so a coworker
  reviewer would read the author's explanations: exactly the
  contamination fresh-context exists to prevent, and the sycophancy
  paper says follow-up rebuttals win too often.
- **The decision model is mechanical on purpose** — Greptile measured
  LLM severity judgment as "nearly random"; a failing test is an
  external oracle. Block on facts only; opinions (P2/P3, unproven,
  bogus, flaky, pre-existing) are advisory (`review/advisory.md`) and
  never block — the countermeasure to the 79%-nits failure.
- **The skip is a pre-flight, not a stage** — a declared chain cannot
  shed units mid-run (ADR 0014), so docs-only diffs are detected at
  the door, before anything is booked.
- **Verdict timing obeys the law** — only merge is cold. The lenses'
  check fires while each lens lives (red = one revise round); prove
  and divide are acts, never judges of a fixable workforce.

## As a PR hook (the universal wiring)

Every PR-generating stage gets the same tail:

1. the stage's unit(s) push the branch and open the PR, then write
   `pr-url` to their result;
2. the LEVY (not the worker — one wake per commission) runs
   `whl review <repo> --base <trunk> --head <branch> --trace-dir
   <the authoring job's dir> --from opencode:<sid>`;
3. the wake lands with the verdict. On accept, the PR is already
   merged (the merge gate did it). On reject, feed each
   `feedback/<name>.md` to that worker's NEXT brief — the refine
   round is the authoring program's, not the review's;
4. a worker may answer a finding only with code or a test; the repros
   under `test/review/` are the review's property and never edited by
   the author without the arbiter (the next review re-runs them).

## Knobs and limits (honest)

- **Gate cap 300s**: intake's dep install is budget-capped (150s per
  side, `npm ci --prefer-offline`); a repo that cannot fit degrades —
  repros needing node_modules classify bogus, never block wrong.
- **Prove cap 12**: at most 12 repros proven per review (each ≤3 runs
  ≤60s); the excess degrade to advisory with a receipt in verdict.json.
- **Assert-vs-load heuristic**: a repro "fails on an assertion" iff it
  exits nonzero without a module/syntax error on stdout+stderr.
- **The divider's floor is mechanical**: feedback must cover every
  blocked finding exactly once and never invent one (divide-check);
  the MAPPING's wisdom is the agent's, judged by you over time.
- **Metrics**: every finding lands in `review/ledger.jsonl` (lens,
  severity, outcome, head sha). Weekly: proof rate per lens (low =
  the lens guesses), resolution rate (proven findings fixed at
  merge), escape rate (each escape → a new INVARIANT), seeded recall
  (plant a known bug, count catches — the only honest recall measure
  when the same model family is on both sides).

## Per-repo checklist

The repo under review owns its own "what right means":

- `INVARIANTS.md` at the repo root — the reviewer's checklist; every
  bug that escapes review adds an entry (the compounding trick).
- `QUESTIONS.md` at the repo root — the fixed questionnaire; keep it
  mechanical and evidence-shaped.

Without them the template's seeds are used (`INVARIANTS.template.md`,
`QUESTIONS.template.md` — copies land in the program folder as
INVARIANTS.md / QUESTIONS.md, so the briefs never dangle).
