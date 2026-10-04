# The Actor writes the Protocol. The Orchestrator does not.

`docs/prd/live-orchestrator.md` put both jobs on one pane, because the glossary listed Actor under Orchestrator, to avoid. The left pane was then told to write `protocol.json`. That is the Actor's job. The Orchestrator only watches the pane ledger and wakes when a pane is blocked. skill-rsi needs both panes, born once, plus named Mock panes. Folding them was the mess.

Considered: one live pane that both watches and writes. Rejected. A person could not point at the pane that was wrong.
