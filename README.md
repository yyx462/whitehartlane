# agentic-os

**Two agents, two contexts, two sandboxes — one task, one wake.**

agentic-os is a job supervisor for coding agents. You describe a task as a
folder of data (a `workflow.toml` plus hooks); it opens one terminal pane per
worker, gives each its own context, model, and file access, relays typed
messages between them, answers permission asks itself, retries the provider
when it pushes back, and wakes you exactly once — with a report. Then it
retires the job with a clean receipt.

The engine that does all of that contains no model. Agents do the work;
deterministic rails do the management.

Spark: instacloud's *"A Million Agents Is a Distributed Systems Problem."*
Our addendum: two agents with different file access is already one.

---

## The task you already know: a whodunit

Monday, 9:58 a.m. Friday's deploy went out; this morning checkout p99 is
**180ms → 900ms**. CI is green, the dashboard is red, and the question lands
in chat:

> "who killed the p99?"

The answer needs two heads that live in two different worlds:

- a **data head** — at home on the perf box: flamegraphs, allocation logs,
  the bench harness. It can run numbers all day. It cannot read your source
  tree, so every direction it finds ("the spike tracks a retry storm near
  commit 6d0a") points at a suspect it has never seen.
- a **code head** — at home in the repo: the diff, the blame, the suspects.
  It forms a sharp theory in minutes. It cannot run the bench or see a
  single trace, so every theory is cheap talk until numbers land.

And the answer is a conversation between them — the code head names a
suspect with a one-line instrumentation patch; the data head runs it and
answers with a number; the theory tightens — not two reports you stitch
together yourself at midnight.

Now try to run that with what you have:

**One chat, both folders.** One window, one objective, one mode — so the
model collapses. Either it defends its reading of the diff ("6d0a looks
innocent, must be noise") or it pattern-matches the first hot symbol in the
flamegraph. Your only knob is prompt-tuning the balance between data and
intuition — a continuous, unmeasurable coefficient. All evening. Every task.

**Two chats and copy-paste.** Now *you* are the relay, the bench operator,
the permission system, and the audit log. Every finding crosses desks
through you. Close the laptop and the interrogation dies. Nothing records
what either head did.

**A framework.** LangChain, LangGraph, CrewAI: now it's a Python project.
Agents become in-process calls instead of your real CLI agent with its real
harness; you own the sandbox decision, the state plumbing, and the retry
code. You wanted a suspect by Tuesday; by Thursday you're maintaining
orchestration software.

**A fleet board.** Vibe Kanban, Paneflow, Container-Use: great at running
*independent* tasks in parallel lanes — but they are boards you watch. No
typed channel between the agents, no per-agent file access, no admission, no
receipt, no "wake me when it's done."

What you wanted was boring: hand the interrogation to a supervisor and walk
away.

---

## Why two heads at all?

The fair objection: *why not one agent with both folders?* Because fusion
fails structurally, and optimization theory has known the fix for decades.

**Fusion** puts both worlds in one window: one objective, one mode, and
whichever gradient dominates takes over — data-worship or intuition-worship.
The countermeasure is a balance coefficient in a prompt: continuous,
unmeasurable, per-task, and painful to tune. You are hand-tuning what should
be architecture.

**Decomposition** — ADMM, alternating minimization, the whole family — keeps
the pieces discrete: each block optimizes its *own* objective over its
*private* variables, and the blocks coordinate only through a small
**consensus quantity**, updated in alternation. Nobody's raw world ever
merges; global behavior emerges from local solves plus a narrow interface.
Mapped onto this system, almost embarrassingly exactly:

| Optimization piece | agentic-os piece |
|---|---|
| Local block with private data | A member: its own context window, its own `roots`, its own brief |
| Local objective — and local solver | The brief; each member may run a *different model* (fusion can't) |
| Private data that never pools | `roots` — the repo never leaks onto the perf box, traces never ship the warehouse |
| Consensus variable: small, shared | **The typed message file** — the only thing that crosses |
| The coordination step | The rail's relay: mail moved into the named member's prompt; a worker never writes another worker |
| Alternation, not a shouting match | Turns — propose, question, tune; mail is never delivered mid-turn |
| Stopping rule | The `grade` hook, retry caps, the run deadline |
| Iteration log you can audit | The message files on the job dir — the negotiation is on disk |

> Fusion tunes a prompt coefficient; decomposition enforces an interface.
> The message file is the only gradient that crosses the wall.
> You can't prompt your way to a balance the architecture already enforces.

**Where the analogy honestly breaks:** ADMM comes with a convergence
theorem; agents don't. Alternation can oscillate or settle on a
plausible-but-wrong consensus — so the guards are external: the grade
decides the color, caps bound the spend, and the report separates a worker's
`done` claim from the graded verdict. And where ADMM's mathematician chooses
the consensus variable, here the program author chooses the message schema —
that choice (the x-split) is the real design skill: a narrow, checkable
interface converges; a wide one just moves fusion somewhere else. We borrow
the decomposition, the interface, and the audit trail — not the proof.

---

## What it should have looked like

A folder is the whole integration:

```toml
# p99-hunt/workflow.toml — two members, two worlds, one rail between them
[workflow]
name    = "p99-hunt"
spur_id = "p99-hunt"
kind    = "coworker"

[members.source]
model     = "zai-coding-plan/glm-5.3"
initiates = true                        # this member gets the task first
roots     = ["~/projects/shop"]         # the repo — nothing else

[members.traces]
model = "zai-coding-plan/glm-5.3-flash"
roots = ["~/perf/checkout-week"]        # flamegraphs, alloc logs, the bench — nothing else

[hooks]
units  = "bash hooks/units.sh"          # what a unit of work is
grade  = "bash hooks/grade.sh"          # e.g. culprit named AND bench back under threshold
counts = "node hooks/counts.mjs"        # what the report counts
```

One command:

```console
$ agentic-os run p99-hunt
job   j-7c31f
log   ~/.local/share/agentic-os/s-…/jobs/j-7c31f/run/orchestrator.log
trace ~/.local/share/agentic-os/s-…/events.jsonl
```

What happens next, with nobody watching:

- **Two panes open in your terminal.** herdr owns the ttys; every worker is
  an ordinary agent CLI (opencode or pi) you can watch think, live — but you
  don't have to.
- **Each member works inside its roots.** `traces` never had the repo;
  `source` never had the perf box. Secrets-shaped paths are denied before
  any judgment happens. A gray-zone ask is answered in milliseconds by a
  typed decider that reads the member's brief — no dialog ever waits for
  you. The discipline has teeth: six deny-family answers and that worker is
  done (allows cost nothing).
- **They talk only through the rail.** Typed message files on the job dir,
  relayed into the named member's prompt — the interrogation record:
  *"suspect: retry loop in 6d0a, patch attached, run path A"* → *"path A
  flat; storm starts 40ms before your patch point; next suspect."*
  Conclusions cross the wall; access never does.
- **Nothing with a mind runs the loop.** Birth, relay, permissions, retries,
  receipts — deterministic code. When a runtime judgment is genuinely
  needed, it's a typed gate (a calibrated one-bit decision with a measured
  prompt), never a freelance agent.
- **Trouble is handled like an adult.** Provider refuses: backoff with
  jitter, capped retries, a visible line per wait. You need the laptop:
  `pause` drains to a clean boundary; `continue` rebirths every unfinished
  worker from its booked session pointer. Orchestrator dies: the job parks
  `orphaned` — announced, never auto-resurrected, never lost.
- **Then exactly one wake.** A prompt into your live pane — or a durable
  `wake.json` if you're gone — plus `report.json`: status, named counts
  (suspects eliminated, bench runs, p99 before/after), where to check. The
  receipt is `panes of this job remaining = 0`. And every number in that
  report is the output of a command `traces` actually ran.

A quiet success never interrupts you. That's a rail, not a setting.

---

## The second shape: the contract summit

Not every two-headed task is a hunt. The other classic: **two repos that
must agree.** The API is changing. The server side owns the migrations and
the private config; the client side owns the usage patterns and the release
train. Neither delegation should read the other's capital — and neither
needs to, because the only thing they must share is the contract.

```toml
# contract-summit/workflow.toml — two delegations, one treaty
[workflow]
name    = "contract-summit"
spur_id = "contract-summit"
kind    = "coworker"

[members.server]
model     = "zai-coding-plan/glm-5.3"
initiates = true
roots     = ["~/projects/shop-server"]

[members.client]
model = "zai-coding-plan/glm-5.3"
roots = ["~/projects/shop-app"]

[hooks]
units  = "bash hooks/units.sh"
grade  = "bash hooks/grade.sh"   # both sides compile + typecheck against the agreed schema
counts = "node hooks/counts.mjs"
```

Here the consensus variable is literal: the schema diff. `server` proposes
endpoints shaped by its data model; `client` pushes back with the calls it
actually makes; alternation converges on a contract both can sign — then
each delegation implements privately in its own tree. Verification is
mechanical: the grade hook won't pass until both sides compile against the
agreed schema. When they disagree, the disagreement is a file on disk, not a
vibe in a window.

---

## The cameo: this system manufactured its own best number

The least-believed sentence in this README is a quiet one: a permission gate
answering gray-zone asks at **98.3% measured accuracy**. It got there
exactly the way this page argues — alternating discrete pieces: prompt
candidates proposed, scored against fifty-plus seeded cases through the same
adapter the rails use, the winner landed automatically when it beat the
incumbent (`jev-tuner/`, `src/jev-prompts/`). The `lab` workflow — an Actor
writes a protocol naming the next wave, the rail births it, the grade names
the next — offers the same alternation as a first-class workflow kind.
Decomposition-coordination isn't the marketing; it's the method this repo
already runs on.

---

## What this saves

| It saves… | Because… |
|---|---|
| **Your secrets surface** | Per-member roots (`[members.<name>]`) plus program-wide `roots.txt`; secrets and credential-shaped paths are denied before judgment ever runs. Capability scoping, not one shared blob. |
| **Your context windows** | Members never see each other's windows. Only typed mail crosses the wall — a pointer-sized summary instead of two full transcripts. |
| **Your attention** | One wake per levy, a wake ladder with a once-guard, booked waits that read as explained silence instead of stalls. A quiet success is not an event. |
| **Your evening** | `agentic-os run --unattended` finishes with no person in the loop. Pause, abort, continue are first-class verbs, not best-effort flags. |
| **Your trust in "it ran"** | An append-only trace (`events.jsonl`) is the single source; `job.json`, `state.json`, `report.json` are projections. `audit` flags any live pane no job admits. Every birth is booked. |
| **Your Tuesday** | The task is a data folder — hooks in any language, a planner (human or agent) may write hooks, never rails. An ad-hoc collaboration never becomes a software project. |

---

## What this is — the definition, in today's words

> **agentic-os is a single-user, single-machine, terminal-native job
> supervisor and deterministic workflow engine for external coding-agent
> CLIs.** It hosts no agents — pi and opencode are the harnesses; agentic-os
> is the thing that books, feeds, watches, retires, and wakes them. Its loop
> contains zero model calls. In Anthropic's taxonomy it sits wholly on the
> *workflow* side (predefined, deterministic paths) — while every unit of
> work it schedules is an *agent*.

| Today's word | Is agentic-os that? | Where that word actually lands here |
|---|---|---|
| **Agent** — an LLM running tools in a loop, directing its own process | **No** | The loop has no model in it. Agents are the *workers* — external CLIs in panes. "The Orchestrator … never a pane and never an agent." |
| **Harness** — the runtime hosting one agent (Claude Code, OpenCode, pi) | **No** | It hosts zero agents. pi/opencode are the harnesses; agentic-os supervises harnesses. |
| **Framework / library** — LangChain, LangGraph, CrewAI | **No** | You don't embed it and it embeds nothing. It's a standalone door (`agentic-os run`); programs are data folders outside the repo. |
| **Orchestrator-agent** — an LLM planning and dispatching | **No, on purpose** | A model may *propose*; "its proposal is an input to booking, never the booking." Runtime judgment is compressed into typed gates with measured prompts. |
| **"Agent OS"** — a kernel everything runs through | **Nickname only** | Zen 1 rejected the kernel claim: your chat talks and edits freely before any rail. "OS" means process birth, accounting, isolation — a shell + supervisor. |
| **Workflow engine** — Airflow, Temporal lineage | **Yes — the truest single label** | Typed steps (`end` / `check` / `wake`), retries with caps, backpressure, receipts, run identity by project pid + spur id + content hash. One inversion: the atoms are terminals a human can watch. |
| **Process supervisor** — supervisord, systemd | **Yes, at pane granularity** | Booked birth, born/died ledger, orphan sweep, pause/abort/continue. herdr owns ttys and shep spawns — mechanisms, not owners. |
| **Agent distro** — firstmate's coinage | **No** | firstmate is instructions that turn an agent into a supervisor. agentic-os is a program that supervises agents. Same ocean, opposite compass. |

The one-line version: **agents at the edges, determinism in the middle.** Use
an agent once, at compile time — a planner writes the hooks. Use the workflow
many times, at run time — the rail executes it cheaply, observably,
unattended.

---

## Why not just…

**…one chat with subagents** (Claude Code Tasks, OpenCode's task tool) —
in-process, inside one harness, one permission envelope, invisible to
anything outside the window. Perfect for one model with many eyes; wrong the
moment workers need *different* file access or the work must outlive the
window.

**…LangChain / LangGraph** — the safe pick when the workflow is a *product
you'll own for a year*: embed the library, write the graph, ship it. For an
ad-hoc task it inverts the cost: atoms are model calls in your process, state
is your plumbing, retries are your code, and there is no terminal to watch.
We're not rebuilding their wheel — their workers are calls; ours are
terminals.

**…CrewAI / AutoGen / MetaGPT** — multi-agent as conversation inside one
runtime the framework owns. Here members are OS processes with their own
harnesses and models, mail is typed files relayed by a deterministic rail,
and a worker never writes another worker.

**…tmux + scripts** — mechanically, this is that, minus everything that makes
it survivable: no admission (any process, unbooked), no per-member
permissions, no typed relay, no retry caps, no receipt, no wake, no trace.
You'd be the operating system. The operating system should be the operating
system.

**…Paneflow / claude-squad** — genuinely good pane managers for parallel
agent sessions; keep one for watching. But a multiplexer has no concept of a
job, a member, a message, or a wake — nothing books anything, nothing
finishes anything.

**…Vibe Kanban / Container-Use / Parallel Code** — fleet managers for
*independent* parallel tasks, board-first and human-watching. No typed
inter-agent channel, no per-agent roots, no admission policy, no receipt you
can poll, no unattended door. They manage lanes; this manages a
collaboration.

**…firstmate** — the nearest spirit: "talk to one agent, ship with a crew,"
visible sessions, worktree isolation, quiet supervision. And the opposite
mechanism: firstmate is an *agent distro* — the supervisor is an LLM you
instruct, the captain is a human, state is conventions the mate reconciles.
agentic-os is the inverse bet: the supervisor is a program, judgment lives in
typed gates, and the commissioner can itself be an agent (`whl`) — spurs
nest, wakes go to the pointer.

**…Airflow / Temporal / Dagster** — the rails' spiritual ancestors: typed
steps, retries, backpressure, receipts, run identity; we say so plainly (the
program format was born a `dag`). But their workers are calls or activities,
their programs are human-authored code, and nothing in them is interactive.
Here every atom is a terminal a human can open, and the program folder is
data an agent may author.

**…ralph / gnhf / AutoGPT-style loops** — a model driving itself toward a
stop condition. agentic-os is the negation: deterministic loop, model at the
edges. (A ralph run is what *one booked pane* does.)

**…OpenClaw** — an always-on personal assistant gateway: one immortal agent
on your messaging channels. Opposite topology — disposable, booked panes born
from a door, dying with their job.

**…Devin / Jules / Morph** — the same insight ("give agents a machine and
supervise them") as a cloud product: opaque, managed, remote. agentic-os is
the other bet: one machine, one user, every worker visible in a pane you can
read.

**Honest fits in the other direction:** a single-shot task needs only your
open chat (agentic-os's own `direct` workflow says exactly that — the open
chat is the supervisor, no retry rail). A product-grade workflow you'll run
daily in production belongs to LangGraph Platform or Temporal. Adversarial,
must-not-escape sandboxing needs VMs — our standing threat model is *mistakes,
not adversaries*: capability scoping, not microVMs.

---

## The 60-second tour

```console
$ agentic-os run <folder>        # the process door: books the job, starts the engine
$ whl run --from <tool>:<sid>    # the agent door: a levy commissions a spur, walks away
$ agentic-os jobs                # every job, its state, its receipt
$ agentic-os events              # the trace, raw
$ agentic-os audit               # any live pane no job admits is a finding
$ agentic-os sweep               # dead orchestrator? parked orphaned, ask-first
$ agentic-os pause | abort | continue   # the park and rebirth verbs
$ agentic-os fork <jid>          # a booked wake, delivered into a reborn pane
```

- **Workflows:** `fan-out` (independent units), `coworker` (members that
  depend on each other — the whodunit and the contract summit), `direct`
  (no rails; the open chat is the supervisor), `lab` (protocol-driven waves
  for evals).
- **Examples that run today:** `examples/coworker-spurs/` (`ui-pause`,
  `steps-viz`), `examples/fan-out-spurs/`, `examples/chain-spurs/` (two-hop
  hand-off), `examples/lab-spurs/` (`trivia-bench`, an eval harness).
- **The window:** `http://127.0.0.1:8787` — a viewer for runs, not a second
  OS.

## The words

One word per concept, enforced — the full dictionary is
[`CONTEXT.md`](CONTEXT.md):

- **levy** — the commissioner of a spur; it plans, delegates, and receives
  exactly one wake. It never takes a pane's answer, and it may itself be a
  worker of another spur.
- **spur** — the group a run belongs to; the branch line that stands up, runs
  to completion, and reports back while the main session carries on.
- **job** — the managed group of panes, with state and policy; retired is a
  state, not deletion.
- **pane** — a herdr split an agent runs in; every pane is born booked or it
  is a finding, not a worker.
- **wake** — a pane's claim on a parent's attention; one per levy, best-first
  delivery, durable if you're gone.
- **receipt** — `panes of this job remaining = 0`.

## The paper trail

- [`GOAL.md`](GOAL.md) — the six rules, and
  [`GOAL.decision.md`](GOAL.decision.md) — every dated branch from them.
- [`docs/RAILS.md`](docs/RAILS.md) — the rails/hooks inventory, written from
  use.
- [`docs/adr/`](docs/adr/) — nine accepted decisions, argued.
- [`docs/zen/`](docs/zen/) — the founding verbatim: what was tried, what was
  rejected, what is law.

*One machine. One user. Every worker visible. No mind in the loop.*
