# agentic-os

**Two agents, two folders, one task. You get one ping when it's done.**

agentic-os runs a task with several coding agents at once — each in its own
terminal, each allowed to see only its own folder — and brings you back one
answer. The program that runs them never thinks. The agents do the work;
plain, predictable rules do the management.

---

## The story

Monday morning. The team chat lights up:

> "The numbers don't match. The dashboard says revenue is up 12%. The sales
> notes say the quarter felt flat. Someone figure out who's right before the
> meeting."

Two people could answer this. **Alex** has the dashboard exports — every
number, none of the story. **Sam** has the sales notes — every deal, every
"they went quiet in August," none of the numbers. Neither should be reading
the other's files: the exports are sensitive, the notes are private. And the
truth is in the *conversation* between them, not in either pile alone.

So you do what everyone does. You open one chat, paste both folders in, and
ask.

It doesn't work. One agent with both piles doesn't *balance* them — it picks
a side. It either worships the spreadsheet ("+12%, the notes are anecdotal")
or trusts the gut ("flat, the dashboard must be double-counting"). You spend
the evening rewriting the prompt to nudge it back toward the middle. It
drifts again. The meeting is in an hour.

Two chats is worse: now *you* are the messenger, copying findings back and
forth, and the moment you close the laptop the investigation dies.

---

## What you wanted

You wanted to hand the question to both of them and walk away.

```toml
# mismatch/workflow.toml — two agents, two folders, one conversation
[workflow]
name    = "mismatch"
spur_id = "mismatch"
kind    = "coworker"

[members.alex]
model     = "zai-coding-plan/glm-5.3"
initiates = true                      # Alex starts
roots     = ["~/data/dashboard-exports"]

[members.sam]
model = "zai-coding-plan/glm-5.3"
roots = ["~/notes/sales"]

[hooks]
units  = "bash hooks/units.sh"        # what a unit of work is
grade  = "bash hooks/grade.sh"        # when the answer counts as done
counts = "node hooks/counts.mjs"      # what the report counts
```

```console
$ agentic-os run mismatch
```

Two terminals open. Alex reads the exports and writes a finding: *"the +12%
is three deals, all booked in the last week of the quarter."* Sam answers
from the notes: *"two of those were pushed in from next quarter — the notes
say so on Sept 28."* Alex checks: *"confirmed, strip them and it's +1%."*
Done.

Then your chat gets exactly one message: the answer, the counts, and where
to look. Every number in it came from a file one of them actually opened.

That's the whole product:

- **Each agent sees only its own folder.** Alex never had the notes; Sam
  never had the exports. Private stays private — by rule, not by prompt.
- **They talk only through the supervisor.** Messages cross; files don't.
- **The supervisor never thinks.** It opens the terminals, carries the
  messages, answers "may I read this?" itself, and retries when the API says
  slow down. No model in the loop means no drift, no surprises, no babysitting.
- **You get one ping, not a stream.** Success is quiet. Trouble is a real
  message. Close the laptop — the job finishes, pauses cleanly, or waits for
  you. Nothing is lost.
- **It's a folder, not a software project.** The task above is the whole
  integration. Any language for the hooks; an agent can write them for you.

---

## Why two agents, not one smart one?

Because *combining* the piles is the bug, not the shortcut.

One agent with both folders has one objective and one mood — so whichever
side is louder wins, and your only fix is prompt-tuning a balance that
drifts the moment the task changes. Two agents with separate folders can't
collapse: each one can only optimize *its own* pile, and the only thing they
share is the messages. The balance isn't tuned. It's enforced.

(Engineers: this is decomposition-coordination — the ADMM family — applied to
agents. The full mapping, and where the analogy honestly breaks, is below.)

---

## A second story: the contract

The same shape solves a different pain. Two codebases need to agree on an
API change — the server team and the app team. Neither should be reading the
other's repo. So each side gets an agent with access to only its own
codebase, and they negotiate the change through messages: the server side
proposes, the app side pushes back with the calls it actually makes, and
they converge on a contract both can sign. The job isn't "done" until both
codebases compile against the agreed contract — checked by a script, not by
vibes. When they disagree, the disagreement is a file you can read.

---

## What this saves

| You stop… | Because… |
|---|---|
| **Leaking files between agents** | Each agent is confined to the folders you name. Secrets-shaped paths are refused outright. |
| **Drowning one chat in two worlds** | Agents never see each other's context. Only short messages cross. |
| **Babysitting** | One ping when it's done; silence means it's going fine. |
| **Losing the evening** | It runs while you don't watch. Pause, resume, and "pick up where it died" are built in. |
| **Trusting "it ran"** | Every birth, death, message, and verdict is appended to one log. Anything you can read is a summary of that log. |
| **Turning a task into a project** | The task is a folder of data. The rules never change per task; only the folder does. |

---

## What this is, in one paragraph

> agentic-os is a **job supervisor for coding agents**: a small program on
> your machine that runs tasks made of several agents, each in its own
> terminal with its own files, and reports back once. It is **not an agent**
> — it never thinks; your agents (opencode, pi) do. It is **not a harness** —
> a harness is the app one agent runs inside; this supervises those apps. It
> is **not a framework** — you don't import it into code; you hand it a
> folder. It is closest to a **workflow engine** (think Airflow) whose workers
> happen to be agents you can watch think, plus a **process supervisor**
> (think systemd) that keeps the books. "OS" is a nickname for that
> bookkeeping — it is not a kernel, and your normal chat keeps working beside
> it.

The one-line version: **agents do the work, rules do the management.**

---

## The rest of this page is for the technical reader

Everything above is the product. Everything below is the engineering: the
decomposition argument in full, the definition against today's terminology,
and why this isn't LangGraph, firstmate, tmux, or a fleet board.

---

## Why two heads — the engineering version

**Fusion** puts both worlds in one context window: one objective, one mode,
and whichever gradient dominates takes over — data-worship or
intuition-worship. The countermeasure is a balance coefficient in a prompt:
continuous, unmeasurable, per-task, and painful to tune. You are hand-tuning
what should be architecture.

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
| Private data that never pools | `roots` — the notes never reach the exports, the exports never reach the notes |
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

The same alternation is a first-class workflow kind (`lab`): an Actor writes
a protocol naming the next wave, the rail births it, the grade names the
next. It is also how this repo tuned its own permission gate — prompt
candidates scored against seeded cases, the measured winner landed
automatically (`jev-tuner/`). Decomposition-coordination isn't the
marketing; it's the method this repo already runs on.

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
  depend on each other — the mismatch and the contract), `direct` (no
  rails; the open chat is the supervisor), `lab` (protocol-driven waves for
  evals).
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
