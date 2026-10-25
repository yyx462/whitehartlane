# whl-interview — an adversarial self-review loop

whl interviews itself. Two minds, one relayed exchange: an
**interviewee** playing the author of whl (every claim cites
`file:line`; when nothing designed it, it says "not designed yet") and
an **interviewer**, a skeptical staff engineer hearing only the pitch,
who climbs a fixed five-level ladder (what → how → why → break →
boundary) over a fixed six-topic map and grades every answer in a JSON
turn-contract block. The product is TWO DOCUMENTS, not a chat log:

- `explained.md` — one cited section per topic; a cold reader should be
  able to explain admission/JEV and pane supervision from it alone.
- `gaps.md` — every gap that SURVIVED the author's one rebuttal pass,
  ranked, each with the question that exposed it and the next design
  question. **At least one gap must stand**: a run whose interviewer
  was too soft FAILS at the audit.

Shape: a **pure coworker exchange** (the door's own members-shaped
spelling). The rail is the supervisor end to end: the relay routes
every turn, the relay cap bounds it, the member court retires panes,
and the audit gate is the program's `counts` hook — run at report time,
absolutized by the door against the source, nonzero exit fails the
report.

## Levy

`roots.txt` declares the subject (the repo path the briefs name) — the
door refuses a run whose briefs name paths no root covers; edit it to
interview a different checkout. The member `roots` entries grant the
panes their read at session start.

```
cd test/e2e/whl-interview
AGENTIC_OS_RELAY_CAP=140 <repo>/bin/whl run . --from opencode:<sid>
```

Bounds: the relay cap counts total turns (~6 topics × ≤6 turns × 2 +
pitch + synthesis + rebuttal + slack); the coworker engine carries its
own 2h deadline. Both panes pin `glm-5.3` via `[workflow] model`.

Standalone, zero tokens, no whl — prove the gate CHECKS rather than
vibes (golden exchange passes with a JSON counts line; six doctored
copies each fail for the reason the check exists):

```
bash hooks/audit-selftest.sh
```

## How the brief maps onto the grammar

| brief concept | the spelling here |
|---|---|
| supervisor = whl itself, no model call | the rail: the relay routes every turn (`relayPlan`), the relay cap + the engine deadline bound the run, the member court retires panes |
| separate sessions, no shared context | fresh coworker members; the rail appends the wire protocol to each brief (`memberProtocol`) |
| different system prompts per pane | the roster briefs (`members/<name>.md`) — one brief source per mind |
| deterministic topic map + ladder | declared in the interviewer's brief and RE-PINNED deterministically by `hooks/audit.py` (declared order, no revisits, ≤6 turns/topic) |
| turn contract + audit law | **ONE source**: `contract.toml` — rendered into the briefs (`hooks/render_contract.py --write`) AND read directly by the audit; a stale section in any brief FAILS the run, so hand-edits can never drift from the machine's demands |
| deliverables (#205) | declared IN the contract with kinds (`.md`, `.jsonl`, …); the audit refuses a run with a missing or empty deliverable — every commission guarantees its product |
| the question bank | `questions.toml` — every asked question must be banked, or appended first (append-only); makes "same questions every run" true by construction |
| malformed block → re-ask once → log | mid-flight: the interviewee replies `contract-malformed, please re-send` (brief law); at the audit: >2 consecutive malformed blocks fail the run and every error is logged into `transcript.jsonl` |
| interviewer read access to check citations | `roots.txt` (the door's scan) + member `roots` (the panes' grant); "only to check citations" is brief discipline — conditional access is not expressible in today's grammar |
| token budget per run | the relay cap + the engine's 2h deadline — there is no token field in the grammar; the pins keep turns cheap |
| temperature (interviewer hot, author cold) | NOT expressible — a member pins `provider/model` only; both panes run the same model |
| audit gate (`check`/gate stage) | the `counts` hook: runs at report time, stdout must be JSON, nonzero exit fails the report — the deterministic verdict rides the same path the rail already absolutizes |
| outputs under `interviews/<date>/` | members write `data/*.md` in the run tree; the audit builds `transcript.jsonl` deterministically and delivers everything to `interviews/<date>/` on PASS; set `WHL_INTERVIEW_REPO` to mirror into a repo checkout as `interviews/<date>-<job>/` |

Two honest grammar gaps remain worked around here (per-member
temperature; mid-flight body parsing — the rail reads envelopes, not
bodies). Two more were found by the first levy attempts and FILED as
rail issues, not worked around silently: stage `check`/gate `run`
commands are never absolutized and `hooks/` is never staged (a
`[[stage]]` chain cannot run a script check in a real run — receipts
j-36f78c/j-c93562), and a minted `stages/<id>/` child carries no
`roots.txt`, so a delegated child whose briefs name outside paths can
never pass admission. This program is a pure coworker exchange, which
needs neither.

## Rubric (done when)

- Every topic ends solid or stands in `gaps.md` — the audit enforces it.
- A cold reader can explain admission/JEV and pane supervision from
  `explained.md` alone — the human grades this line; the audit only
  checks that every section carries a surviving citation.
- At least one gap was news to the maintainer. Zero standing gaps is a
  FAILED run by construction; tighten the interviewer's brief and
  re-run. `project.json` pins the pid, so every re-run lands in the
  same project's trace — run-over-run diffs are the improvement loop.
