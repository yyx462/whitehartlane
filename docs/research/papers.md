# The paper trail — design bets mapped to the literature

Companion to `docs/plans/eval-vs-single-agent.md` and
`docs/research/eval-landscape.md`. Every arXiv ID here was verified
against its abs page (or its official project page for blogs) on
2026-10-14. The rule of this file: each design bet gets its supporting
evidence AND its complicating evidence, both named. A paper trail that
only cheers is marketing.

The bets are quoted from the README, which is the product's own words.

## A. "The supervisor never thinks" — no model in the loop

The orchestrator is a deterministic engine; judgment lives at the edges
(typed gates, hooks) or in workers (panes).

- **Kim, Moon, Tabrizi, et al. "An LLM Compiler for Parallel Function
  Calling." ICML 2024, arXiv:2312.04511.** Replaces the ReAct loop with
  a compiled plan: parallel execution, no model in the control path.
  Beats ReAct on HotpotQA/BBH at lower cost — the closest published
  mechanism to fan-out's bet. **Supports.**
- **Yao, Zhao, Yu, et al. "ReAct: Synergizing Reasoning and Acting in
  Language Models." ICLR 2023, arXiv:2210.03629.** The single-agent
  loop every bare arm runs; the thing being compared against.
  **Baseline.**
- **"SwarmBench: Can Large Language Models Act as Agent Swarm
  Orchestrators?" EMNLP 2026 Findings, arXiv:2608.30661.** Puts an LLM
  in the orchestration seat and measures accuracy/efficiency/cost:
  orchestration-by-LLM struggles, aggregation is the bottleneck.
  **Supports** keeping the middle mindless — and is the study to cite
  whenever "why not an LLM orchestrator?" comes up.
- **Anthropic, "Building Effective Agents" (engineering blog, Dec
  2024).** The workflow-vs-agent taxonomy this README borrows: composed
  pieces for predictable work, agent loops when flexibility dominates.
  Places agentic-os wholly on the workflow side with agents as workers.
  **Supports** (a taxonomy, not an experiment).
- **Kim, Gu, Park, et al. "Towards a Science of Scaling Agent
  Systems." arXiv:2512.08296** (Dec 2025; Google Research blog "Towards
  a science of scaling agent systems: when and why agent systems
  work," Jan 28, 2026). Varying
  orchestration architecture under fixed models: effects are real but
  modest and task-conditional; capability dominates architecture.
  **Complicates** every topology claim — the reason H1 predicts parity,
  not victory.
- **Gao, Li, Liu, et al. "Single-agent or Multi-agent Systems? Why Not
  Both?" arXiv:2505.18286** (Scale AI, 2025). Controlled comparison of
  single vs multi-agent systems across benchmarks: neither dominates
  universally; a hybrid that routes per query keeps most of both wins.
  **Complicates** — decomposition is not a default win, which is why
  the scheduler (workflow choice) exists as a seam.

## B. "Private stays private — by rule, not a line in a prompt"

Each agent sees only its own folders; messages cross, files don't;
permissions are typed gates.

- **Greshake, Abdelnabi, Mishra, et al. "Not what you've signed up
  for: Compromising Real-World LLM-Integrated Applications with
  Indirect Prompt Injection." 2023, arXiv:2302.12173.** Instructions in
  data can hijack an LLM app — a prompt is not a security boundary.
  The whole reason isolation is a filesystem rule here.
  **Supports.**
- **Bagdasarian, Yi, Ghalebikesabi, et al. "AirGapAgent: Protecting
  Privacy-Conscious Conversational Agents." ACM CCS 2024,
  arXiv:2405.05175.** Privacy via restricted data access enforced by
  design (sandboxing, allowlists), not by model compliance — the
  published shape of what per-member `roots` do. **Supports.**
- **Liu, Lin, Hewitt, et al. "Lost in the Middle: How Language Models
  Use Long Contexts." TACL 2024, arXiv:2307.03172.** One big shared
  context degrades retrieval (position bias) — partitioning evidence
  across workers can *help* accuracy, not just privacy.
  **Supports.**
- **Zhang, Sun, Chen, et al. "Chain of Agents: Large Language Models
  Collaborating on Long-Context Tasks." ICML 2025, arXiv:2406.02818.**
  Partitioned sequential workers beat single-context RAG at scale —
  and pay an information-loss tax at each hand-off. **Supports and
  complicates:** isolation has a capability price, which H5 exists to
  measure.
- **Jiang, Wu, Lin, et al. "LLMLingua: Compressing Prompts for
  Accelerated Inference of Large Language Models." EMNLP 2023,
  arXiv:2310.05736.** The single-context alternative: compress instead
  of partition. **Complicates** — for cheap privacy-free tasks,
  partitioning is not the only lever.

## C. "Run first, tune from the trace"

The untuned loop runs today; the trace becomes tomorrow's cheaper
prompt or fixed workflow.

- **Khattab, Singhvi, Maheshwari, et al. "DSPy: Compiling Declarative
  Language Model Calls into Self-Improving Pipelines." ICLR 2024,
  arXiv:2310.03714.** Prompts as compiled artifacts, optimized from
  execution metrics — the automated analogue of "fold what worked into
  one prompt." **Supports.**
- **Zhang, Xiang, Yu, et al. "AFlow: Automating Agentic Workflow
  Generation." ICLR 2025, arXiv:2410.10762.** Monte-Carlo tree search
  over workflow space, scored by execution traces — the automated
  analogue of "keep the steps, drop the model." **Supports.**
- **Yuksekgonul, Bianchi, Boen, et al. "TextGrad: Automatic
  'Differentiation' via Text." NeurIPS 2024, arXiv:2406.07496.**
  Optimization-by-critique over arbitrary text graphs — a general
  engine for trace-driven improvement. **Supports.**
- **Hu, Lu, Clune. "Automated Design of Agentic Systems."
  arXiv:2408.08435.** Meta-agents programming new agent designs; the
  "an agent can write the hooks" claim's academic cousin.
  **Supports.**
- **Wang, Mao, Fried, et al. "Agent Workflow Memory." arXiv:2409.07429.**
  Distills reusable workflows from an agent's own experience into
  evolvable memory — the nearest published mechanism to "the trace is
  the half you reuse." **Supports.**
- **Complication, honestly stated:** all of these automate what the
  product promises a person does once, by hand, from a readable trace.
  H2 (plan §5) measures the manual claim the README actually makes.

## D. "You get the trace" — and grade from it

- **Lightman, Koseraju, Burda, et al. "Let's Verify Step by Step."
  2023, arXiv:2305.20050.** Rewarding correct reasoning steps beats
  outcome-only reward — process-level grading works. The `grade` hook
  and MAST coding are process-level by the same instinct.
  **Supports.**
- **Zhuge, Zhao, Ashley, et al. "Agent-as-a-Judge: Evaluate Agents
  with Agents." 2024, arXiv:2410.10934.** Evaluating runs from their
  intermediate artifacts rather than final answers alone — with an LLM
  as judge. Our judges are typed commands (exit 0 / strict JSONL); the
  paper is the LLM-judge variant of the same turn to the trace.
  **Supports, with a design difference.**
- **Anthropic, "Measuring AI agent autonomy in practice" (Feb 18,
  2026).** Interventions-per-session from production telemetry
  (5.4 → 3.3 over five months) — the published precedent for the
  attention metric (plan §4). **Supports.**

## E. Multi-agent vs single agent — what the evidence says

The center of the file, because the README says "one agent may well be
the right end state" and the eval must be able to confirm that.

- **Cemri, Pan, Yang, et al. "Why Do Multi-Agent LLM Systems Fail?"
  2025, arXiv:2503.13657.** Codes failures across five frameworks into
  a taxonomy (inter-agent misalignment, specification and system-design
  issues, verification gaps…) and finds most failure modes are unique
  to multi-agent systems. The reason coworker is a separate workflow
  with a typed relay, and the taxonomy the plan codes failures against
  (§6). **Complicates multi-agent, supports typed rails.**
- **Gao et al., arXiv:2505.18286** (§A above): neither single nor
  multi dominates; routing per task keeps most wins. **Complicates.**
- **Li, Zhang, Yu, et al. "More Agents Is All You Need." TMLR 2024,
  arXiv:2402.05120.** Sampling-and-voting accuracy scales with the
  number of agents on a range of tasks — the cheap-parallelism prior
  behind fan-out over independent instances. **Supports T1.**
- **Chen, Davis, Hanin, et al. "Are More LLM Calls All You Need?
  Towards Scaling Laws of Compound Inference Systems." 2024,
  arXiv:2403.02419.** Compound inference improves then saturates with
  more calls — budgets, not just widths. The reason iso-budget is a
  pairing rule (plan §2.3) and H2 is about the second run, not the
  first. **Complicates blind fan-out.**
- **Qian, Xie, Wang, et al. "Scaling Large Language Model-based
  Multi-Agent Collaboration." ICLR 2025, arXiv:2406.07155.**
  Accuracy on collaborative software tasks scales with topology size —
  evidence collaboration structure can pay, in-model-node systems.
  **Supports, different substrate.**
- **Tran, Dao, Nguyen, et al. "Multi-Agent Collaboration Mechanisms: A
  Survey of LLMs." 2025, arXiv:2501.06322** and **Guo, Chen, Wang, et
  al. "Large Language Model based Multi-Agents: A Survey of Progress
  and Challenges." 2024, arXiv:2402.01680.** The two maps of the
  territory the README's "why not just…" section walks without citing.
  **Context.**
- **Anthropic, "How we built our multi-agent research system"
  (engineering blog, Jun 13, 2025).** Orchestrator-worker in
  production; also candid that it multiplies tokens (~15× their chat
  usage). **Supports the pattern, complicates the cost story** — H2 is
  the answer to exactly this.

## F. The OS metaphor — lineage, and what the nickname borrows

- **Packer, Wooders, Lin, et al. "MemGPT: Towards LLMs as Operating
  Systems." 2023, arXiv:2310.08560.** The OS metaphor applied to *the
  context window* (memory hierarchy, paging). agentic-os applies it to
  *processes* — birth, accounting, isolation of real OS processes.
  Same nickname, different resource. **Namesake.**
- **Mei, Zhu, Xu, et al. "AIOS: LLM Agent Operating System." COLM
  2025, arXiv:2403.16971.** An agent OS kernel: scheduling agent
  requests, context storage. The academic namesake; contrast — our
  scheduler is deterministic, panes are real processes a human can
  watch, and no inference runs inside the OS. **Namesake, contrasted.**
- **Park, O'Brien, Cai, et al. "Generative Agents: Interactive
  Simulacra of Human Behavior." UIST 2023, arXiv:2304.03442.** The
  memory-stream origin of "durable state outside the worker" — 25
  agents in a town, state in files, not heads. **Lineage.**
- Frameworks (the conversation-inside-one-runtime lineage the README
  rejects): see the table below.
- **The nickname, honestly:** no canonical arXiv paper titled "AgentOS"
  exists. The closest real namesakes are UFO2's "The Desktop AgentOS"
  (arXiv:2504.14603, Microsoft, 2025 — GUI, not processes) and an
  unrelated data-ecosystem paper (arXiv:2603.08938). "OS" here borrows
  the metaphor (birth, accounting, isolation), not a citation.

## G. Reliability engineering — retries, backpressure, receipts

- **Reactive Streams** (already the repo's cited lineage in
  `research/glossary-sources.md`): bounded queues, destination-paced
  flow — where "backpressure ≠ concurrency limit" comes from.
- **Yao, Shinn, Razavi, Narasimhan. "τ-bench." 2024,
  arXiv:2406.12045.** `pass^k` — all-k-must-succeed — makes
  reliability a first-class benchmark metric; adopted as H6's
  instrument. **Supports.**
- **MAST, arXiv:2503.13657** (§E): the failure taxonomy doubles as a
  monitoring checklist — every category a rail could count becomes a
  counter worth emitting. **Supports.**

## H. Unattended runs and the attention budget

- **Kwa, West, Becker, et al. "Measuring AI Ability to Complete Long
  Software Tasks." NeurIPS 2025, arXiv:2503.14499.** Task-length
  autonomy as a time horizon (50%-completion time, doubling ~7
  months) — the framing for "runs while you don't watch."
  **Supports.**
- **Xu, Song, Li, et al. "TheAgentCompany." arXiv:2412.14161.**
  Autonomous completion as the headline metric of a professional-task
  benchmark — unattended-ness is measurable, not vibes. **Supports.**
- **Feng, McDonald, Zhang. "Levels of Autonomy for AI Agents." 2025,
  arXiv:2506.12469.** An autonomy ladder (operator → observer) — the
  vocabulary for permission levels a typed gate sits on.
  **Context.**
- **Cihon, Stein, Bansal, et al. "Measuring AI agent autonomy: Towards
  a scalable approach with code inspection." 2025, arXiv:2502.15212.**
  Scores orchestration code itself for oversight/impact — a method
  aimed at supervisors like this one. **Context.**

## The framework table (section F's one-liners)

| System | Citation | One line |
|---|---|---|
| CAMEL | Li, Hammoud, Itani, et al. NeurIPS 2023, arXiv:2303.17760 | role-playing agent society; inception prompting |
| AutoGen | Wu, Bansal, Zhang, et al. 2023, arXiv:2308.08155 | multi-agent conversation as the programming model |
| MetaGPT | Hong, Zhuge, Chen, et al. ICLR 2024, arXiv:2308.00352 | SOPs encoded as multi-agent roles for software |
| ChatDev | Qian, Liu, Liu, et al. ACL 2024, arXiv:2307.07924 | chat-chain software company (virtual cameras) |
| AgentVerse | Chen, Su, Zuo, et al. 2023, arXiv:2308.10848 | dynamic expert recruitment, in-framework |
| AgentScope | Gao, Li, Pan, et al. 2024, arXiv:2402.14034 | fault-tolerant multi-agent platform |
| GPTSwarm | Zhuge, Wang, Kirsch. "Language Agents as Optimizable Graphs." ICML 2024, arXiv:2402.16823 | agents as optimizable graphs |
| DyLAN | Liu, Zhang, Li, et al. "A Dynamic LLM-Powered Agent Network for Task-Oriented Agent Collaboration." COLM 2024, arXiv:2310.02170 | dynamic agent-team formation |

## Keeping this file honest

1. Every ID was fetched on 2026-10-14; re-verify before extending.
2. A bet entry without a **Complicates** line is incomplete — add one
   or say why none was found.
3. Engineering blogs are cited as org + title + date + URL, never as
   papers.
4. If the eval contradicts a paper's prediction here, the result gets
   written next to the paper, not instead of it.
