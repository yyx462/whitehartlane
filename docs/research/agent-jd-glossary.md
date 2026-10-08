# Agent Dev JD Glossary — and where agentic-os already lives it

Three uses for one document:

1. **Job candidate aid** — the vocabulary, the frameworks, and the tradeoff language that 2026 Agent Dev JDs actually test.
2. **Product grounding** — every concept maps to code already in this repo (§4), so an interviewer can be told "I didn't just read about ReAct — here is where my OS implements the idea."
3. **Design input** — §5 is the differentiating feature this research unblocked: an agent whose output is a workflow (ADR 0004).

How to study: read §2 once, then drill §3 (the tradeoffs are what interviewers probe), then walk §4 file by file.

---

## 1. Market scan (2026, directional)

Signal, not census — links in §Sources.

- **Frameworks by hiring demand** (1,135 listings ranked): LangChain, LangGraph, LlamaIndex, CrewAI, AutoGen all sit in a **$185k–$190k median** band. Career advice converges: **LangGraph is the safest first pick** — "pick one framework, ship one demo."
- **What JDs ask for, in rough frequency order**: Python (dominant; TS acceptable), tool/function calling with **clear tool schemas**, **structured outputs**, **step limits / timeouts / safe handling of side effects**, RAG + vector DBs, agent **memory** design, **guardrails** and human-in-the-loop, **evaluation** (trajectory evals, LLM-as-judge), **observability/tracing** (LangSmith et al.), multi-agent orchestration, MCP integration, deployment (cloud, containers, MLOps).
- **The meta-skill JDs reward**: knowing *when not to use an agent*. Anthropic's canonical line — start with single LLM calls, add agentic complexity "only when it demonstrably improves outcomes" — shows up in interview loops as "walk me through when you'd use a workflow vs an agent."

The interview story for this repo: *Airflow for agents where the DAGs themselves are agent-planned.* Nobody else's elevator pitch says that.

---

## 2. Glossary

### 2.1 How it thinks — five orthogonal axes, not a menu

The JD trap: listing these as alternative "agent types." They are **axes** — one agent can be ReAct (control flow) + Reflexion (learning) + CodeAct (action format) simultaneously. Classify a system along all five; never "ReAct *or* Reflexion."

**Axis 1 — Inside one call: reasoning style**

**Chain-of-Thought (CoT)**
The model outputs intermediate reasoning steps before the answer. Not an architecture — a property of a single model call; the atom every outer pattern composes.

**Reasoning models / test-time compute** (o1/R1 lineage)
RL-trained models that emit long internal CoT by default — ToT-style search and backtracking *inside one call*. The trade: that deliberation lives server-side. OpenAI/Gemini return only summaries; Claude returns plaintext thinking with encrypted redactions; open-weight models return everything (and the encrypted blobs turned out to be replayable — Panfilov et al., arXiv:2608.09867).

**Axis 2 — Control flow: when the plan is made**

**ReAct** (Yao et al., 2022, arXiv:2210.03629)
Interleave Thought → Action → Observation in one loop; the model reasons about what it just saw before choosing the next tool call. *Just-in-time planning* — the default "agent loop" most people picture.
*Interview line*: "ReAct is the right pick when observations frequently change the next action; you pay for that adaptivity in LLM calls and loop-drift risk."

**Plan-and-Execute** (LangChain lineage; LLM+P, arXiv:2304.11477)
A planner LLM emits a full plan *up front*; an executor (often a smaller model) walks the steps; a replanner handles drift. Descendant of classical planning (PDDL as the plan language in LLM+P).
*Interview line*: "Plan-and-execute trades adaptivity for cost and reviewability — the plan is an artifact a human can inspect before any expensive step runs."

**ReWOO** (Xu, 2023, arXiv:2305.18309)
"Reason Without Observation": one planner pass produces a plan with **placeholders** for tool results; workers fill them; a solver combines. The frozen-plan extreme of this axis — fewest LLM calls, least adaptive.

**Axis 3 — Deliberation: how many paths**

**Tree of Thoughts (ToT)** (arXiv:2305.10601)
Explore a tree of reasoning branches with backtracking, not a single chain — a *harness-level* search pattern: the framework generates k candidates, scores states, prunes. Expensive; for hard search-like problems with a usable reward signal. Depth-1 ToT = best-of-N / self-consistency.

**LATS** (Zhou et al., 2023, arXiv:2310.04406)
Language Agent Tree Search: MCTS over *full agent trajectories* with self-reflection as the value signal. ToT where the nodes are tool-using episodes — the heavy end of the spectrum.

**Axis 4 — Learning: what persists across attempts**

**Reflexion** (Shinn et al., 2023, arXiv:2303.11366)
After a failed episode, the agent writes a *verbal self-critique* into memory; the next attempt starts with that critique in context. "Reinforcement learning with words instead of weights." Composable with any control-flow pattern — ReAct+Reflexion is the canonical pairing. Works when failures are diagnosable and the task is retryable.

**Memory & skill accumulation** (the Voyager lineage, arXiv:2305.16291)
Long-term memory as a *skill library* / episodic store the agent grows across tasks, not just a bigger context window.

**Axis 5 — Action format: what an action looks like**

**CodeAct**
Act by writing and executing code instead of emitting JSON tool calls. One program can compose many tools (loops, conditionals, variables). Requires a real sandbox; error surfaces are compiler/runtime rather than parse failures. JSON tool calling (§2.3's first term) is the other format on this axis.

### 2.2 Architecture taxonomy — "how is the system shaped"

The canonical split (Anthropic, *Building Effective Agents*): **agentic systems** divide into

- **Workflows** — LLMs and tools orchestrated through **predefined code paths**. Predictable, consistent, cheap per run.
- **Agents** — the LLM **directs its own process**, choosing tools and paths dynamically. Flexible, costlier, needs trust + guardrails.

Named workflow patterns (same source):

- **Prompt chaining** — fixed sequence of LLM steps, programmatic checks ("gates" in their diagram) between them.
- **Routing** — classify the input, dispatch to a specialized subpath (also: cheap model vs strong model routing).
- **Parallelization** — *sectioning* (independent subtasks in parallel) or *voting* (same task, several attempts, aggregate).
- **Orchestrator-workers** — a central LLM decomposes dynamically, workers execute, results synthesize. Unlike parallelization, subtasks are **not predefined** — the canonical coding-agent shape.
- **Evaluator-optimizer** — generator + critic in a loop (a.k.a. generator-verifier, reflection loop).

**Autonomous agent** — LLM with tools in a loop, ground truth from the environment each step, stopping conditions, human checkpoints when blockers hit.

**Multi-agent topologies** — hierarchical (manager/crew), sequential (pipeline of roles), parallel (debate/voting), **handoffs** (OpenAI Swarm vocabulary: one agent transfers control to another). Tradeoffs: separation of concerns and parallelism vs cost, error compounding, and debug pain.

**Human-in-the-loop (HITL)** — approval gates, checkpoints, escalation. In production JDs this is a *requirement*, not a nicety.

### 2.3 Tooling & engineering vocabulary — "the production cluster"

- **Tool calling / function calling** — model emits structured calls against declared schemas; the host executes and returns results. The `functions` API surface.
- **Structured outputs** — schema-constrained generation (JSON mode → strict schema). Pairs with tool calls; JDs ask for "clear tool schemas, structured outputs."
- **MCP (Model Context Protocol)** — open standard connecting models to tools/data sources; "USB-C for agent tools." The integrations vocabulary of 2026 JDs.
- **A2A** — agent-to-agent protocol (Google origin) for cross-vendor agent interop. Know the name and the one-liner.
- **RAG** — retrieval-augmented generation; know chunking, embeddings, reranking, and *when RAG alone beats an agent*.
- **Agent memory** — short-term (context window management), long-term (persistent store), episodic (past trajectories), procedural (skills). The survey framing (arXiv:2308.11432): profile / memory / planning / action modules.
- **Context engineering** — the 2026 replacement buzzword for prompt engineering at agent scale: what goes in the window, what gets compacted, what gets dropped. Compaction is a first-class design act.
- **Guardrails** — input/output validation, side-effect safety, permission scoping. **Sandboxing** — where untrusted actions (CodeAct, file writes) run.
- **Step limits / timeouts / retry caps** — the boring JD bullets that separate demos from production.
- **Agent evaluation** — trajectory evals (judge the *path*, not just the final answer), LLM-as-judge, golden tasks, online metrics. "How do you eval an agent?" is a standard loop question.
- **Observability / tracing** — every route, tool call, and retry recorded; LangSmith-class tooling. The answer "events.jsonl, append-only, everything else is a projection" is a strong answer.
- **Backpressure** — stop issuing provider calls when the provider refuses/slow, reopen when it recovers. Distinct from a static concurrency cap.

### 2.4 Frameworks & protocols — "the ecosystem cluster"

| Framework | One-liner for interviews | Positioning |
|---|---|---|
| **LangGraph** | Graph/state-machine agent runtime; explicit edges, checkpointing, human-in-the-loop primitives | The safe default on JDs; "LangChain's production answer" |
| **CrewAI** | Role-based crews (agent-as-team-member metaphor) | Fast prototyping, less control |
| **AutoGen / AG2** | Microsoft's conversational multi-agent runtime | Azure-shop favorite |
| **OpenAI Agents SDK** (Swarm lineage) | Minimal agents + **handoffs** + guardrails | The vendor-native minimalism play |
| **Claude Agent SDK** | Anthropic's managed agent loop | The "managed agents" direction |
| **smolagents** | HF's minimal **CodeAct**-first library | The "code is the action" bet |
| **Airflow** | The DAG scheduler everyone's heard of | This repo's contrast case: deterministic scheduler, **human-authored** DAGs — the gap agentic-os fills |

---

## 3. Tradeoffs — the interview spine

### 3.1 ReAct vs Plan-and-Execute vs ReWOO

| | ReAct | Plan-and-Execute | ReWOO |
|---|---|---|---|
| LLM calls | Many (one per step) | Planner + executor turns | One plan + workers + solver |
| Plan reviewability | None (emerges) | Plan artifact, inspectable | Plan artifact with placeholders |
| Adaptivity | High — reacts every observation | Medium — replanner handles drift | Low — plan is frozen |
| Failure mode | Loops, drift, cost blowout | Stale plan, replan latency | Wrong placeholder cascade |
| Cost | Highest | Medium | Lowest |
| Use when | Environment shifts mid-task; exploratory tasks | Steps are stable, plan should be reviewable, executor can be cheap | Task decomposes cleanly, tools are reliable, cost matters |

**Decision rule to say out loud**: "If the next action usually depends on what the last tool returned, ReAct. If the plan is knowable up front and a human should approve it, plan-and-execute. If the plan is knowable and *no one* needs to look, ReWOO for cost."

### 3.2 Reflexion
+ cheap accuracy gains; + no gradient/model access needed; − only helps when failures are diagnosable; − memory grows (needs curation). Say: "verbal self-critique between episodes — I'd pair it with a retry cap."

### 3.3 CodeAct
+ composition (loops over tool results, conditional logic); + one artifact instead of N JSON round-trips; − needs a real sandbox; − error surface moves to runtime. In this OS: every *worker pane* is a CodeAct agent — opencode/pi writing code in a scoped worktree.

### 3.4 LATS / ToT
+ escapes greedy first-path failures; − multiplies cost by branch factor. Use when a wrong path is expensive and reward is checkable (coding with tests; math with verifiers).

### 3.5 Single agent vs multi-agent
+ separation of concerns (specialized prompts/tools per role), parallelism, isolated context windows; − error compounding, cost multiplication, distributed debugging. The production instinct: **default to one agent with good tools; split only when context windows or specialization force it.** When you split, you inherit orchestration: this repo *is* that orchestration.

### 3.6 Workflow vs agent — the meta tradeoff, and this repo's answer

Anthropic's rule: workflows for predictability on well-defined tasks; agents for flexibility at scale; complexity only when measured to help. The unresolved tension in the field: agents are flexible but expensive and hard to trust; workflows are trustworthy but handwritten.

**agentic-os's answer — the line to memorize:**

> Use the agent once, at compile time: it plans the task into a reviewable program (`dag.mjs` + `workflow.toml`). Use the workflow many times, at run time: the Rail executes it deterministically, cheaply, observably.

Airflow DAGs are handwritten by humans. Here, **the DAG is the agent's output artifact** — plan-and-execute where the plan is a durable, versioned, diff-able file that then runs unattended. That's ADR 0004.

---

## 4. Concept → agentic-os map

Every row is an interview answer: "concept, definition, and here's my implementation of it."

| JD concept | agentic-os embodiment | Where |
|---|---|---|
| Workflow (predefined code paths) | `dag.mjs` parsed, never executed — "a program names steps; it does not call"; `tick()` is the only scheduler | `src/dag.ts` |
| Agent (LLM-directed) | the **Actor**: reads `actor.md`, writes `protocol.json` waves, decides stop | `src/protocol.ts`, `src/roles.ts` |
| Orchestrator-workers | **Fan-out** workflow: `units` hook decomposes, wave panes execute, report settles | `src/wave.ts`, `global/hooks/units.sh` |
| Parallelization (sectioning) | a Wave — N mock panes, rail waits for every End | `src/dag.ts` (`birth-wave`) |
| Evaluator-optimizer | the `grade` hook; grade failure re-prompts with backoff | `src/hooks.ts`, `src/live-grade.ts` |
| Routing | the **Scheduler**: `pick-workflow` routes fan-out vs direct via jev typed judgment | `bin/pick-workflow`, `src/policy.ts` |
| HITL | `gate` steps + `[gates]` commands (ADR 0003) | `src/hooks.ts`, `docs/adr/0003` |
| Guardrails / policy | admission: slots, retry cap, one Job per session; a model proposes, policy books | `src/policy.ts` |
| Backpressure | provider refusal (exit 75) → rail stops new provider calls, reopens on recovery | `src/backpressure.ts` |
| Multi-agent messaging | **Coworker**: named members, typed message files, the Rail is the relay | `src/coworker.ts` |
| Context reuse / seeding | **Fork**: a pane born seeded from a pointer into an existing host session | `src/bind.ts`, `seed_session` |
| Sandboxing / permissions | per-worker `opencode.json` external_directory allow-list from `roots.txt` | `src/permission.ts`, `src/store.ts` |
| Observability / tracing | append-only `events.jsonl`; all records are projections | `src/store.ts` |
| Memory (outliving) | `protocol.json`, `units/<id>/log.txt`, the trace — state that survives its writer | CONTEXT.md "Outliving memory" |
| Context engineering | `task.txt` one-liner, `actor.md` brief, `roots.txt` scope, grill before admission | `src/grill.ts`, `src/prep.ts` |
| Evaluation | grade/counts are hook commands — LLM-as-judge is a swappable hook, not a rail | `global/hooks/` |
| Versioning / identity | **Project** pid + `dag_id` + content hash: runs group wherever the folder lives | `src/project.ts` |
| Agent-planned workflows | **the Composer** (proposed): a program whose Actor writes new program folders | `docs/adr/0004` (proposed) |

---

## 5. The differentiator: agent-planned workflows (ADR 0004 in one paragraph)

A new meta-program — working name **Composer** — whose own DAG is `actor → gate → run-door`: the Actor takes a task ("cold" text or a project-context task with `roots.txt`), studies the example programs and rails contract, and **writes a new `agentic-program/<name>/` folder** (dag.mjs, workflow.toml, hooks/, actor.md); a gate holds for human approval (RAILS line 7: "a planner may write hooks; it may never rewrite rails"); the run door then books it like any program. Milestones: M1 CLI (`agentic-os run` on the Composer program — zero new surface code), M2 `POST /api/plan` in the web UI, M3 a chat entry in the window. Full text: `docs/adr/0004-main-agent-planner.md`.

Base-branch note (was open when this lane started): coworker and ui-window have merged (PRs #10, #9) — the Composer lane can spawn straight off master.

---

## Sources

- Anthropic, *Building Effective Agents* — the workflows-vs-agents taxonomy, all five workflow patterns, ACI appendix. https://www.anthropic.com/engineering/building-effective-agents
- Papers: ReAct arXiv:2210.03629 · ReWOO arXiv:2305.18309 · Reflexion arXiv:2303.11366 · ToT arXiv:2305.10601 · LATS arXiv:2310.04406 · LLM+P arXiv:2304.11477 · Voyager arXiv:2305.16291 · agent survey arXiv:2308.11432
- LangChain, *Plan-and-Execute Agents* (langchain.com); ReWOO pattern docs (agent-patterns.readthedocs.io)
- Comparisons: atlan.com "ReAct vs. Plan-and-Execute" (2026); blogs.oracle.com "ReAct vs Plan & Execute" (2026); nutrient.io "ReWOO vs. ReAct" (2025); dev.to "5 Agent Design Patterns" (2026); capabl.in "ReAct, ReWOO, CodeAct"
- Market: agentic-engineering-jobs.com "AI Agent Framework Jobs 2026: 1,135 Listings Ranked"; topgenaijobs.com "LangGraph vs CrewAI vs AutoGen"; ryzlabs.com AI Engineer JD template (2026)
