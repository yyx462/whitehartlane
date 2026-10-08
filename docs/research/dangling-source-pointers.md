# Dangling dag source pointers — a discussion (no implementation)

Status: OPEN DISCUSSION. Nothing below is implemented on purpose — the
operator's call for this session was "discussion only, no
implementation, because it is a dangerous one". This note exists so the
next session starts from the full picture, not from scratch.

## The problem

Every Job records its dag identity, and that record includes `source` —
an absolute path into the worktree the program ran from:

```json
"dag": {
  "project": "p-fd72b2",
  "dag_id": "ui-window",
  "content_hash": "1e952af1af92",
  "source": "/Users/…/agentic-os/coworker/examples/agentic-program/ui-window"
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

2. **Read-only fallback for display (the recommended next step, NOT
   implemented).** When `sourceFolderError(g.source)` fires, fall back
   to the newest run's staged copy for the definition view, marked
   `stale: true` with the run's jid and content_hash. The UI shows an
   amber "source folder gone — showing the staged copy of run j-…" chip;
   Trigger and Run-with-edits stay disabled with that same sentence.
   Zero writes, zero deletions, fully reversible. This solves the
   "dangling display pointer" without storing anything new — the
   snapshot already exists per run.

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

For option 2 (read-only fallback) testing is safe and cheap: a fixture
OS_ROOT in a tmpdir, a fabricated dag group whose `source` points at a
deleted folder, assert the fallback definition arrives with `stale: true`
and that **no file anywhere under the OS_ROOT changed** (mtime/hash
snapshot before and after the request). That test can run in CI with
zero risk because the server only ever reads.

For option 4 there is no such thing as a safe try on the real disk; the
fixture OS_ROOT is the only honest test bed, and the fixture must
include the "session holds two jobs, one dangling one live" case.

## Related facts on disk today

- `coworker` and `jd-research` worktrees are merged; `gwt audit`
  verdicts them REMOVE. They were **kept** on purpose this session so
  the ui-window dag's source keeps resolving while this discussion is
  open. When they are reaped, `/api/dag-definition/p-fd72b2/ui-window`
  will 400 — and that will be the live specimen for this problem.
- The staged copies that would feed option 2 exist for every ui-window
  run under `sessions/s-fcbcbd/jobs/j-*/run/`.
