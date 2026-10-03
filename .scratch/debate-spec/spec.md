Status: not law. CONTEXT.md, docs/RAILS.md, and GOAL.decision.md are.

# Debate workflow

## Problem Statement

The user has figures that must survive a customer's roasting before they are published. A prototype proved the argument works: a critic asked seven questions about Coupang pet-food figures, a proposer answered from frozen evidence, a deterministic gate checked citations and levels, and a fresh critic accepted all seven. The prototype is the coupang roast fleet (NWi_mars, `artifacts/roast/2026_p9_150`).

The prototype's pain is structural. An agent session drove every turn: relayed questions, invoked the grade between panes, applied the verdict. Only one side was spawned per round; the driver played stagehand to both. Tokens were spent babysitting a loop that is almost entirely mechanical. This is the fleet template's pain again — the orchestrator is the loop.

The user wants the argument without the babysitting.

## Solution

A third workflow, debate. Two workers — a critic and a proposer — spawned in panes, arguing directly with each other through outliving memory in the task directory. The orchestrator is a script: it spawns both workers, arms the wake conditions, then idles. It is woken only by a terminal event: the argument converges, a worker blocks, or the round cap is hit. A deterministic grade hook runs between rounds; arithmetic is never argued. Debate ends in a report.

## User Stories

1. As a user, I want a third workflow, debate, for figures that must survive a customer's roasting, so that a defended figure is published, not a drafted one.
2. As a user, I want the scheduler to be able to pick debate when the task is defending figures against a critic, so that I do not hand-pick the workflow.
3. As a user, I want both the critic and the proposer spawned as workers in panes, so that neither side of the argument runs inside the other's context.
4. As a user, I want the critic and the proposer to argue directly through the task directory, so that the orchestrator is not a turn-taking relay.
5. As a user, I want the orchestrator idle while the workers argue, so that no tokens are spent watching the loop.
6. As a user, I want the orchestrator woken only when the argument converges, blocks, or hits the round cap, so that every wake means a decision is needed.
7. As a user, I want each round to end in a verdict naming graded questions, so that acceptance is an explicit act, never silence.
8. As a user, I want a deterministic grade between rounds, so that arithmetic is checked, not argued.
9. As a user, I want the grade to be a hook, so that what counts as evidence belongs to the project, not the rail.
10. As a user, I want the argument state in outliving memory in the task directory, so that a dead worker's round is resumable by a fresh one.
11. As a user, I want the evidence frozen under a hash manifest before the first spawn, so that a worker cannot rewrite what it cites.
12. As a user, I want each worker's readable inputs declared per role, so that the critic judges figures, not methodology.
13. As a user, I want a verdict that accepts an ungraded question to be void, so that the pair cannot congratulate itself past the gate.
14. As a user, I want a missing or empty verdict to be void, so that silence never passes a figure.
15. As a user, I want worker retries to stop at the product cap, so that a token limit cannot flood.
16. As a user, I want a round cap declared by the hook, so that a stubborn pair cannot loop forever.
17. As a user, I want a cap-hit debate to still produce a report, so that unfinished is readable, not silent.
18. As a user, I want the report to show a status, counts of questions accepted, reopened, and conceded, rounds used, and where to check, so that I can read the argument's outcome without opening panes.
19. As a user, I want the front door to show that report, so that I do not hunt for it.
20. As a user, I want pane ownership to stay in the `shep` ledger, so that the fail recovery I already trust is not rebuilt.
21. As a user, I want debate's orchestrator to be a script, so that an agent cannot rewrite the loop.
22. As a user, I want the wake plumbing left open, so that the spec requires the behavior, not a mechanism.
23. As a user, I want backpressure to cover both workers, so that a provider refusal pauses the argument rather than corrupting it.
24. As a user, I want a blocked debate to wake me with the open question attached, so that a human decision is not just another round.
25. As a user, I want debate's layout to be the second tab with an orchestrator lane and two worker panes, so that I can watch both sides argue.
26. As a user, I want the coupang roast to run as a debate hook, so that the prototype becomes a test, not a special case.

## Implementation Decisions

- Debate is the third workflow. The front-door spec's two-workflow limit stands; this spec adds the workflow it deferred. Debate receives figures and evidence, and must produce a report.
- The orchestrator is a script. It spawns both workers, freezes the evidence, arms the wake conditions, and idles. On wake it settles: apply the verdict, write the report, or escalate to the user. It never relays argument content.
- Workers argue directly through files: the critic writes questions, the proposer writes answers and proposals, the critic writes a verdict. The orchestrator moves question state — pending, answered, graded, done — by running the grade hook. Nothing else moves a question to done.
- The three wake conditions are exhaustive: convergence (a verdict accepts every graded question and reopens none), block (a worker writes needs-decision, a worker dies past the retry cap, or the grade hook fails), and the round cap. Heartbeats and round traffic do not wake the orchestrator.
- The wake mechanism is not chosen here. `shep`'s wake queue, wake-at timers, or a status-log tail are all acceptable. The requirement is idle-until-terminal.
- Grade is a hook: deterministic, no LLM. It checks citations against the hash manifest, the levels against the project's floors and bands, and disclosure flags. The rail treats the hook's pass as the only gradeable state a verdict may accept.
- Silence is not accept. A missing, empty, or overreaching verdict voids the round. A voided round respawns the critic within the product retry cap of 3.
- Readable inputs are per-role and declared in `workflow.toml`: which file is the critic's numbers, which directory is the proposer's evidence. Freezing is hash manifest plus read-only, before the first spawn.
- Outliving memory is the task directory: rounds, question state, decisions, checkpoints. Ownership stays split. The `shep` ledger owns panes. The task directory owns the argument.
- The round cap is a hook value. Worker respawn is the rail's, capped at 3.
- The report has a status (converged, capped, blocked), counts (questions accepted, reopened, conceded), rounds used, and where to check. The front door shows it.
- Backpressure covers both workers. A refusal stops new calls; a later probe reopens them.

## Testing Decisions

- Test at the front door. A defend-these-figures task goes in. A debate report comes out.
- Rail tests use a stub grade hook. The coupang roast's grader (`roast_grade.py` in NWi_mars) is the project hook and the campaign-scale test.
- Wake tests must show the orchestrator not woken by heartbeats or round traffic, and woken by exactly the three terminal conditions.
- Verdict tests must show that accepting an ungraded question voids the round, and that silence voids it.
- Tamper tests must show an edited evidence file failing the hash manifest.
- Cap tests must show no round past the cap, and a cap report with its status.
- Verification runs real panes via `shep` in herdr and quotes the verify-to-zero receipt.
- The coupang roast already ran as a manual fleet: seven questions, seven accepted, zero levels moved, three conceded file defects. That run is the prototype evidence. It does not need to pass before the stub tests do.

## Out of Scope

- More than two arguing workers. Panels and committees are not this workflow.
- Leader election. Unchanged from the front-door spec.
- Choosing the wake mechanism, beyond the required behavior.
- The grade hook's internals. The project owns them.
- Rewriting `shep` into the product.
- The TUI itself.
- A release for anyone other than the user on this machine.

## Further Notes

- Domain language is `CONTEXT.md`. This spec introduces three terms to fold in when accepted: Debate, Round, Verdict.
- Debate: the workflow where two workers argue through outliving memory until a deterministic gate lets a verdict stand. _Avoid_: roast, adversarial loop, court, committee.
- Round: one question-answer-verdict cycle through the task directory. _Avoid_: turn, pass, iteration.
- Verdict: the critic's explicit accept-or-reopen, naming only graded questions. _Avoid_: review, approval, sign-off.
- Prototype evidence: the coupang roast fleet in NWi_mars. The argument worked; the agent-in-the-middle did not. This spec removes the middle.
