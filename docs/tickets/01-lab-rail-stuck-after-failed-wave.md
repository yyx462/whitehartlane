# Lab rail stuck after a fully-failed wave: retry protocols never reopen, dead students probed forever

**Blocked by:** (none)

## Summary

Lab job `j-ed6dbb` (workflow `skill-desc-rounds`) is wedged in `running`
with the wave closed: all 5 students finished (`done` lines + commits
landed), grading settled, the professor was prompted and wrote a retry
protocol — and nothing further happened. Three defects chain into the
stuck state; the first poisons the grade, the second makes the retry a
no-op, the third is the loud forever-loop that masks the silence.

## Job details

| Field | Value |
|---|---|
| jid | `j-ed6dbb` (state `running`, panes 5/7) |
| session | `s-fd413f` |
| workflow | lab, `p-62499c/skill-desc-rounds` v`b22ace6e80ab` |
| program | `~/work/skill-desc-lab/labs/skill-desc-rounds` @ `a4efdde` (committed in the target worktree, as yyx-whl prescribes) |
| target worktree | `~/work/skill-desc-lab` (branch `skill-desc-lab`, gwt) |
| run dir | `~/.local/share/agentic-os/sessions/s-fd413f/jobs/j-ed6dbb/run` |
| trace | `~/.local/share/agentic-os/sessions/s-fd413f/events.jsonl` |

Timeline (UTC, 2026-10-09): 06:34:05 rail + actor born · 06:34:30–48
protocol round 1, 5 students born · 06:36:21–06:42:01 five
`pane.died` (students done) · 06:41:58 rail grades all 5 · 06:42:31
`rail prompt actor` · 06:43:06 professor rewrites protocol.json (same
unit ids) · since then: silence + probe spam, job never ends, no wake.

## Finding 1 — `project.json` mint dirties the program folder's worktree

`whl run` warned: `no project.json in …/labs/skill-desc-rounds — minted
p-62499c and wrote it there` (`ensureProject`, src/project.ts, called
from src/run.ts:132-133). The program folder lives **inside the gwt
worktree the job itself edits**, so the mint leaves the branch
permanently dirty:

```
$ git -C ~/work/skill-desc-lab status --porcelain
?? labs/skill-desc-rounds/project.json
```

The program's grade gate requires a clean tree (a normal contract for
"students commit everything"). All 5 students did perfect work — every
description check passed — yet every `units/*/grade.txt` reads exactly:

```
worktree has uncommitted changes: ?? labs/skill-desc-rounds/project.json
```

Any retry fails identically: a livelock the tenants cannot escape (the
professor is forbidden from touching the worktree, students are
forbidden from touching `labs/`).

**Fix direction:** mint identity on the OS disk (session/job record),
or into the staged run copy — never into a source tree that may be a
git worktree. If in-source minting stays, exclude it from dirtying
(gitignore write is still a write into the tenant tree — prefer OS
disk).

## Finding 2 — retry waves with the same unit ids can never reopen

The professor was prompted (06:42:31) and correctly re-emitted the
failed units (06:43:06) — same ids, same briefs. But:

```js
// bin/lab-orchestrator:814
const waveKey = signal.wave.units.map((unit) => unit.id).join(",")
```

`waveKey` is id-only, so a retry protocol is indistinguishable from the
wave already opened: `tick` sees `waveKey === openedWave`, never emits
`reopen`/`birth-wave`, no students are reborn. The rail-actor contract
("re-emit ONLY the failed unit ids") is thus impossible to satisfy
unless the professor invents fresh ids per retry — an invariant nothing
documents or enforces.

**Fix direction:** key reopen on content (ids + briefs hash), or add an
explicit wave nonce/round field to protocol.json the professor bumps;
at minimum, document "retry ⇒ new ids" in the actor brief conventions
the rail itself writes.

## Finding 3 — dead students probed forever (`agent_not_found` loop)

After the students' panes died (five `pane.died` events), the rail has
been polling their agents non-stop: 110+ (and growing ~1/s)
`{"code":"agent_not_found","message":"agent target
mock-r1-desc-<id>-mv0lauzn not found"}` (`cli:agent:get`) in
orchestrator.log. A dead pane is an ended student; the rail should
treat herdr liveness=gone as a terminal end, not keep asking the agent
registry forever. The spam also buries the real story (prompt fired,
protocol rewritten, then silence) — the log tail looks like the probe
loop IS the job.

**Fix direction:** photograph marks panes dead via herdr as ends (once,
not per beat); optionally a deadman — N minutes with zero live ends and
no wave movement ⇒ park the job (pause), so a wedged run surfaces
instead of churning.

## Acceptance

1. A lab program committed inside the gwt worktree it targets never
   leaves that worktree dirty after `whl run` (no in-source mint).
2. Professor retries a failed wave with identical unit ids ⇒ students
   are reborn and the wave reopens (or the rail rejects the protocol
   with a structured error telling the professor how to retry).
3. No `agent_not_found` probe loop after `pane.died`; a wave whose
   students are all dead and grades settled either proceeds (retry
   opens) or parks the job — never spins.
4. Repro shape for the suite: program folder in a gwt worktree,
   clean-tree grade gate, one forced failure, same-id retry.

## Notes

- Job left running as evidence (`whl pause j-ed6dbb` / `whl abort
  j-ed6dbb` when triaged). Round-1 work on branch `skill-desc-lab` is
  complete and committed; only the poisoned clean-tree check failed.
- This is the first `docs/tickets/` entry in agentic-os (regulated
  home per yyxSkills `docs/agents/repo-layout.md`); AGENTS.md stamped.
