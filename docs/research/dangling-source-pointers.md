# Dangling dag source pointers

Status: option 2 **implemented** (v5.2, operator-approved 2026-10-09 —
"each job is just some text, having a copy is not a problem"; and no
new copies were even needed). Option 4 (deleting runs/sessions) stays
parked with its guardrails below. Nothing in this note was implemented
blindly on the first night — the operator explicitly held it to
discussion until the storage question was settled.

## The problem

Every Job records its dag identity, and that record includes `source` —
an absolute path into the worktree the program ran from:

```json
"dag": {
  "project": "p-fd72b2",
  "dag_id": "ui-window",
  "content_hash": "1e952af1af92",
  "source": "/Users/…/WhiteHartLane/coworker/examples/agentic-program/ui-window"
}
```

`gwt` merges a lane and removes the worktree → the path is gone → the
window's Dag Status can no longer read the dag definition from "the live
source": `/api/dag-definition` answers `400 folder does not exist`,
the diagram tab dies, and Trigger refuses. The trace (events, runs,
receipts, reports) is untouched — only the source pointer dangles. In
the vocabulary of this repo: paths are never identity, but the *display*
still leans on one path.

This is not hypothetical: `web/server.mjs` shipped with `RUN_DOOR`
hard-wired to the `ui-pause` worktree, which was later merged and
removed — every Trigger / Pause / Abort / Continue from the window broke
with `could not run the door` until the door was made to resolve
relative to the server itself (fixed separately; same disease, one
level down).

## What already survives (read this before proposing anything)

The run door **stages a copy of the program** into the Job dir:
`sessions/<sid>/jobs/<jid>/run/` holds `workflow.toml`, `members/*.md`,
`dag.mjs`, `project.json` for the life of the OS disk. So when the
source worktree disappears:

- `/api/dag-shape/<sid>/<jid>` still parses the staged copy — per-run
  diagrams keep working.
- `project.json` (the pid) travels with every copy, so runs still group
  under one Project wherever the folder lived or lives.
- Only the *live* dag-definition view (source folder) and Trigger
  (needs a runnable folder) actually break.

In other words: the OS already keeps the bytes it needs per run. What
dangles is the *convenience* view of "the current source", not the
trace.

## Options weighed

1. **Do nothing (today).** The definition view dies loudly with an
   honest `folder does not exist: …`. Acceptable; ugly.

2. **Read-only fallback for display (IMPLEMENTED in v5.2).** When
   `sourceFolderError(g.source)` fires, `/api/dag-definition` serves the
   NEWEST run's staged copy marked `stale: {reason, fromSid, fromRun,
   runDir}`; the UI shows the amber "source folder gone" bar naming the
   run it is reading. Trigger and Run-with-edits keep refusing with the
   honest sentence; `/api/program` lists nothing editable and PUTs
   refuse. Zero writes, zero deletions, fully reversible. Proved by
   `test/web-definition-fallback.test.ts`: fixture OS disk, dangling
   source, newest-staged-run-wins, trigger 400, program PUT 400, and a
   full mtime/size snapshot of the disk identical before/after — the
   fallback cannot write, and the test says so forever.

3. **Snapshot every source into the OS disk on run** — rejected by the
   operator: too much storage, and it duplicates what the staged run
   dir already keeps.

4. **Delete runs/sessions whose source is gone** — the dangerous one,
   explicitly parked. Reasons it is dangerous:
   - `sessions/<sid>/events.jsonl` is the trace, the single source the
     whole OS is built on. A run with a dangling source still has a
     *valid* trace; deleting it destroys history to fix a display itch.
   - Sessions hold more than the one dag (a session key can outlive
     many jobs); cascading from "one path gone" to "remove the session"
     can wipe unrelated traces.
   - Any bug in the predicate ("does this run's source exist?") turns
     into unrecoverable data loss. `rm -rf` under `~/.local/share` has
     no dry run.

   If this is ever picked up, it must come with, at minimum:
   - a `--dry-run` that prints the exact list (sid, jid, bytes) first;
   - typed confirmation by id, not y/N;
   - a fixture test that runs against a temp `OS_ROOT` (fabricated
     sessions, one with a removed source, one with a live source) and
     asserts the live one is untouched — mtime snapshot before/after;
   - an escape hatch: events.jsonl archived (tar) before any delete.

## The test question ("how can we test it without trying?")

Answered for option 2: `test/web-definition-fallback.test.ts` runs the
whole server against a fixture `AGENTIC_OS_ROOT` in a tmpdir (env escape
hatch added for exactly this), fabricates a dag group whose `source`
points at a deleted folder plus two staged runs, and asserts the
fallback definition arrives with `stale`, the NEWEST run wins, Trigger
and program writes refuse, and **no file anywhere under the OS root
changed** (mtime/size snapshot before and after every request). That
test runs in the normal suite with zero risk because the server only
ever reads.

For option 4 there is still no such thing as a safe try on the real
disk; the fixture OS_ROOT is the only honest test bed, and the fixture
must include the "session holds two jobs, one dangling one live" case.

## Related facts on disk today

- `coworker` and `jd-research` worktrees are merged; `gwt audit`
  verdicts them REMOVE. They were **kept** on purpose this session so
  the ui-window dag's source keeps resolving while this discussion is
  open. When they are reaped, `/api/dag-definition/p-fd72b2/ui-window`
  will 400 — and that will be the live specimen for this problem.
- The staged copies that would feed option 2 exist for every ui-window
  run under `sessions/s-fcbcbd/jobs/j-*/run/`.
