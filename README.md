# WhiteHartLane — deterministic supervisor for coding agents

**Run the loop first. Tune it afterwards — from the trace, not from guesswork.**

WhiteHartLane is a tool for running a task with coding agents — each in its own
terminal, each allowed to see only its own folder — and keeping a full record
of what they did. The program that runs them never thinks. The point is not
that several agents are better than one. The point is that an untuned loop
can run today, and the trace it leaves is what you build the cheap version
from tomorrow.

**Status.** Early, and MIT licensed. macOS. A run
needs [herdr](https://herdr.dev), a coding-agent CLI (opencode or pi), and
your own model. The examples are the author's runs, with paths rewritten
to placeholders — not a tutorial yet.

## Install

```console
$ npm install -g whitehartlane
```

Zero-install trial: `npx whitehartlane` prints the verb list. Requires
Node ≥ 22 on macOS; actual runs additionally need
[herdr](https://herdr.dev) and a coding-agent CLI (opencode or pi).

Formerly **agentic-os** — renamed October 2026. Same tool, same trace: the
OS disk, sessions, and wakes carry over (a legacy `agentic-os` disk is still
honored; see ADR 0011).

---

## The story

Monday morning. The team chat lights up:

> "The numbers don't match. The dashboard says revenue is up 12%. The sales
> notes say the quarter felt flat. Someone figure out who's right before the
> meeting."

Two people could answer this. **Alex** has the dashboard exports — every
number, none of the story. **Sam** has the sales notes — every deal, every
"they went quiet in August," none of the numbers. The exports are sensitive
and the notes are private, so neither should be reading the other's files.

You could get one agent to answer this. Probably, eventually. But not before
the meeting: first you have to find the prompt, and the only way to find it
is to run, read the answer, tweak, and run again. Every attempt is blind —
you see the final answer, not which question actually cracked it. Two chats
is no better: now you are the messenger, and nothing is written down.

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
$ whl run mismatch
```

Two terminals open. Alex reads the exports and writes a finding: *"the +12%
is three deals, all booked in the last week of the quarter."* Sam answers
from the notes: *"two of those were pushed in from next quarter — the notes
say so on Sept 28."* Alex checks: *"confirmed, strip them and it's +1%."*
Done.

Then your chat gets exactly one message: the answer, the counts, and where
to look. Every number in it came from a file one of them actually opened.

No prompt was tuned for that run. That's the whole product:

- **Each agent sees only its own folder.** Alex never had the notes; Sam
  never had the exports. Private stays private — by rule, not by a line in a
  prompt you hope the model respects.
- **They talk only through the supervisor.** Messages cross; files don't.
- **The supervisor never thinks.** It opens the terminals, carries the
  messages, answers "may I read this?" itself, and retries when the API says
  slow down. Nothing in the loop to babysit.
- **You get one ping, not a stream.** Success is quiet. Trouble is a real
  message. Close the laptop — the job finishes, pauses cleanly, or waits for
  you. Nothing is lost.
- **You get the trace.** Every exchange is on disk: who asked what, which
  file settled it, where they went back and forth. The answer is half the
  run. The trace is the half you reuse.
- **It's a folder, not a software project.** The task above is the whole
  integration. Any language for the hooks; an agent can write them for you.

---

## Run first, tune from the trace

The expensive part of a new task is not the tokens. It is the evening you
spend discovering the prompt — blind reruns where you see the answer but not
what produced it.

So don't tune first. Run the loop as it stands. The rules — separate
folders, messages carried between agents, permission asks answered, retries
when the API slows down — are what make an untuned loop safe to just run.
You spend tokens instead of an evening, and you get an answer the same day.

Then read the trace and keep only what mattered. The exchanges that cracked
the question fold into one prompt. Or drop the agents entirely and keep the
steps as a fixed workflow — hooks and checks, no model in the loop at all.
Either way the second version spends a fraction of the tokens, and it was
shaped by what actually happened, not by guessing which line of the prompt
mattered.

One agent may well be the right end state. We don't claim otherwise, and we
have no figures that say so. This is a tool for getting a loop running today
and keeping the evidence to make it cheap tomorrow — not a method, and not a
leaderboard.

---

## A second story: the contract

The same tool runs a different kind of loop. Two codebases need to agree on an
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
| **Tuning prompts before you know anything** | Run the loop first. The trace shows what actually mattered; tune from that. |
| **Paying full price on every repeat** | The second version is one prompt, or a fixed workflow with no model in it — shaped by the trace, spending a fraction of the tokens. |
| **Guessing which line mattered** | Every exchange is on disk. You can see which question cracked it. |
| **Leaking files between agents** | Each agent is confined to the folders you name. Secrets-shaped paths are refused outright. |
| **Babysitting** | One ping when it's done; silence means it's going fine. |
| **Losing the evening** | It runs while you don't watch. Pause, resume, and "pick up where it died" are built in. |
| **Trusting "it ran"** | Every birth, death, message, and verdict is appended to one log. Anything you can read is a summary of that log. |
| **Turning a task into a project** | The task is a folder of data. The rules never change per task; only the folder does. |

---

## What this is, in one paragraph

> WhiteHartLane is a **job supervisor for coding agents**: a small program on
> your machine that runs tasks made of several agents, each in its own
> terminal with its own files, and reports back once. It is **not an agent**
> — it never thinks; your agents (opencode, pi) do. It is **not a harness** —
> a harness is the app one agent runs inside; this supervises those apps. It
> is **not a framework** — you don't import it into code; you hand it a
> folder. It is closest to a **workflow engine** (think Airflow) whose workers
> happen to be agents you can watch think, plus a **process supervisor**
> (think systemd) that keeps the books. "OS" is a nickname for that
> bookkeeping — it is not a kernel, and your normal chat keeps working beside
> it. It makes no claim that several agents beat one: one agent may be the
> right end state. The tool's job is the loop today and the trace for
> tomorrow.

The one-line version: **agents do the work, rules do the management.**

---

## The rest of this page is for the technical reader

Everything above is the product. Everything below is the engineering: the
definition against today's terminology, and why this isn't LangGraph,
firstmate, tmux, or a fleet board.

---

## What this is — the definition, in today's words

> **WhiteHartLane is a single-user, single-machine, terminal-native job
> supervisor and deterministic workflow engine for external coding-agent
> CLIs.** It hosts no agents — pi and opencode are the harnesses; WhiteHartLane
> is the thing that books, feeds, watches, retires, and wakes them. Its loop
> contains zero model calls. In Anthropic's taxonomy it sits wholly on the
> *workflow* side (predefined, deterministic paths) — while every unit of
> work it schedules is an *agent*.

| Today's word | Is WhiteHartLane that? | Where that word actually lands here |
|---|---|---|
| **Agent** — an LLM running tools in a loop, directing its own process | **No** | The loop has no model in it. Agents are the *workers* — external CLIs in panes. "The Orchestrator … never a pane and never an agent." |
| **Harness** — the runtime hosting one agent (Claude Code, OpenCode, pi) | **No** | It hosts zero agents. pi/opencode are the harnesses; WhiteHartLane supervises harnesses. |
| **Framework / library** — LangChain, LangGraph, CrewAI | **No** | You don't embed it and it embeds nothing. It's a standalone door (`whl run`); programs are data folders outside the repo. |
| **Orchestrator-agent** — an LLM planning and dispatching | **No, on purpose** | A model may *propose*; "its proposal is an input to booking, never the booking." Runtime judgment is compressed into typed gates with measured prompts. |
| **"Agent OS"** — a kernel everything runs through | **Nickname only** | Zen 1 rejected the kernel claim: your chat talks and edits freely before any rail. "OS" means process birth, accounting, isolation — a shell + supervisor. |
| **Workflow engine** — Airflow, Temporal lineage | **Yes — the truest single label** | Typed steps (`end` / `check` / `wake`), retries with caps, backpressure, receipts, run identity by project pid + spur id + content hash. One inversion: the atoms are terminals a human can watch. |
| **Process supervisor** — supervisord, systemd | **Yes, at pane granularity** | Booked birth, born/died ledger, orphan sweep, pause/abort/continue. herdr owns ttys and shep spawns — mechanisms, not owners. |
| **Agent distro** — firstmate's coinage | **No** | firstmate is instructions that turn an agent into a supervisor. WhiteHartLane is a program that supervises agents. Same ocean, opposite compass. |

The one-line version: **agents at the edges, determinism in the middle.** A
planner — human or agent — writes the hooks; the rail runs them cheaply,
observably, unattended, and the trace of every run is what a later, cheaper
version is built from.

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
WhiteHartLane is the inverse bet: the supervisor is a program, judgment lives in
typed gates, and the commissioner can itself be an agent (`whl`) — spurs
nest, wakes go to the pointer.

**…Airflow / Temporal / Dagster** — the rails' spiritual ancestors: typed
steps, retries, backpressure, receipts, run identity; we say so plainly (the
program format was born a `dag`). But their workers are calls or activities,
their programs are human-authored code, and nothing in them is interactive.
Here every atom is a terminal a human can open, and the program folder is
data an agent may author.

**…ralph / gnhf / AutoGPT-style loops** — a model driving itself toward a
stop condition. WhiteHartLane is the negation: deterministic loop, model at the
edges. (A ralph run is what *one booked pane* does.)

**…OpenClaw** — an always-on personal assistant gateway: one immortal agent
on your messaging channels. Opposite topology — disposable, booked panes born
from a door, dying with their job.

**…Devin / Jules / Morph** — the same insight ("give agents a machine and
supervise them") as a cloud product: opaque, managed, remote. WhiteHartLane is
the other bet: one machine, one user, every worker visible in a pane you can
read.

**Honest fits in the other direction:** a single-shot task needs only your
open chat (WhiteHartLane's own `direct` workflow says exactly that — the open
chat is the supervisor, no retry rail). A product-grade workflow you'll run
daily in production belongs to LangGraph Platform or Temporal. Adversarial,
must-not-escape sandboxing needs VMs — our standing threat model is *mistakes,
not adversaries*: capability scoping, not microVMs.

---

## The 60-second tour

```console
$ whl run <folder>               # the process door: books the job, starts the engine
$ whl run --from <tool>:<sid>    # the agent door: a levy commissions a spur, walks away
$ whl jobs                       # every job, its state, its receipt
$ whl events                     # the trace, raw
$ whl audit                      # any live pane no job admits is a finding
$ whl sweep                      # dead orchestrator? parked orphaned, ask-first
$ whl pause | abort | continue   # the park and rebirth verbs
$ whl fork <jid>                 # a booked wake, delivered into a reborn pane
```

`whl` is the short door. `bin/whitehartlane` is the same door spelled out —
every verb passes through unchanged (ADR 0006); the window server and the
docs use the long name, you'll type the short one.

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
- [`docs/adr/`](docs/adr/) — eleven accepted decisions, argued.
- [`docs/plans/eval-vs-single-agent.md`](docs/plans/eval-vs-single-agent.md)
  — how this OS gets evaluated against a single agent: paired arms,
  pre-registered hypotheses, attention and isolation instruments built
  on the trace.
- [`docs/research/eval-landscape.md`](docs/research/eval-landscape.md) —
  which famous benchmarks can measure a supervisor (and which are the
  wrong instrument), every citation verified.
- [`docs/research/papers.md`](docs/research/papers.md) — the design
  bets mapped to the literature: what supports them, what complicates
  them.
- [`docs/zen/`](docs/zen/) — the founding verbatim: what was tried, what was
  rejected, what is law.

*One machine. One user. Every worker visible. No mind in the loop.*
