# ADR 0011 — Rename agentic-os → WhiteHartLane

Date: 2026-10-14
Status: accepted

## Context

The repo goes public as an interview showcase. `agentic-os` is not ownable: ~6.8k
GitHub search hits, multiple literal-name repos (one a competing multi-agent
orchestrator for opencode), and the npm name is taken. `whitehartlane` had zero
GitHub repos and was free on npm (checked 2026-10-13). The internal vocabulary
was already themed — the `spur` rail, the `levy` wake, the `whl` door — so the
rename makes the domain language coherent rather than decorative.

Machine-side, the folder rename (`Agentic-Workspace/agentic-os` → `whitehartlane`)
landed 2026-10-13 (ticket 02, Phase 1). This ADR records the in-repo decisions.

## Decision

Rename every **name-bearing surface** to WhiteHartLane (prose) / `whitehartlane`
(machine tokens: package name, CLI, paths, URLs):

- `package.json` name; `bin/agentic-os` → `bin/whitehartlane` (the `whl` shim now
  execs the new door); user-facing strings (rail continue hint, staged workflow
  header, `host.tool` session label); window UI title/wordmark; README H1
  (`WhiteHartLane — deterministic supervisor for coding agents`) with a "formerly
  agentic-os" note; living docs (CONTEXT, GOAL, RAILS, PRDs, research, skill).

**Data continuity follows the ADR 0009 pattern — read both, write the new
spelling:**

- The OS disk default is `~/.local/share/whitehartlane`; a legacy
  `~/.local/share/agentic-os` disk still wins while it is the only one that
  exists (`src/store.ts`, `src/project.ts`, `web/server.mjs`). Live disks keep
  their trace; fresh installs get the new name. Migrating the dir is a later,
  optional machine task — the fallback makes it safe either way.
- The global manifest prefers `~/.config/whitehartlane/workflow.toml` and still
  honors `~/.config/agentic-os/workflow.toml` (`src/hooks.ts`).

## What is deliberately NOT renamed here (deferred)

- **`AGENTIC_OS_*` env prefix** — 36 distinct names, some *dynamically
  constructed* (`AGENTIC_OS_BIRTH_*`, backoff helpers that take whole var names
  as parameters). A mechanical codemod mixed into a branding PR is how subtle
  misses happen; the prefix is invisible to the brand. Tracked in
  `docs/tickets/03-whl-env-migration.md` (WHL_* primary, AGENTIC_OS_* back-compat
  read, one helper seam).
- **`customType` message tags** (`agentic-os-jobs` etc. in the pi extension) —
  internal labels, nothing matches on them.
- **launchd job name** (`agentic-os-window`, label `local.agentic-os.window`) —
  machine-local, not repo content; renaming means a new plist + label + registry
  entry.
- **History is frozen**: ADRs, zen logs, tickets 01–02, and `examples/` keep the
  old name — they are records of what happened, not claims about today.

## Consequences

- Same tool, same trace: existing disks, sessions, and wakes carry over through
  the read-both fallbacks.
- Transcripts record `host.tool: "whitehartlane"` for new sessions; old
  transcripts keep `agentic-os` — correct, they are history.
- The web UI theme key moved (`agentic-os-theme` → `whl-theme`): one theme
  preference reset per browser.
- Machine follow-ups after merge: re-point `~/.local/bin` symlinks (the old
  `agentic-os` symlink is already dangling post-folder-rename), add
  `~/.local/bin/whitehartlane`, bounce the window server for the new
  `server.mjs`.
