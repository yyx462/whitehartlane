# Rails and hooks — the inventory, from use

Zen 3 deferred naming the inventory until the system had been used.
It has been: Phase A (the OS disk, JEV, receipts), Phase B (one home,
one trace, unit dirs, resolvers), and one live provider 429 that killed
a planner call. This is the list that use produced. Rails do not change
per Job; hooks do (GOAL 3). A planner may write hooks; it may never
rewrite rails.

## Start

`whitehartlane run <folder>` is the process door. It reads `workflow.toml`, books a fan-out Job, starts the engine, and prints `job`, `log`, and `trace`. No grill. No question. A second running Job on that session is refused, and no pane is born. The session key is `(whitehartlane, folder path)`. `whl` is the same door for any agent: a thin shim that calls `run` and walks away (ADR 0006).

The chat extension is passive now (the stand_up tool, /standup, and --route routing are retired): it binds the conversation's OS session, delivers wakes into the chat, announces orphans, lists Jobs, and caps error-turn retries. Standing up belongs to the doors — `whitehartlane run` and `whl` — never to the chat itself.

`run` reads the folder you pass and writes the Job under the session disk. The source is code and config. A run does not write it. Hook commands in the Job dir are absolute paths back to that source. The chat's materialize still copies a hooks folder.

A Job started this way can finish with no person in the loop. A dead orchestrator still waits: continue or abort. Promote is never part of the Job.

## Rails — machinery every workflow uses and none may rewrite

- **One Rail class (`src/rail.ts`).** The shared machinery every
  orchestrator runs on: the Job ledger, pane bookkeeping (birth,
  session booking, retire, the receipt), layout, the verbose lane,
  the permission sweep, and the run envelope's shared verbs — the
  booked-wait (`rail.bookedWait`, one spelling for fan-out units and
  coworker members) and the drain registration (`installDrain`).
  `bin/orchestrator` is the one thin entry that constructs one `Rail`
  and picks the engine by the staged program's shape (`src/engine.ts`)
  — kind-blind beyond that single pick: SIGTERM is one protocol for
  every shape (every engine registers a drain hook — fan-out,
  coworker, and lab alike drain to their own boundary and park;
  sessions stay booked either way), and every verb that hands a Job to
  a runner process goes through `spawnRunner`/`rebirthRunner`
  (`src/levy.ts`) — one door resolution, one rebirth ceremony. The
  fan-out engine (`runOrchestrator`) speaks the port the Rail
  implements and drives its chain through ONE object
  (`src/orchestrator-chain.ts`): the wave order, the frontier
  predicate, unreachability, and the step-finish ceremony (one settle
  card, one event, one report row) live there, and check polling,
  stage gates, and wake levies are kind-specific step executors one
  walker dispatches — not three machines each hand-rolling the walk.
  Engines address workers by name only — every shep/herdr
  call funnels through the Rail's injected runners, so the day panes
  become remote machines, the swap is one file and the engines do not
  change.
- **The trace.** One `events.jsonl` per session, append-only, the
  single source. `job.json` and `report.json` are projections
  (`projectJob` rebuilds them from events); the task dir's unit
  lifecycle lives in its one append-only ledger
  (`checkpoints.jsonl`). Event kinds:
  `route, admit, reject, job.born, job.orphaned, job.relaunched,
  pane.born, pane.died, reprompt, backpressure, unit.finished,
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
  and the gray zone (inside home, outside roots) is a jev question,
  not a flat no: a tuned typed judgment (`tunedPermissionJudge`)
  reads the ask plus the member's brief and allows what is plausibly
  needed for the task (a vista job reads its session shots) — a dead
  jev fails restrictive. The prompt and threshold it asks with are
  the jev-tuner's landed winner (`src/jev-prompts/`, read live,
  compiled fallback), so tuning lands without a deploy. And a repeat
  ask for the same non-dangerous path escalates to a durable allow:
  persistence is the asserted need, covering the judge's misses;
  hard-deny never escalates. The dialog's path is NORMALIZED first —
  `~` forms, home-stripped renderings, trailing slashes all key one
  path (j-2b508e: one ask in two forms split the ladder and flipped
  the deny's reason) — and the deny guidance reaches idle panes every
  cycle: a note queued while the pane was blocked is flushed on the
  next beat, in every workflow. The Rail applies the verdict (dialog
  cleared, message injected, root made durable on allow), books a
  `permission` event, and caps the DENIES — over `PERMISSION_CAP` (6)
  deny-family answers the worker is done (allows spend nothing: a
  working member touching legitimately-needed outside-roots paths
  must not die at the cap). Fan-out finishes the unit blocked,
  coworker ends the member, lab finishes the mock blocked. The sweep
  is RAIL-OWNED (`rail.tickPrivilege()`): one tick answers every
  blocked pane the rail holds — engines no longer choose which panes
  get swept, and a pane no engine owns (not born through a worker
  birth path) that hits the cap is retired by the rail itself.
  No mind is woken anywhere: a workflow earns an agent pane only
  when a runtime judgment is needed that no typed gate can hold AND
  its output has a consumed channel — no workflow passes (the actor's
  `protocol.json`
  is the one consumed judgment channel). The window
  (http://127.0.0.1:8787) is the engine's viewer; the log itself lives
  at `<job>/run/orchestrator.log` — no lane pane, no tailing mind.
  Members may also pre-declare
  external roots in `workflow.toml` (`roots = ["~/.vista"]` under
  `[members.<name>]`) — granted at session start, those dialogs never
  fire at all.
  With this, worker permissions are restrictive by default: no
  dialog ever waits for a person — in every workflow, not just
  coworker.
- **Fail recovery, both halves.** Detect: `audit` (unadmitted panes),
  `sweep` (running Job, dead orchestrator pid). Recover, ask-first: a
  dead orchestrator parks the Job `orphaned` in a derived queue —
  announced on the periodic check, never a wake, never
  auto-resurrected (what you killed stays killed); graceful stops pause
  or abort and never orphan. `pause` drains to the workflow's boundary
  and books `paused` (ADR 5); `abort` kills now (SIGKILL — booked
  sessions survive); `continue` is user-decided, retires stragglers of
  the parked generation first, and rebirths unfinished work from booked
  session pointers — never capped, a soft `continued ×N` counter. The
  lab drains to quiescence (no mock in flight, the actor not
  mid-turn) and its continue resumes the actor's booked session — the
  experiment's one mind — plus every in-flight mock's.
- **Backpressure and the retry cap.** Backpressure is the provider's
  refusal treated as information: the hook classifies (exit 75 =
  refused/slowed; anything else is deterministic), the rail retries —
  refusal only, exponential backoff with jitter, hard cap (3), a
  visible line per wait, a `backpressure` trace event. Hand-set
  concurrency (slots) is NOT backpressure; the rail guarantees only
  that a cap exists and is honored. Every retry surface in the system
  is capped the same way: spawn attempts (3), grace reprompt (once),
  provider refusals (3).
- **The session disk and bindings.** `~/.local/share/whitehartlane`
  (AGENTIC_OS_HOME). A First Mate chat is keyed on the host session.
  A CLI start is keyed on `(whitehartlane, folder path)`. A host session
  is the agent's own conversation; the Session stores a pointer, never
  the bytes. Project bindings are confirmed once per session. A live
  worktree is never double-bound.
- **Scope hygiene.** Tests and live runs never share a shep scope
  (`SHEP_SCOPE`); test homes are temp dirs.

## Hooks — the per-task surface a planner may write

- `units` (decompose the task), `brief` (worker instructions),
  `grade` (finish a unit), `report.where` + `counts` (named counts),
  `slots` (per-task concurrency, default 2).
- Hook commands run as `sh -c "<command> '<argument>'"` — positional
  `$1` is only real inside a script FILE (`bash hooks/grade.sh` gets
  `$1`); an inline command (`grade = "test -s units/$1/result.md"`)
  sees `$1` empty. Inline needs a shell function:
  `grade = "g() { test -s units/$1/result.md; }; g"`.
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
- `gates` — the legacy lab spell: one command per `does: "gate"` step
  in a lab program — `spur.mjs` (a legacy `dag.mjs` is read with a
  loud warning, ADR 0009); prints `done` when the step may finish. The
  run door refuses a gate step with no matching `[gates]` command —
  nothing is booked. The current grammar is `[[step]]` with
  `finished_by = "check"` — a command exits 0 and the step finishes
  (ADR 0007); `[gates]` remains for legacy-shaped lab programs. Reopen,
  retry, and the report still belong to `tick` and the rail.
- `roots.txt` — a program's named extra worker roots, one absolute
  path per line, staged beside the spur; the rail folds them into the
  per-run worker permissions. The rail knows no program's env names.
- Named as command strings in `workflow.toml`. A path may be absolute.
  A `hooks/` folder beside the toml is a copy convention, not the
  contract. The chat's materialize copies that folder into `run/hooks/`
  so a live Job cannot edit the source. `run` does not copy the scripts.
  It points at them. Hooks may vary per task; rails may not.
- Hook contract for the planner hook: STRICT JSONL on stdout; exit 75
  = provider refusal (the rail retries), other nonzero = deterministic
  (fail fast).
- The grade contract (#144): a FAILING grade must say why — its first
  stdout line is the verdict row. Silence + non-zero exit is a
  **grade-fault** (broken path, dead container, race): one immediate
  retry, then a `grade-fault: …` row that can never be read as an
  answer failure, never trips the canary (the gate judges plans, not
  hooks), and lands on the stage ledger (`run/checkpoints.jsonl`,
  append-only, one line per stage transition) as a card `regrade` can
  re-enter. `whl regrade <jid>` re-runs ONLY the grade for failed
  units whose worker output survives (the `done` marker is the
  ticket); units without output are named needsRerun — a fresh booking
  (state.json spares the done units) is their path, never a guess. A
  grade hook that declares `--check` in its source runs it ONCE at
  admission — a broken hook dies before the run, not two seconds
  after the worker finishes (the arm-e night: 41/41 hooks exit-127'd
  in ~13ms wearing answer-failure labels; 28 were verifier-passes).

## Classified on purpose

- `slots` is a **hook**, not a rail: the per-task tunable may change
  per Job. What is rail: a cap exists and the ledger honors it.
- The orchestrator's layout is a **hook-shaped choice of the
  workflow** (fan-out's tab is fan-out's business), but the pane
  ledger it reports into is rail.
- Direct has **no retry rail at all** — the open chat is the
  supervisor; a blocked turn is visible and the user resends.
  Unattended work belongs to a Job, not Direct.
- herdr CAN place panes deliberately (`pane split` takes a target
  PANE_ID; `tab create` takes `--workspace`) — the rail must always
  ask, never let a birth land "wherever herdr is focused". The fork
  ladder (spool → parent-pane → fork) uses the booked pane as the
  split anchor and its id prefix as the workspace; a borrowed tab is
  never closed by the courier's reaper (2026-10-17, ADR 0008
  amendment).
