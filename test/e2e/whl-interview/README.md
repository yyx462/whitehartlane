# whl-interview — an adversarial self-review loop

whl interviews itself. Two minds, one relayed exchange: an
**interviewee** playing the author of whl (every claim cites
`file:line`; when nothing designed it, it says "not designed yet") and
an **interviewer**, a skeptical staff engineer hearing only the pitch,
who draws from a fixed five-level ladder (what → how → why → break →
boundary) over a fixed FIVE-topic map under THIS commission's hard
budget — the whole question list is AT MOST FIVE questions (one fresh
question per topic, the sharpest the bank holds) — and grades every
answer in a JSON
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
| audit BEFORE retire (#198) | the `verdict` hook: runs when the exchange sees a stop, while both panes still LIVE — red hands the stop's author ONE revise round carrying the hook's stderr verbatim (audit.py `--verdict` names the missing deliverable); a second red fails honestly with the verdict row on the report |
| two shelves by reader | `data/` is the WORKING shelf — everything an agent or hook touches: the question bank, pitch (the interviewer reads it), topic-map/explained/gaps (the audit reads them), and the machine `transcript.jsonl`. `deliverables/` is the HUMAN pack under a strict law: a file lives there only if NO agent needs to read it — exactly one file, `interview.md`, rendered by the audit at report time (the QA lecture: Interviewer:/Me: per turn, per-topic ladder walks as mermaid, the standing-gaps list). Never authored by a pane, read by the human alone |

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

## The acceptance test — the 7 expectations

`bash test/e2e/whl-interview/acceptance.sh` runs the commission live and
scores it against the seven expectations, in order:

1. the old spur (no contract.toml) is refused by screening, no job formed
2. ONE folder for the run, subfolders (stations) inside it
3. members send via THE SEND TOOL — own mailbox rw, peers out of scope,
   the rail-written mail ledger on the trace
4. prompts + audits generated from the ONE contract (drift-cop: a stale
   brief section fails the run)
5. token / trace / time-cost / tables semantic logging (turn.tokens per
   delivered relay, per-member cost rows on the report)
6. on failure the rail SAYS the cheapest repair (the wake names
   `whl continue` re-runs the verdict when the program hash moved)
7. the question bank: the interviewer appends to the run's own staged
   copy on the data/ shelf, <= 5 asked, all banked

Expectations whose mechanism has not landed print `pend` naming the
delivery — never a silent pass. Any `fail` exits non-zero.
