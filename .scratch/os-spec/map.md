# Agentic OS spec

## Destination

A spec of the TUI, written for the user on this machine inside herdr. A later session builds it. This map locks the choices that spec still needs. It does not build the TUI.

## Notes

Domain language is `CONTEXT.md`. Source notes are `research/glossary-sources.md`. Skills: grilling, domain-modeling. Do not collapse scheduler, workflow, jev, pane, or shep.

Standing facts: the front door is a pi TUI. It does not do the task. It stands up a workflow of sub-panes. `shep` only opens and closes panes. Jev is the cheap judgment, not an agent. Backpressure is the workflow obeying a provider refusal or a slow reply, then probing before it opens calls again. A hand-set cap is not this. Leader-or-not is a field of the workflow, not a system-wide choice.

The fleet template is a prototype, not the spec. It showed the pain: a new project rewrites the watcher or the operator, and that breaks. The shared rule is not a shared orchestrator. A workflow receives an input and must produce an output. Orchestrator method is per workflow: agent, script, or jev. Retries have a hard cap so a token limit cannot flood. Fail recovery the user wants to keep already lives in `shep`. Pane ownership stays the `shep` ledger. The ledger may later point at a chosen file. This spec describes two workflows: fan-out, and direct. A third workflow is not in this spec. Jev picks fan-out when the task is independent units. Otherwise it picks direct. Fan-out's orchestrator in this spec is a script. It spawns, grades, and settles. If it cannot decide, it wakes the user. Direct's orchestrator is a script. The happy path is one worker the user talks to. Output is a file in the task directory. A capped failure record is still output. The product retry maximum is 3. The `shep` ledger lists panes only. Layout belongs to the workflow. Fan-out: second tab, orchestrator lane, at most 3 worker panes, then a new tab. Direct: hide the machinery. The user talks to the worker as if it were opencode or pi. The spec requires that feeling. It does not choose the trick. The spec's examples are small: three independent lookups, and one direct coding task. The seller-name campaign is not the example. It is a real job the same fan-out must be able to run as a test.

## Decisions so far

- [Zen 1](../../docs/zen/2026-09-29-zen-1.md) — the gate is pane birth, not task entry. First Mate is the shell; Session/Job/Pane is the object model; answers happen in panes; one worktree per session. Supersedes the task-gate and the always-intercept prompt gate.
- [Front door spec](spec.md) — the choices this map locked. Direct has no finish. Fan-out ends in a report.
- [Hook contract] — manifest + scripts. `workflow.toml` in the task directory names the workflow, the worker kind, and the units, grade, and counts commands. Any language. A unit carries its own brief.
- [Orchestrator host] — detached script (the campaign's launchd pattern) plus a recorded pane tailing its log via `shep record`. No agent wraps the rail.
- [Direct machinery] — full: the front door resubmits a failed turn up to the cap and says "Stopped after 3 retries." in the same chat. Build it in the TUI phase.
- [Verification] — real panes via `shep` at the fan-out and campaign phases; verify-to-zero quoted after each. The repo pushes to origin at each phase milestone.

## Not yet specified

## Out of scope

- Building the TUI in this effort.
- Rewriting `shep` into the product. `shep` stays the pane toolbox.
- A release for anyone other than the user on this machine.
- A million-agent cluster, or leader election.
- A third workflow. Fan-out and direct are the two this spec describes.
