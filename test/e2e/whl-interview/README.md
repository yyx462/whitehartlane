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
  question. **At least one gap must stand**: the audit gate fails a run
  whose interviewer was too soft.

Chain: `interview` (coworker: interviewee initiates with the pitch,
interviewer grades and routes) → `audit` (gate: deterministic verdict
on the transcript, then delivery).

## Levy

`roots.txt` declares the subject (the repo path the briefs name) — the
door refuses a run whose briefs name paths no root covers; edit it to
interview a different checkout.

```
cd test/e2e/whl-interview
AGENTIC_OS_RELAY_CAP=140 <repo>/bin/whl run . --from opencode:<sid>
```

`deadline_ms = 5400000` (90 min) is the run budget; the relay cap
bounds total turns (~6 topics × ≤6 turns × 2 + pitch + synthesis +
rebuttal + slack). Both panes pin `glm-5.3` via `[workflow] model`.

Standalone, zero tokens, no whl — prove the gate CHECKS rather than
vibes (golden exchange passes; six doctored copies each fail for the
reason the check exists):

```
bash hooks/audit-selftest.sh
```

## How the brief maps onto the grammar

| brief concept | the spelling here |
|---|---|
| supervisor = whl itself, no model call | the rail: the relay routes every turn (`relayPlan`), `deadline_ms` + the relay cap bound the run, the member court retires panes |
| separate sessions, no shared context | fresh coworker members; the rail appends the wire protocol to each brief (`memberProtocol`) |
| different system prompts per pane | the roster briefs (`[[stage.members]]`) — one brief source per mind |
| deterministic topic map + ladder | declared in the interviewer's brief and RE-PINNED deterministically by `hooks/audit.py` (declared order, no revisits, ≤6 turns/topic) |
| turn contract JSON | a fenced ` ```turn-contract ` block on every interviewer note; schema, enums, one-question law enforced by the audit gate |
| malformed block → re-ask once → log | mid-flight: the interviewee replies `contract-malformed, please re-send` (brief law); after the wake: `audit.py` fails a run with >2 consecutive malformed blocks and logs every error into `transcript.jsonl` |
| interviewer read access to check citations | `roots` grants the repo from birth; "only to check citations" is brief discipline — conditional access is not expressible in today's grammar |
| token budget per run | `deadline_ms` + `AGENTIC_OS_RELAY_CAP` — there is no token field in the grammar; the pins keep turns cheap |
| temperature (interviewer hot, author cold) | NOT expressible — a member pins `provider/model` only; both panes run the same model |
| outputs under `interviews/<date>/` | members write `data/*.md` in the shared tree; the audit gate (the program's only writer) builds `transcript.jsonl` deterministically and delivers everything to `interviews/<date>/` in the job dir on PASS; set `WHL_INTERVIEW_REPO` to mirror into a repo checkout as `interviews/<date>-<job>/` |

Two of those rows are honest gaps, not choices: per-member temperature
and mid-flight body parsing don't exist in the grammar. The program
works around both with brief discipline and an ex-post deterministic
gate; if a real run shows the workaround bending, that is a ticket on
the door, never a mid-run edit of whl.

## Rubric (done when)

- Every topic ends solid or stands in `gaps.md` — the gate enforces it.
- A cold reader can explain admission/JEV and pane supervision from
  `explained.md` alone — the human grades this line; the gate only
  checks that every section carries a surviving citation.
- At least one gap was news to the maintainer. Zero standing gaps is a
  FAILED run by construction; tighten the interviewer's brief and
  re-run. `project.json` pins the pid, so every re-run lands in the
  same project's trace — run-over-run diffs are the improvement loop.
