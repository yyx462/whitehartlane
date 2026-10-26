# STAGES — the chain manual

A workflow is a **chain of stages**. `[[stage]]` table order is execution
order; the rail opens stage N+1 only when stage N settled (and a failed
stage blocks the rest, honestly, as rows). This is the only way ordering
is expressed — "split" is dead (a chain was always the workflow's job,
never a node's: every unit is a fresh worker session; continuity is the
shared task container, which the chain keeps identically).

This is also the **only authoring story** (ADR 0014): `[[step]]`
tables and `hooks.units` (the quick-mint planner hook) are RETIRED —
refused at parse with a pointer here, as is a stage-less fan-out
manifest, the spur step file (`spur.mjs`/`dag.mjs`) at the run door,
and the `[gates]` detector table. Workers are declared, never minted
at runtime; `grade` and `counts` remain the program's own hooks.

```
[workflow]
name = "…"            ; worker_kind, model, slots, canary as ever
                      ; worker_kind = "mock" = DRY-RUN (see below)

[[stage]] …           ; stage 1
[[stage]] …           ; stage 2 — waits for stage 1
[[stage]] …           ; …
```

## The five topologies

**solo** — one briefed worker does the whole stage. The simple link.

**fan-out** — interchangeable parallel workers (shards or independent
attempts); order irrelevant; every unit is a "starting brief" (all fire
at once). Concurrency = `[workflow] slots`.

**coworker** — roles that must TALK. Delegates: members are minted into
a child coworker program under `stages/<id>/` and levied once via the
wake machinery; the child's wake receipt (plus the stage's `check`)
settles the stage. The minted child DECLARES its kind (`kind =
"coworker"`, like a lab child's `kind = "lab"`): the run door
classifies a kind-less manifest as fan-out and refuses a stage-less
fan-out (ADR 0014) — the declaration is the mint's first line, for
both delegated topologies (receipt j-5c1861). No worker pane is born
in the parent rail.

**gate** — no workforce at all: the rail itself executes `run`, once,
at the frontier. Pass opens the next link; fail blocks the chain. This
is where the task verifier lives (`run = "bash verify.sh"`).

**lab** — the experiment: ONE mind (the actor, briefed by the stage's
`brief` → `stages/<id>/actor.md`) composes waves at runtime; `signal`/
`end` detectors observe instead of a done-protocol. Delegates like
coworker (`kind = "lab"` child program, levied once).

## Fields, per topology

Common to all: `id` (required, shep-safe, unique across stage AND unit
ids) and `topology` (required).

**solo**
- `brief` — required. The one worker's whole instruction.
- `check` — optional. The stage's own verdict hook; runs when the
  worker finishes. Never the task verifier.
- `grade` — optional bool. Task-verifier binding (default: the LAST
  unit stage takes it — solo/fan-out are the unit stages).
- `model` — optional. The worker's pin (falls to `[workflow] model`).

**fan-out**
- `units` — required. Array of `{ id, brief, model? }`; each entry is a
  complete worker with its own slice and optional own pin.
- `preamble` — optional. Shared context prepended to EVERY unit's
  brief (authored once, not pasted per entry).
- `check` — optional; runs per finishing unit.
- `grade` — optional bool, as solo.
- `model` — optional. The roster's default pin: every unit without
  its own takes this. Precedence: `unit.model → stage.model →
  workflow.model`, resolved fresh per stage. (A differing pin on the
  CLI spawn transport refuses honestly — per-unit pinning needs the
  fleet-pane path.)

**coworker**
- `members` — required. Array of `{ name, brief, initiates?, model? }`;
  at least two; EXACTLY one `initiates = true` (the starting brief).
- `preamble` — optional. Prepended to every member's brief file.
- `check` — optional. Post-exchange verdict: runs IN-EXCHANGE at the
  stop, before the members retire (the station twin of #198's
  audit-before-retire) — a red check's first stderr line goes back to
  the stop's author for ONE revise round while the panes still live; a
  second red ends the exchange honestly and fails the stage. The
  check's cwd is the PARENT task dir (checks are authored
  parent-relative; promotion checks write into the parent's data/).
- `model` — optional. The child program's pin (defaults to the
  parent's; members may override per-member).

**gate**
- `run` — required. The rail's action, one-shot: pass advances the
  chain, fail blocks it. 300s cap.
- Nothing else applies — no mind exists to brief or check.

**lab**
- `brief` — required. The actor's job text (→ `stages/<id>/actor.md`).
- `signal` — optional. Detector: when the actor's output starts
  counting (the observe verb — see below).
- `end` — optional. Detector: when an observed wave is finished.
- `check` — optional. Post-experiment verdict (after the wake receipt).
- `model` — optional. The child program's pin.

Everything not listed for a topology is REFUSED at parse time with a
why ("refuse, never vanish") — there are no silently ignored fields.

## The four verdict verbs (do not confuse them)

- **`check`** — *judge*: "did THIS stage's workforce do its job?" The
  rail runs it on completion (per unit for worker stages; for coworker,
  in-exchange at the stop — before the members retire, one revise
  round on red; for lab, after the experiment). 120s cap. The check
  runs with `WHL_UNIT` in its env naming the unit (or lab stage) it
  judges — a per-unit hook knows its subject without scanning.
- **`run`** — *act*: "rail, DO this." Gate-only, one-shot. 300s cap.
- **`grade`** — *bind*: "does the TASK verifier ([hooks] grade =
  verify.sh) attach here?" Default: last unit stage only. It is a
  flag, not a command.
- **`signal`/`end`** — *observe*: "has the actor's wave started
  counting / finished yet?" Lab-only detectors, polled — they describe
  the world, they do not change it.

## The brief taxonomy

- **stage brief** — one mind, authored before the run: solo's worker,
  lab's actor.
- **roster brief** — per worker, authored before the run: `units[].brief`,
  `members[].brief`.
- **starting brief** — a ROLE, not a field: whoever must move first
  (the `initiates` member; every fan-out unit; the solo/lab stage
  brief). Ordering lives in the trigger rule, never in brief text.
- **preamble** — the roster's shared part. Effective brief =
  `preamble + own roster entry`.

What IS composed mid-run is the *delivery*: a non-initiator's first
prompt is its roster brief + the relay message that woke it; and any
brief's referenced files carry earlier stages' output (fixed briefs,
dynamic delivery).

## Grade binding (the #150 rule)

The task verifier fires ONLY where a stage says so: the LAST unit
stage (solo/fan-out) by default; `grade = true/false` overrides; a
`gate` with `run = verify.sh` is the explicit final grading link.
Intermediates settle by `check` — verify.sh NEVER fires mid-chain.

## Storage paths — why files, not a map dump

The TOML IS parsed into a map (the manifest), and the map stays the
source of truth. The minted files are not a persistence format — they
are the DELIVERY interface: each worker runtime already reads its brief
from a path its ecosystem defines (opencode/pi panes are briefed from a
file; the coworker runner reads `members/<name>.md`; runLab reads
`actor.md`). One JSON dump of the whole map would make every agent
parse and index a blob it mostly doesn't need; per-consumer files mean
each mind finds exactly its instruction where its runtime looks, a
paused run re-reads the same path, and the child runners work with
zero changes.

```
solo's brief               → units/<id>/brief.md
fan-out unit briefs        → units/<id>/brief.md      (preamble folded in)
coworker effective briefs  → stages/<id>/members/<name>.md  (preamble folded in)
lab's brief                → stages/<id>/actor.md
coworker/lab child program → stages/<id>/workflow.toml
```

## Delivery across delegated stages

The storage paths above carry delivery INTO a coworker/lab child: the
child is staged from `stages/<id>/` at the levy (the frontier), so
whatever earlier stages wrote under `stages/<id>/data/` rides along
(fixed briefs, dynamic delivery — write there, the child reads `data/`).
Delivery OUT of a child rides the stage's `check`: it runs at the
exchange's stop, IN-EXCHANGE — before the member panes retire, with
one revise round on red — and resolves the child's job dir through the
durable booking the wake machinery owns (`wakes/<id>.json`), so the
child's artifacts land in the parent's `data/` — where a later gate can
judge them. The worked receipt is the composite case
(`test/e2e/transfer-window-v2/`): analysts shard into
`stages/negotiate/data/`, the exchange's accept check lands `plan.json`
in `data/` and `stages/scout/data/`, and the final gate's verify.sh
judges everything parent-side.

## Dry-run

`worker_kind = "mock"`: no pane, no agent. The unit's done line lands
beside its brief and the cycle settles it through the real path —
checks, gates, grades all fire. Rehearse any program's shape in
seconds, zero tokens. (The test suite's fake ports have always worked
this way; mock extends it to real runs.)

## A full example

```toml
[workflow]
name = "orders-api"
worker_kind = "opencode"
slots = 2
canary = false

[[stage]]
id = "install"
topology = "solo"
brief = "Install node 22 + better-sqlite3. Write the version to install/version.txt."
check = "test -f units/install/version.txt"

[[stage]]
id = "shard"
topology = "fan-out"
preamble = "SHARED: one JSON row per file → out/<kind>.jsonl."
units = [
  { id = "csv",     brief = "Parse ONLY *.csv in data/." },
  { id = "parquet", brief = "Parse ONLY *.parquet in data/." },
]

[[stage]]
id = "build"
topology = "coworker"
preamble = "Stack: Node 22 + better-sqlite3. Contract: {ok, data}."
members = [
  { name = "backend",  brief = "Schema + /orders endpoints; message frontend when booted.", initiates = true },
  { name = "frontend", brief = "Consume the endpoints backend ships." },
]

[[stage]]
id = "explore"
topology = "lab"
brief = "Direct probes over data/ until one finds >1000 rows."
end = "bash hooks/explorer-end.sh"

[[stage]]
id = "grade"
topology = "gate"
run = "bash hooks/verify.sh"
```
