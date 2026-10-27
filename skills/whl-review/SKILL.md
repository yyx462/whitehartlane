---
name: whl-review
description: >-
  The adversarial pre-merge review rail — ONE spell (`whl review`) every
  PR-generating stage uses as its tail hook. Use when a branch/PR is
  ready to merge and must face the rail, when a review job's wake lands
  (verdict reading, feedback division, test adoption), or when a review
  lens stalls/dies mid-run. Triggers: "review this PR", "run the review
  rail", "pre-merge review", a review job finished/rejected, "re-run
  one lens".
---

# whl-review — one rail, one spell, every PR's tail

`whl review` closes the PR→merge gap: fan-out adversarial lenses,
a mechanical proof gate, per-worker feedback division. The program
template is `templates/pr-review/` (read its README before
customizing; the economics of running it: its ECONOMICS.md).

## The spell (from an agent session: tracked background shell — never nohup)

```
bin/whl review <repo> --base master --head <branch> \
  --out <materialized-dir> --title "<PR title>" \
  --model <provider/model> \          # REQUIRED provider-qualified
  [--trace-dir <authoring job's run dir>] \
  [--merge-cmd "<command that lands the merge>"] \
  --unattended                        # or --from opencode:<your sid>
```

Full flag manual: `whl review --help`.

## What runs

intake gate → 4 lenses in parallel (temperature-spread) → prove gate
→ responsibility divide → cold merge gate:

- `principles` — INVARIANTS.md + twin paths (one decision, many sites)
- `tests` — adversarial test creation
- `momentum` — the authoring trace cross-check (needs --trace-dir,
  else judges against OPTIMUM.md/AGENTS.md + the diff's own timing)
- `questions` — the repo's QUESTIONS.md, asked of the diff

The DECISION MODEL is mechanical, never an LLM's opinion: a finding
blocks ONLY with a repro failing 2× on HEAD and classifying
introduced/incomplete-fix against BASE. Pre-existing, bogus, flaky,
refuted, P2/P3 → advisory. Accept → the merge gate merges (a base
that moved since intake refuses). Docs-only diffs skip at the door.

## When the wake lands (the levy's job)

- verdict: `<job-dir>/data/review/verdict.json`
  (accept / reject / blocked / advisory / adopt counts).
- On **reject**: feed each `feedback/<name>.md` verbatim into that
  worker's NEXT brief — the refine round belongs to the AUTHORING
  program, never the review. A worker answers with code or a test,
  never prose.
- Test adoption: workers never edit repros under `test/review/` —
  the fix commit ADOPTS them (copied into the repo's own suite,
  assertion intact; `verdict.json adopt[]` lists regressions to
  adopt now). A fix without its adopted test has not happened.

## Hard rules (each one is an incident)

1. **A dead unit is not a dead review.** A stalled lens or dead pane
   re-levies the SAME program dir (`whl run <dir> --unattended`) —
   the settled fold spares done units, respawns only the unfinished
   one. NEVER materialize a fresh program to retry (re-runs every
   lens; receipt: r8, j-3f4065 — three green lenses burned to redo
   one).
2. **Model pins are provider-qualified** (`zhipuai-coding-plan/glm-5.3-flash`),
   never bare ids — the door refuses bare forms.
3. **Reviewers never write the repo under review.**
4. **Every escape becomes a new invariant** — a proven finding that
   walked past INVARIANTS.md adds a line to it in the fix commit.

## Keeping it honest

- Weekly drill (5 adversarial cases, opt-in):
  `PR_DRILL=1 test/e2e/pr-review/run-drill.sh <checkout>`
- Past-run economics (tokens, duplicates, wall time):
  `node scripts/review-trace.mjs`
