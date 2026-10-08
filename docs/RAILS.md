# Rails and hooks — the inventory, from use

Zen 3 deferred naming the inventory until the system had been used.
It has been: Phase A (the OS disk, JEV, receipts), Phase B (one home,
one trace, unit dirs, resolvers), and one live provider 429 that killed
a planner call. This is the list that use produced. Rails do not change
per Job; hooks do (GOAL 3). A planner may write hooks; it may never
rewrite rails.

## Start

`agentic-os run <folder>` is the process door. It reads `workflow.toml`, books a fan-out Job, starts the engine, and prints `job`, `log`, and `trace`. No grill. No question. A second running Job on that session is refused, and no pane is born. The session key is `(agentic-os, folder path)`.

The chat still stands a Job up itself. That is a second door. It must call `run`. It does not, yet.

`run` reads the folder you pass and writes the Job under the session disk. The source is code and config. A run does not write it. Hook commands in the Job dir are absolute paths back to that source. The chat's materialize still copies a hooks folder.

A Job started this way can finish with no person in the loop. A dead orchestrator still waits: relaunch or abort. Promote is never part of the Job.

## Rails — machinery every workflow uses and none may rewrite

- **The trace.** One `events.jsonl` per session, append-only, the
  single source. `job.json`, `report.json`, `state.json` are
  projections (`projectJob` rebuilds them from events). Event kinds:
  `route, admit, reject, job.born, job.orphaned, job.relaunched,
  pane.born, pane.died, reprompt, backpressure, unit.settled,
  job.retired, job.aborted, wake.consumed, fatal`.
- **Booked birth (JEV).** `src/policy.ts` admits — deterministic checks
  (slots, retry cap, one Job; a fork's seed must resolve); every pane
  is booked `pane.born` with a `parent` stamp (`first_mate` |
  `orchestrator` — zen 4's two wake budgets never mix) and, when
  forked, a `seed` pointer into the seeded host session (zen 6). No
  booked birth, no pane; unbooked live panes are audit findings, not
  workers. A model proposal is an input to booking, never the booking.
- **The pane ledger and the receipt.** Panes of a Job are booked
  born/died; retire = this Job's panes remaining 0 (`job.retired`).
  Records are never deleted — `retired` is a state.
- **Permission decisions (JEV's other half).** A blocked pane is a
  question; `src/permission.ts` answers it — typed, not an agent:
  allow (inside the member's roots), deny (secrets, outside home),
  deny-unneeded (wandering) — and a repeat ask for the same non-dangerous path escalates to a durable allow: persistence is the asserted need. The rail
  applies the verdict (dialog cleared, message injected, root made
  durable on allow), books a `permission` event, and caps the asks —
  over 6 the member is dead. With this, worker permissions are
  restrictive by default: no dialog ever waits for a person.
- **Fail recovery, both halves.** Detect: `audit` (unadmitted panes),
  `sweep` (running Job, dead orchestrator pid). Recover, ask-first: a
  dead orchestrator parks the Job `orphaned` in a derived queue —
  announced on the periodic check, never a wake, never
  auto-resurrected (what you killed stays killed); graceful stops abort
  and never orphan. `relaunch` is user-decided, retires stragglers of
  the dead generation first, capped at 2 tries per Job; `abort`
  declines.
- **Backpressure and the retry cap.** Backpressure is the provider's
  refusal treated as information: the hook classifies (exit 75 =
  refused/slowed; anything else is deterministic), the rail retries —
  refusal only, exponential backoff with jitter, hard cap (3), a
  visible line per wait, a `backpressure` trace event. Hand-set
  concurrency (slots) is NOT backpressure; the rail guarantees only
  that a cap exists and is honored. Every retry surface in the system
  is capped the same way: spawn attempts (3), grace reprompt (once),
  provider refusals (3).
- **The session disk and bindings.** `~/.local/share/agentic-os`
  (AGENTIC_OS_HOME). A First Mate chat is keyed on the host session.
  A CLI start is keyed on `(agentic-os, folder path)`. A host session
  is the agent's own conversation; the Session stores a pointer, never
  the bytes. Project bindings are confirmed once per session. A live
  worktree is never double-bound.
- **Scope hygiene.** Tests and live runs never share a shep scope
  (`SHEP_SCOPE`); test homes are temp dirs.

## Hooks — the per-task surface a planner may write

- `units` (decompose the task), `brief` (worker instructions),
  `grade` (settle a unit), `report.where` + `counts` (named counts),
  `slots` (per-task concurrency, default 2).
- `detectors` (`signal`, `end`) — the program's say in what the
  photograph is made of: how a wave is recognized and how a unit's end
  is read. Same contract as every hook (strict output, exit 75 =
  refusal, retried by the rail); a deterministic failure degrades to
  "no signal / still running" and logs once — a detector may slow the
  rail, never kill it. A signal detector NAMES the wave: like
  `protocol.json`, it keeps saying the current wave until a new one
  replaces it — going silent once the work is done leaves the wave
  unable to close (tick finishes a wave only on a beat that still
  names it). Absent, the OS defaults run: `protocol.json` and the unit
  `log.txt`. Pane liveness stays rail-owned either way: a dead pane is
  dead even under a custom end detector.
- `gates` — one command per `does: "gate"` step in `dag.mjs`; prints
  `done` when the step may finish. The run door refuses a gate step
  with no matching `[gates]` command — nothing is booked. Reopen,
  retry, and the report still belong to `tick` and the rail.
- `roots.txt` — a program's named extra worker roots, one absolute
  path per line, staged beside the dag; the rail folds them into the
  per-run worker permissions. The rail knows no program's env names.
- Named as command strings in `workflow.toml`. A path may be absolute.
  A `hooks/` folder beside the toml is a copy convention, not the
  contract. The chat's materialize copies that folder into `run/hooks/`
  so a live Job cannot edit the source. `run` does not copy the scripts.
  It points at them. Hooks may vary per task; rails may not.
- Hook contract for the planner hook: STRICT JSONL on stdout; exit 75
  = provider refusal (the rail retries), other nonzero = deterministic
  (fail fast).

## Classified on purpose

- `slots` is a **hook**, not a rail: the per-task tunable may change
  per Job. What is rail: a cap exists and the ledger honors it.
- The orchestrator's layout is a **hook-shaped choice of the
  workflow** (fan-out's tab is fan-out's business), but the pane
  ledger it reports into is rail.
- Direct has **no retry rail at all** — the open chat is the
  supervisor; a blocked turn is visible and the user resends.
  Unattended work belongs to a Job, not Direct.
