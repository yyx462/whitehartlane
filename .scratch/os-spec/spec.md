Status: ready-for-agent

# Front door

## Problem Statement

The user can already run a fleet of agents in panes. That fleet works, and its panes are easy to watch. It is a prototype. A new project makes an agent rewrite the watcher or the operator, and that rewrite breaks. The pieces have no shared contract. A hand-set concurrency cap stands in for provider limits. When a run ends, the user does not get one readable answer.

The user wants a TUI on this machine, inside herdr. They type a task. The TUI does not do the task. It stands up a workflow.

## Solution

A pi TUI is the front door. Jev chooses one of two workflows. Fan-out runs independent units and ends in a report. Direct feels like talking to opencode or pi, and does not finish. `shep` opens and closes panes. A project fills hooks. A project does not rewrite the rails.

## User Stories

1. As a user, I want to type a task into the front door, so that I do not have to pick a workflow by hand.
2. As a user, I want the front door to stay a front door, so that it does not become the worker that does my task.
3. As a user, I want jev to pick fan-out when the task is independent units, so that web searches and similar jobs run in parallel.
4. As a user, I want jev to pick direct when the task is not independent units, so that I land in a normal coding-agent chat.
5. As a user, I want the front door to ask me when jev's confidence is low, so that a weak pick does not stand up the wrong workflow.
6. As a user, I want fan-out to open in another tab, so that the front door tab stays mine.
7. As a user, I want fan-out's orchestrator in its own lane, so that I can see the rail without reading worker panes.
8. As a user, I want at most 3 worker panes in the other lane, so that a wide job does not crush the tab.
9. As a user, I want a fourth worker to open a new tab, so that the cap is a layout rule, not a dropped unit.
10. As a user, I want to watch the worker panes while fan-out runs, so that I can see who is stuck.
11. As a user, I want fan-out to finish with a report, so that I can read the result without opening logs.
12. As a user, I want the report to show a status, named counts, a table, and where to check, so that a campaign and a tiny lookup use the same shape.
13. As a user, I want the seller-name test's counts to include chunks done, rows inserted, and the table name, so that a real job is readable.
14. As a user, I want the front door to show that report, so that I do not hunt for it in a pane.
15. As a user, I want direct to hide the orchestrator and the extra panes, so that talking to it feels like talking to opencode or pi.
16. As a user, I want direct to have no finish and no report, so that I stop when I want.
17. As a user, I want a blocked direct worker to be retried, so that a stall does not end in silence.
18. As a user, I want those retries to stop at 3, so that a token limit cannot flood.
19. As a user, I want the worker to say so in the same chat when the cap is hit, so that I learn it failed without a second screen.
20. As a user, I want a new project to fill hooks only, so that an agent cannot rewrite the watcher or the operator.
21. As a user, I want pane ownership to stay in the `shep` ledger, so that the fail recovery I already trust is not rebuilt.
22. As a user, I want progress and output to live in the task directory I name, so that the ledger does not become the task store.
23. As a user, I want a provider refusal or a slow reply to stop new calls, so that a guessed cap of 3 is not the rate-limit policy.
24. As a user, I want those calls to open again after a later probe succeeds, so that a refusal is not a permanent stop.
25. As a user, I want the spec's examples to be three independent lookups and one direct coding task, so that a later session can test the front door without the campaign.
26. As a user, I want the same fan-out to be able to run the seller-name campaign, so that the real job is a test, not a special case.
27. As a user, I want the worker kind to be a hook, so that a project can choose opencode or pi without jev choosing it.
28. As a user, I want a third workflow to be out of this spec, so that consistency is the contract, not an open-ended catalog.
29. As a user, I want fan-out's orchestrator in this spec to be a script, so that an agent cannot rewrite the loop.
30. As a user, I want that script to wake me when it cannot decide, so that a decision does not hide inside the rail.
31. As a user, I want jev to be allowed to answer "is this worker blocked?", so that the script does not guess.
32. As a user, I want a workflow to declare its orchestrator kind, so that a later workflow may use an agent, a script, or jev without changing the rails.
33. As a user, I want the hide-machinery trick for direct to stay out of this spec, so that the feeling is required and the trick is not frozen.
34. As a user, I want foreign panes left alone, so that this product does not close panes it does not own.

## Implementation Decisions

- The front door is a pi TUI. It receives a task. It does not do the task.
- The scheduler is code plus jev. Jev is asked whether the task is independent units. High confidence and yes selects fan-out. High confidence and no selects direct. Low confidence asks the user. Jev does not write a plan, pick a worker kind, or elect a leader.
- Two workflows are in this spec. Fan-out runs independent units. Direct runs one worker. A third workflow is not described.
- A workflow receives an input and has an orchestrator. Fan-out must produce a report. Direct must not finish. Orchestrator method belongs to the workflow. This spec's fan-out orchestrator is a script that spawns, grades, and settles. This spec's direct orchestrator is a hidden script. A later workflow may use an agent, a script, or jev. That choice is not a rail.
- Rails, which a project must not rewrite: the pane ledger, fail recovery, backpressure, and the retry cap. Fail recovery is the existing `shep` behavior, including adopt if the front door dies. The ledger may later point at a chosen file. It remains the pane owner.
- Hooks are a manifest plus scripts in the task directory. `workflow.toml` names the workflow, the worker kind, and the units, grade, and counts commands. A unit carries its own brief. A project may write hooks in any language. Jev does not pick the worker kind.
- The product retry maximum is 3. A workflow may use fewer. It may not use more. The cap covers orchestrator retries, including a worker that hits a token limit.
- Backpressure is a provider refusal or a slow reply, from the LLM or from web-search MCP. The workflow stops opening new calls until a later probe succeeds. A hand-set concurrency number is not this policy.
- Ownership is split. The `shep` ledger owns panes. The task directory the user names owns progress and output. A live worker owns neither.
- Layout belongs to the workflow. Fan-out's orchestrator runs detached (the campaign's launchd pattern). Its lane is a recorded pane tailing the orchestrator log via `shep record`. Each worker is `shep spawn w-<id>`. `SHEP_STACK_MAX` stays 3, so a fourth worker opens shep's overflow tab. Direct opens no pane. The chat the user already has open is the worker.
- Fan-out's report has a status, named counts, a table, and where to check. The hook names the counts. The front door shows the report. It does not paste the raw work. For the seller-name test, the counts include chunks done, rows inserted, and the table name.
- Direct has no report and no finish. The user stops when they want. The front door resubmits a failed turn, up to the cap. If the cap is hit, the worker says so in that same chat.
- The examples in the spec are three independent lookups, and one direct coding task. The seller-name campaign is a test that the same fan-out hooks must be able to carry. It is not the example the spec is written around.
- Outliving memory is the directory the agent was opened in. The front door does not invent another folder.
- Leader election is not in this spec. Leader-or-not remains a field a later workflow may declare. These two workflows do not elect one.

## Testing Decisions

- Test at the front door. A task goes in. Fan-out yields a report. Direct yields an open chat that feels like a coding agent. Do not test `shep` or jev by reimplementing them.
- A good test checks that behavior, not the hiding trick and not the probe's internals.
- The small examples are the acceptance tests for the front door. The seller-name campaign is a later test that the same hooks run a real job. It is not required to pass before the small examples do.
- Grade is a hook. The rail treats the hook's pass or fail as the unit result. Tests use a stub hook.
- Retry tests must show that a fourth retry does not happen, and that the cap-hit words appear in the direct chat.
- Backpressure tests must show that a refusal stops new calls, and that a successful probe allows them again.
- Layout tests for fan-out must show the lane split, the cap of 3, and a new tab for a fourth worker.
- There is no prior test suite in this repo. The fleet prototype's smoke is evidence of the pain, not a suite to extend.
- Fan-out verification runs real panes via `shep` in herdr and quotes the verify-to-zero receipt. The repo pushes to origin at each phase milestone.

## Out of Scope

- Building the TUI in the planning effort. This spec is the handoff.
- Rewriting `shep` into the product.
- A release for anyone other than the user on this machine.
- A third workflow, a million-agent cluster, and leader election.
- Choosing how direct hides its machinery.
- Choosing how the backpressure probe is implemented, beyond the required behavior.
- Describing the seller-name campaign as the spec's example.
- A dashboard.

## Further Notes

- Domain language is `CONTEXT.md`. Source notes are `research/glossary-sources.md`.
- The fleet template is a prototype. It is not this spec. The pains it showed are a rewritten watcher, a missing contract, and a hand-set cap.
- The seam is the front door. `shep` and jev stay tools the front door calls.
