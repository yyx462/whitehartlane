# Runbook — Terminal-Bench paired pass (phase 1a)

Operational companion to `docs/plans/eval-vs-single-agent.md` (phase 1a,
issue #106). One-shot per pass; regenerate, never status. The benchmark
is Terminal-Bench 2.0 (arXiv:2601.11868; 89 tasks; Docker harness
built to drive external terminal agents — survey in
`docs/research/eval-landscape.md`).

## What a TB2 task actually is (worked example)

Every task is a folder: `task.toml` (metadata + caps), `instruction.md`
(the whole prompt), `environment/` (Docker setup), `solution/` (a
human-written oracle proving solvability), `tests/` (a pytest verifier
with canary GUID anti-training markers). Real example, `git-leak-recovery`
(medium, software-engineering):

- **instruction.md**: "A secret was accidentally committed to this
  repository in /app and then removed by rewriting history. 1. recover
  the secret and write it to /app/secret.txt. 2. clean up the secret…
  3. make sure irrelevant files and commit messages remain untouched."
- **task.toml**: estimated_duration 45 s (oracle); expert 30 min /
  junior 60 min; agent + verifier timeouts 900 s; 1 CPU, 2 GB RAM,
  10 GB disk; `allow_internet = true` (per-task policy); pinned image.
- **tests/test_outputs.py**: pytest asserts the flag file content
  exactly, `git log --all -S 'secret['` finds nothing, and legitimate
  commits survive — binary reward 0/1 from final container state.

The harness lifecycle: pull image → container up → the agent (installed
in-container, `BaseInstalledAgent`-style — claude-code and terminus-2
are the reference patterns) reads the instruction and works the
terminal → timeout → verifier runs in the same container → 0/1.
Leaderboard entries are **harness × model**: the same model (GLM-5.1)
scores 63.5 under terminus vs 69 under claude-code on the official
board — harness variation at fixed model, visible, several points wide.
That is precisely the variation our arms isolate. With n=89, a
resolution-rate CI runs roughly ±10 pts — the plan's small-n rule.

## The invariant: one solver, two loops

This runbook covers arms A/B/C — the rails pass (T1). The levy seat
(arm E, T2′: an entry agent with the skill deciding how to split) is a
SEPARATE pass (plan §0 T2′, its own issue) — do not bolt it onto this
one; it would break the invariant below.

Every byte the model sees is identical across arms — same instruction
file, same container, same verifier, same model pin, same CLI version.
The ONLY difference is who runs the loop:

- **Arm A (bare):** a person's shell runs `solve-one.sh` N times,
  sequentially, watched.
- **Arm C (fleet):** `agentic-os run tbench-fleet` — same tasks as
  units, workers in panes, slots=2, unattended.
- **Arm B (rail):** arm C's program with `slots = 1` — the rail effect
  with the parallelism variable removed. Run it on the rehearsal set
  first; promote to the full set only if B vs A shows anything.

If a result can't be traced back to this invariant, it's not a result.

## T-1 · Preparation (zero API spend)

1. **Freeze the program.** `prep/tasks.json` (task id list, seed
   recorded), `prep/manifest.json`:
   ```json
   { "model": "<provider/model-id>", "model_date": "2026-10-14",
     "opencode": "<version>", "tb": "<version>", "docker": "<version>",
     "arch": "arm64", "per_task_cap_min": 30, "per_task_cap_usd": 3.0,
     "retry_cap": 3, "slots": 2 }
   ```
   A provider-side model change freezes the pass (plan §2.1).
2. **Smoke the harness without a model.** Run tb's oracle agent on 2
   frozen tasks. Both must pass. This proves container + verifier work
   before any model is paid for. Record outputs in `ledger/prep/`.
   **Fresh container per attempt, always** — tasks mutate their own
   state (git-leak-recovery rewrites history); a reused container is a
   spoiled measurement. `open.sh` starts from the pinned image every
   time; per-task policies (e.g. `allow_internet`) come from task.toml
   and are recorded, never overridden.
3. **Bake the instruction files — ONE prompt source.**
   `prep/task-instructions/<id>.md` = the task's instruction +
   a standard environment preamble (how to start the env, how to work
   inside). BOTH arms present exactly this file as the prompt:
   ```
   # <task id>

   <instruction from task.yaml>

   ## Environment
   Your task environment is not running yet. Start it with:
     bash /abs/path/to/program/scripts/open.sh <id>
   Work inside it with `docker exec`. You may not modify the tests.
   When you believe the task is done, write `done` on its own line to
   log.txt in your working directory.
   ```
   Arm A's runner reads this file as the prompt; arm C's `units` hook
   pastes it as the brief. Prompt bytes identical, by construction.
4. **Write the shims** (`scripts/` beside workflow.toml):
   - `open.sh <id>` — start the task's container env; idempotent.
   - `verify.sh <id>` — run the task's official tests; exit 0 =
     resolved. NEVER called by the worker, only by the grader.
   - `solve-one.sh <id>` — the arm-A runner: `open.sh`; then
     `opencode run --model "$PIN" -p "$(cat task-instructions/<id>.md)"`
     with the workspace reachable; then leave the container in place.
   - `collect.sh <arm>` — copy tb output, events.jsonl, report.json,
     usage.json, orchestrator.log into `ledger/<arm>/`.
5. **Write the program folder** `tbench-fleet/`:
   ```toml
   [workflow]
   name = "tbench-fleet"
   worker_kind = "opencode"
   slots = 2

   [hooks]
   units = "bash hooks/units.sh"
   grade = "bash hooks/grade.sh"
   counts = "bash hooks/counts.sh"

   [report]
   where = "units/"
   ```
   - `units.sh`: one JSONL line per frozen task,
     `{"id":"<tb-id>","brief":"<contents of task-instructions/<id>.md>"}`
     (ids shep-safe: `[a-z][a-z0-9_-]{0,31}` — sanitize, keep a map in
     `prep/ids.json`).
   - `grade.sh`: `bash scripts/verify.sh "$1"`; exit 0 = resolved; the
     first stdout line is the report row.
   - `counts.sh`: `{resolved: n, failed: n}` over the table.
   - `roots.txt`: the program scripts dir (workers must run open.sh)
     and the docker CLI path if it lives outside default roots.
6. **Print the rubric.** The intervention-count form for arm A
     (plan §4): one row per task — "resend / unstick / permission /
     other", timed. The same rubric the extractor (#105) implements
     for the OS arms.

## T-0 · Rehearsal — the mock pass (3 tasks, both arms, one evening)

The dress rehearsal is the real first run, at toy scale. Its job:
validate every pipe, calibrate cost, and produce the first paired
numbers — badly, cheaply.

1. Pick 3 rehearsal tasks (one easy, one mid, one hard — oracle
   timings help). They are calibration tasks forever after: tuning is
   allowed HERE, never on the scored set (plan §2.4).
2. **Arm A, by hand:** run `solve-one.sh` ×3 in a `script`-recorded
   shell; fill the rubric per task; run `verify.sh` after each
   yourself. Any pipe snag (auth, docker perms, path escaping) gets
   fixed HERE.
3. **Arm B, one task:** `slots = 1`, single unit — proves the program
   folder runs end to end under the rail (grade green, report row
   lands, receipt fires, one wake arrives).
4. **Arm C, 3 units:** `agentic-os run tbench-fleet` (units cut to the
   rehearsal 3). Walk away. On the wake: `collect.sh arm-c`.
5. **Check the invariant:** diff each arm's prompt bytes against
   `task-instructions/<id>.md`; diff container images; confirm
   verifier logs are byte-identical in procedure (same tests ran).
6. **Extrapolate:** tokens/task × 89 × arms (from usage.json, #104) →
   the full-pass budget; wall-clock × 89/2 → the fleet day estimate.
   If the number is ugly, THIS is where the pass gets rescoped —
   subset the frozen list, record the subset, never quietly.

Abort criteria (any): oracle smoke fails; grade.sh green on an
untouched container (verifier broken); prompt-byte diff nonzero;
worker can't reach `open.sh` after roots.txt. Fix and redo the
rehearsal — the scored pass inherits nothing from a broken rehearsal.

## T+1 · The scored pass

1. **Arm A** (morning, fresh machine): `solve-one.sh` over the scored
   list, sequential, rubric filled per task. No fixing mid-task — a
   stuck agent is a stuck agent; record, move on. Caps are enforced by
   the runner (`timeout`, token limit); a capped task is a recorded
   failure (plan §2.3), never excluded.
2. **Between arms:** `docker system prune -f`; same machine, no other
   jobs (one-Job rule); note ambient in the ledger (time, load).
3. **Arm C:** full units list, `agentic-os run`, laptop closes. One
   wake expected. `collect.sh arm-c`.
4. **Failure re-runs (k=3)**: only tasks that failed in either arm,
   same seeds/pins, both arms re-run on the same subset (pairs stay
   paired).
5. Nothing else changes. No prompt edits between arms — if a fix is
   discovered, the pass restarts (that is the price of the invariant).

## T+2 · Assembly

1. `ledger/pairing.csv`: task × arm → resolved, tokens, cost,
   wall-clock, interventions, failure code.
2. Stats per plan: McNemar on paired outcomes (H1); attention metrics
   from the extractor vs the rubric (H3); wall-clock vs the §1 H4
   bound; caps hit (H6 for arm B vs A).
3. MAST-code every failure + rail-gap/harness-gap (plan §6); 20%
   double-coded.
4. Write `docs/research/results-tbench-<date>.md`: wins and losses
   with the same prominence (plan §8). Numbers only the CI can carry;
   no leaderboard comparisons (contamination is shared, absolutes are
   not ours to claim).

## What each artifact is for

| Artifact | Proves |
|---|---|
| `prep/manifest.json` | iso-model / iso-harness / iso-budget held |
| `prep/task-instructions/*` | one prompt source, byte-diffable |
| oracle smoke logs | verifier was healthy before spending |
| `script` session log (arm A) | interventions countable by rubric |
| `events.jsonl` (arm C) | interventions/attention/wall-clock extractable |
| `usage.json` (#104) | tokens & cost per task per arm |
| `ledger/pairing.csv` | the paired table every hypothesis reads |
| results doc | the honest write-up, precedents set by plan §8 |
