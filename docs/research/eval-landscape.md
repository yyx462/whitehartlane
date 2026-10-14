# The eval landscape — which famous benchmarks can measure this OS

Survey for the eval plan (`docs/plans/eval-vs-single-agent.md`). What
WhiteHartLane varies is not the model but the supervision — so the
instrument must accept an arbitrary terminal CLI as the worker, hold
the model fixed, and score outcomes the rails could plausibly move:
success, reliability across repeats, unattended completion, human
interventions. Every citation here was verified against its arXiv abs
page or official project page on 2026-10-14; what could not be
verified is named as such at the bottom.

## The fit table

| Benchmark | Verifies arXiv/URL | Measures | Env | Worker interface | Fit |
|---|---|---|---|---|---|
| Terminal-Bench 2.0 | 2601.11868 | end-to-end terminal tasks, pass/fail | Docker | **official harness drives arbitrary CLI agents** | **HIGH** |
| SWE-bench Verified | openai.com blog 2024 | % real GitHub issues resolved | Docker | any patch-producing agent | **HIGH** |
| SWE-bench | 2310.06770 (ICLR 2024) | same, 2,294 instances | Docker | same | HIGH |
| TheAgentCompany | 2412.14161 | **autonomous** completion, professional tasks | Docker Compose (GitLab/Plane/ownCloud/RocketChat) | run-your-own-agent path | **HIGH** |
| SWE-bench Pro | 2509.16941 | long-horizon enterprise SWE, Pass@1 (GPT-5: 23.3%) | Docker | SWE-agent-style | MEDIUM-HIGH |
| MultiAgentBench (MARBLE) | 2503.01935 (ACL 2025) | collaboration: TS + CS + milestones; **topology as treatment** | own engine, API agents | borrow metrics, not harness | MEDIUM |
| τ-bench / τ²-bench | 2406.12045 / 2506.07982 | tool-agent-user + **pass^k** reliability | pure software, function calls | API-side only | MEDIUM (metric) |
| Gaia2 | 2602.11964 (+ARE 2509.17158) | async, dynamic environments; write-action verifiers | ARE platform, APIs | not terminal | MEDIUM (concept) |
| MLE-bench | 2410.07095 | Kaggle ML engineering, medals | Docker, hours, GPU | container-working agents | MEDIUM |
| RE-Bench | 2411.15114 | score-under-time-budget vs human experts | GPU envs | container agents | MEDIUM |
| SwarmBench (orchestrator) | 2608.30661 (EMNLP 2026 Find.) | **LLMs as swarm orchestrators** | API agents | the counterfactual arm | MEDIUM (cite) |
| GAIA | 2311.12983 | general assistant QA, 3 levels | live web | web tools | LOW (drift) |
| Multi-SWE-bench | 2504.02605 | issue-resolving, 7 non-Python langs | Docker | patch agents | MEDIUM |
| AgentBench | 2308.03688 (ICLR 2024) | 8 interactive envs | mixed, drifted | API | LOW |
| OSWorld | 2404.07972 | GUI computer use | VMs | GUI actuation | wrong instrument |
| WebArena | 2307.13854 | web GUI tasks | self-hosted web | browser | wrong instrument |
| GPQA / MMLU / HumanEval | 2311.12022 / 2009.03300 / 2107.03374 | single-shot ability | none | none | wrong instrument |

## The three that matter first

### Terminal-Bench 2.0 — the closest existing instrument

Merrill, Shaw, Carlini, et al. "Terminal-Bench: Benchmarking Agents on
Hard, Realistic Tasks in Command Line Interfaces" (arXiv:2601.11868;
Stanford / Laude Institute; site tbench.ai). 89 curated tasks, each an
instruction + Docker environment + human-written oracle + verification
tests; metric is resolution rate with 95% CIs on the leaderboard;
frontier agents under 65% at paper time. Agents plug in behind the
harness's solve interface — the leaderboard already ranks Codex CLI,
Droid, mini-swe-agent: **the official harness exists to drive external
terminal CLIs**, which is exactly our worker shape. Terminal-Bench 1.0
(2025, ~100 tasks) has no paper — cite the repo
(github.com/laude-institute/terminal-bench). Why first: terminal-native,
Docker-isolated, pass/fail, unattended-by-design — every phase-1 claim
(H1, H3, H4) reads directly off it.

### SWE-bench Verified — the gold standard, with a caveat

Jimenez, Yang, Wettig, et al. "SWE-bench: Can Language Models Resolve
Real-World GitHub Issues?" (ICLR 2024, arXiv:2310.06770); Verified is
the 500-instance human-validated subset (OpenAI blog, Aug 2024 — no
arXiv). The harness grades a patch, so any checkout-working CLI agent
plugs in; **mini-swe-agent** (github.com/SWE-agent/mini-swe-agent, no
paper) is the cleanest template for driving ours and reports >74%
Verified with frontier models. Caveat, stated before we lean on it:
OpenAI's Feb 23, 2026 post "Why SWE-bench Verified no longer measures
frontier coding capabilities" reports test-design and contamination
problems (59.4% of audited unsolved o3 instances), and "The SWE-Bench
Illusion" (arXiv:2506.12286)
documents memorization. We use Verified for the *paired difference*
(contamination is shared across arms — see plan §7), never for
leaderboard absolutes, and hold **SWE-bench Pro** (arXiv:2509.16941,
Scale AI; 1,665 problems, public/held-out/commercial splits, GPT-5 at
23.3%) as the contamination-resistant sub-study if phase 1 warrants.

### TheAgentCompany — the unattended instrument

Xu, Song, Li, et al. "TheAgentCompany: Benchmarking LLM Agents on
Consequential Real World Tasks" (arXiv:2412.14161; CMU-led; v3 Sept
2025). 175 professional tasks in a simulated software company
(Docker Compose: GitLab, Plane, ownCloud, RocketChat; 30+ GB). The
headline metric is **autonomous** task completion — best 2024/25
baselines ~30% — with subcheckpoint scoring and a documented
run-your-own-agent path (start container, `init.sh`, prompt the agent
with `/instruction/task.md`, grade with `eval.py`). This is the natural
testbed for coworker (T2): the world partitions by application, the
coworkers are already there, and "did it finish without a person" is
the native metric, not an afterthought.

## What we borrow without running

- **pass^k** from τ-bench (Yao, Shinn, Razavi, Narasimhan,
  arXiv:2406.12045): probability that all k independent trials succeed
  — the published reliability metric that matches our rail claims. τ²
  (arXiv:2506.07982) adds dual-control and a solo/interactive
  decomposition that is a methodological template for separating
  coordination overhead from task ability.
- **TS + CS + milestones** from MultiAgentBench (Zhu, Du, Hong, et al.,
  ACL 2025, arXiv:2503.01935; code MARBLE): they hold the model fixed
  and vary *coordination topology* — our exact experimental logic — and
  their Task-Score / Collaboration-Score dissociation is the reason we
  score outcomes and collaboration separately. Their agents live
  inside one framework with no OS-level isolation; we borrow the metric
  design, not the harness.
- **Interventions per session** — Anthropic, "Measuring AI agent
  autonomy in practice" (blog, Feb 18 2026): 5.4 → 3.3 interventions
  per session measured on Claude Code telemetry. The published
  precedent for our attention metric.
- **Time horizons** — Kwa, West, Becker, et al. "Measuring AI Ability
  to Complete Long Software Tasks" (NeurIPS 2025, arXiv:2503.14499):
  50%-completion time horizon, doubling ~7 months. Frames unattended
  claims as task-length autonomy.
- **Score-under-time-budget** from RE-Bench (Wijk, Lin, Becker, et al.,
  arXiv:2411.15114): how to argue rails convert wall-clock into
  outcomes without claiming raw capability.
- **Orchestrator evaluation** — "SwarmBench: Can LLMs Act as Agent
  Swarm Orchestrators?" (arXiv:2608.30661): the counterfactual to our
  no-mind-in-the-loop bet — cite it where the plan needs the LLM-
  orchestrator alternative represented.
- **Task format** — METR Task Standard (github.com/METR/task-standard;
  **archived Oct 2026**, maintainers moved to UK AISI Inspect): the
  reference for environment + instruction + `TaskFamily` scoring with
  internet/permission toggles. Cite as the shape our `lab` programs
  echo, and as superseded.
- **Autonomy vocabulary** — Feng, McDonald, Zhang, "Levels of Autonomy
  for AI Agents" (arXiv:2506.12469); Cihon, Stein, Bansal, et al.,
  "Measuring AI agent autonomy: Towards a scalable approach with code
  inspection" (arXiv:2502.15212) — the latter literally audits
  orchestration code for oversight, i.e. a method aimed at supervisors
  like us.

## The gap nobody covers (state it, don't hide it)

No verified benchmark evaluates multi-agent LLM **software**
collaboration with real OS-level isolation between independent agent
processes: MultiAgentBench's agents share one framework process;
TheAgentCompany is a single agent talking to NPC coworkers. Per-pane
filesystem isolation with a typed relay — the coworker workflow's whole
mechanism — has no famous instrument. That is why the plan builds two
of its own instruments (attention accounting, canary isolation probes)
on top of the trace instead of waiting for a benchmark to ship them.

## Wrong instruments, named to preempt the question

- **GPQA (2311.12022) / MMLU (2009.03300) / HumanEval (2107.03374)**:
  single-shot, no tools, no environment. They measure the model; the
  model is held constant here. Including them would confound
  orchestration effect with model ability.
- **OSWorld (2404.07972) / WebArena (2307.13854)**: GUI actuation. Our
  workers are terminal processes; the OS is not in the GUI loop.
- **GAIA (2311.12983)**: live-web QA — answers rot, scores don't
  reproduce; humans 92% vs GPT-4+plugins 15% says nothing about
  supervision. Gaia2 (arXiv:2602.11964, ICLR 2026) fixes the drift
  with async environments and write-action verifiers — conceptually the
  best unattended instrument yet, but consumer-app APIs, not panes.

## Verified-failure list (kept so nobody re-chases them)

- A multi-agent "MACBench" does not exist as described (MaCBench is a
  chemistry benchmark, arXiv:2411.16955; MacAgentBench is a macOS
  desktop-agent benchmark, arXiv:2606.22557).
- A Huawei autonomy benchmark "AutoIF" could not be verified (AutoIF
  in the literature is an instruction-following reward method).
- Terminal-Bench 1.0 and mini-swe-agent have no citable papers —
  cite the repos.
- SwarmBench is two unrelated benchmarks (swarm intelligence,
  arXiv:2505.04364; LLM orchestrators, arXiv:2608.30661) — cite the
  right one.
