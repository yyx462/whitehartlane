# Glossary sources

Concept kit before any code. Each idea is tagged **inherited** (operating systems, container orchestration, or distributed systems), **paper** (a blog or paper), or **invented** (ours; no source said it). Tony Chang's post is a spark, not a spec: [A Million Agents Is a Distributed Systems Problem](https://www.instacloud.com/blogs/a-million-agents-is-a-distributed-systems-problem).

Numbers below are taken from the Google Research blog or the paper abstract, not from Chang's retelling. The blog and the paper abstract do not agree with each other; see Open questions.

## Do not collapse

- **Scheduler ≠ orchestrator.** A scheduler places work onto a resource. Kubernetes: "scheduling refers to making sure that Pods are matched to Nodes" ([kube-scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)). An orchestrator decomposes, delegates, and synthesizes. Google Research defines centralized as "a central orchestrator delegates tasks to workers and synthesizes their outputs" ([blog](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/)).
- **Scheduler ≠ hierarchy ≠ workflow.** LLM-as-Scheduler "dynamically chooses the right workflow for each query" ([ACL abstract](https://aclanthology.org/2026.acl-long.581/)). Chang lists "a scheduler, some hierarchy" as two needs, and never defines hierarchy ([blog](https://www.instacloud.com/blogs/a-million-agents-is-a-distributed-systems-problem)). A workflow is a chosen procedure. A hierarchy is not that procedure.
- **Leader ≠ owner.** A leader is the one server allowed to append the log: "Raft implements consensus by first electing a distinguished leader, then giving the leader complete responsibility for managing the replicated log" ([Raft extended paper](https://raft.github.io/raft.pdf), §5). An owner is a recorded parent of a dependent object, not the elected coordinator ([Owners and Dependents](https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/)).
- **Outliving memory ≠ the agent's context window.** Chang: "The failures that actually hurt are the ones where the plan lived only inside the agent's context window" and "the durable thing should be the state, not the agent" ([blog](https://www.instacloud.com/blogs/a-million-agents-is-a-distributed-systems-problem)). AIOS context snapshot is how a live inference is paused, not where the plan lives ([AIOS HTML](https://ar5iv.labs.arxiv.org/html/2403.16971), §3.4).
- **Observability ≠ the wake channel.** OpenTelemetry signals "describe the underlying activity" and are traces, metrics, logs, and baggage ([Signals](https://opentelemetry.io/docs/concepts/signals/)). A wake is a request for attention. **Invented:** they are different channels.
- **Backpressure ≠ concurrency limit.** Reactive Streams: backpressure exists "so that a fast data source does not overwhelm the stream destination" and so queues "are bounded" ([spec](https://www.reactive-streams.org/)). Kubernetes API Priority and Fairness is a concurrency-seat and queue limit on the API server, not a destination saying "slow down" ([APF](https://kubernetes.io/docs/concepts/cluster-administration/flow-control/)).

## Scheduler

**Working definition.** The component that chooses which runnable unit gets a scarce resource next, and binds that choice. It does not decompose the goal or merge the results. **Invented narrowing:** in this system the scarce choice is which hierarchy runs a task, not which CPU runs a thread.

**Lineage.** Inherited, from OS and Kubernetes scheduling. Paper extension: AIOS schedules agent syscalls; LLM-as-Scheduler chooses a workflow per query.

**Source.** "A scheduler watches for newly created Pods that have no Node assigned. For every Pod that the scheduler discovers, the scheduler becomes responsible for finding the best Node for that Pod to run on." [kube-scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/). Linux: "CFS stands for 'Completely Fair Scheduler,' and is the 'desktop' process scheduler" and "it always tries to run the task with the smallest p->se.vruntime value." [CFS](https://docs.kernel.org/scheduler/sched-design-CFS.html). AIOS: "For managing system calls, we implement two classic algorithms: First-In-First-Out (FIFO) ... and Round Robin (RR)." [AIOS HTML §3.3](https://ar5iv.labs.arxiv.org/html/2403.16971). LAS: "an LLM-based scheduler uses query features and gate signals to make more detailed routing decisions." [ACL abstract](https://aclanthology.org/2026.acl-long.581/).

Textbook passage not fetched. No Tanenbaum quote.

**Not.** Not the orchestrator. Not the hierarchy. Not FIFO/RR (those are policies a scheduler may use).

**Design consequence.** The scheduler may select a hierarchy only from declared task-shape, inputs, outputs, and admission signal. It must not read the hierarchy's internals to place work.

## Hierarchy

**Working definition.** **Invented.** A named, schedulable unit of coordination with one outside contract. It is the thing a scheduler picks. It is not the org chart inside it, and not the step graph it runs.

**Lineage.** The word is **paper** (Chang's list). The definition is **invented**. Sources use three different shapes and do not pick one: org-tree, workflow-graph, architecture.

**Source.** Chang: "So you need a scheduler, some hierarchy, memory that outlives the worker..." and earlier "we invented teams, managers, departments, and eventually a CEO." [blog](https://www.instacloud.com/blogs/a-million-agents-is-a-distributed-systems-problem). LAS schedules a "workflow," not a hierarchy ([ACL abstract](https://aclanthology.org/2026.acl-long.581/)). Google Research schedules among architectures: single-agent, independent, centralized, decentralized, hybrid ([blog](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/)). AgentNet routes on "a dynamically structured Directed Acyclic Graph (DAG)" ([abstract](https://arxiv.org/abs/2504.00587)).

**Not.** Not a workflow (the internal or chosen procedure). Not an orchestrator (a role that may or may not sit inside a hierarchy). Not a Kubernetes controller.

**Design consequence.** The scheduler's catalog is a set of hierarchies. Each hierarchy may contain a workflow and may or may not contain an orchestrator. Those are fields on the contract, not synonyms for the hierarchy.

### Workflow (adjacent)

**Working definition.** The procedure a hierarchy runs for one task: sequential, parallelizable, or a heavier multi-step graph. **Invented** as a field of a hierarchy; the word is from LAS.

**Source.** "many queries do not need such heavy processing" and LAS "dynamically chooses the right workflow for each query." [ACL abstract](https://aclanthology.org/2026.acl-long.581/).

**Not.** Not the scheduler that chooses it. Not the hierarchy that owns the contract.

### Orchestrator (adjacent)

**Working definition.** A role that decomposes a goal, assigns parts, watches progress, and synthesizes results. It is a job, not a placement algorithm.

**Lineage.** Paper. Google Research names it; Chang describes the job without equating it to the scheduler.

**Source.** "A 'hub-and-spoke' model where a central orchestrator delegates tasks to workers and synthesizes their outputs." [Google Research blog](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/). Chang: "The manager doesn't do every task. It decides what needs to happen, breaks the work apart, assigns it, watches progress, resolves conflicts, and combines the results." [blog](https://www.instacloud.com/blogs/a-million-agents-is-a-distributed-systems-problem). AgentNet's opposite: "a fully decentralized coordination mechanism that eliminates the need for a central orchestrator." [abstract](https://arxiv.org/abs/2504.00587).

**Not.** Not the scheduler. Not the leader (a leader may be replaced by election; an orchestrator in the Google study is an architecture, not a lease). Not the owner of workers.

## Outliving memory

**Working definition.** State that remains after the worker that wrote it is gone, so another worker can resume. **Invented narrowing:** "outliving memory" means the durable record (goals, plan, done, pending, artifacts, ownership, checkpoints), not the RAM/disk swap AIOS calls a memory manager, and not the context window.

**Lineage.** Paper. Chang's phrase. The list of what survives is his FAQ, not a spec.

**Source.** "So the durable thing should be the state, not the agent." "memory that outlives the worker." "Goals, plans, decisions, completed and pending tasks, artifacts, ownership, and checkpoints. If that state is durable and outside any single agent, an agent can run out of context, get killed, or be rescheduled, and the work continues." [blog](https://www.instacloud.com/blogs/a-million-agents-is-a-distributed-systems-problem). Meiklejohn: multiple agents on one codebase are "multiple autonomous processes that share state," and shared mutable state without concurrency control is the failure mode ([post](https://christophermeiklejohn.com/ai/agents/distributed/zabriskie/2026/03/30/multi-agent-systems-have-a-distributed-systems-problem.html)).

**Not.** Not the context window. Not an AIOS context snapshot (pause/resume of one generation). Not AIOS memory swapping of conversation history between RAM and disk ([AIOS HTML §3.5](https://ar5iv.labs.arxiv.org/html/2403.16971)).

**Design consequence.** The hierarchy contract names where durable state lives and what a replacement worker is allowed to read. The scheduler does not keep that state.

### Context switch / snapshot (adjacent)

**Working definition.** Saving enough of a running unit to stop it and start it again on the same computation. In an OS that is a process switch. In AIOS it is a generation snapshot.

**Lineage.** Inherited (OS process switch) plus paper (AIOS snapshot). Not the same as outliving memory.

**Source.** Linux CFS `task_tick`: "it might lead to process switch." [CFS](https://docs.kernel.org/scheduler/sched-design-CFS.html). AIOS: "Our context interrupt mechanism addresses this via task interruption and resumption through snapshot and restoration operations." [AIOS HTML §3.4](https://ar5iv.labs.arxiv.org/html/2403.16971).

**Not.** Not the durable plan. A snapshot dies with the generation format; outliving memory must be readable by a different agent.

### Process (adjacent)

**Working definition.** The OS unit the scheduler runs and can preempt. Agent papers borrow the word; they do not replace the kernel definition.

**Lineage.** Inherited. Textbook not fetched.

**Source.** CFS is "the 'desktop' process scheduler" and "the scheduler operates on individual tasks." [CFS](https://docs.kernel.org/scheduler/sched-design-CFS.html). AIOS maps the analogy onto syscalls, not onto kernel processes: "agent queries are decomposed into sub execution units (i.e., AIOS syscalls)." [AIOS HTML §1](https://ar5iv.labs.arxiv.org/html/2403.16971). Chang: "Schedule agents like processes and recover them like nodes." [blog](https://www.instacloud.com/blogs/a-million-agents-is-a-distributed-systems-problem) — analogy, not a definition.

**Not.** Not an agent. Not a hierarchy.

### Checkpoint (adjacent)

**Working definition.** A durable cut of progress that a later worker can resume from. **Invented narrowing:** a checkpoint is one kind of outliving memory, not the whole of it.

**Lineage.** The word is paper (Chang's survive-list). No source here defines the checkpoint format.

**Source.** Chang's survive-list includes "checkpoints" ([blog FAQ](https://www.instacloud.com/blogs/a-million-agents-is-a-distributed-systems-problem)). He defers "the checkpoints, the scheduler" to a later post. Raft's durable thing is the replicated log, not a checkpoint API: "Raft is a consensus algorithm for managing a replicated log." [paper abstract, §1 / USENIX](https://www.usenix.org/conference/atc14/technical-sessions/presentation/ongaro).

**Not.** Not a context snapshot. Not a heartbeat.

## Ownership

**Working definition.** A recorded fact that one object is the parent of another, so other actors do not mutate or delete what they do not control. **Invented narrowing:** a hierarchy declares two ownerships — of workers, and of artifacts — and they may differ.

**Lineage.** Inherited, from Kubernetes owners and dependents. Chang lists "ownership" as something that must outlive the agent; he does not define the record.

**Source.** "In Kubernetes, some objects are owners of other objects. For example, a ReplicaSet is the owner of a set of Pods. These owned objects are dependents of their owner." "Owner references help different parts of Kubernetes avoid interfering with objects they don't control." [Owners and Dependents](https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/).

**Not.** Not the leader. Not a label/selector match (Kubernetes says ownership is different from labels). Not "I spawned it, so it is mine" without a record.

**Design consequence.** The contract names the owner of workers and the owner of artifacts. A scheduler must not treat a live worker as the owner of the artifact it is writing.

## Backpressure

**Working definition.** A signal from the receiving side that bounds how much a sender may emit, so the receiver is not forced to buffer without limit. **Invented narrowing:** the hierarchy exposes that signal on its contract; where the signal is enforced is an open question.

**Lineage.** Inherited, from Reactive Streams. Not defined by the agent papers.

**Source.** "resource consumption needs to be controlled such that a fast data source does not overwhelm the stream destination." "back pressure is an integral part of this model in order to allow the queues which mediate between threads to be bounded." [Reactive Streams](https://www.reactive-streams.org/).

**Not.** Not a concurrency cap. APF: "Each incoming request is assigned to a single priority level, and each priority level will only dispatch as many concurrent requests as its particular limit allows." [APF](https://kubernetes.io/docs/concepts/cluster-administration/flow-control/). That is admission of seats, not destination-driven demand. Not "max agents."

**Design consequence.** The contract declares the backpressure signal (what "slow down" means for this hierarchy). It does not declare the queue implementation.

### Admission control (adjacent)

**Working definition.** A gate that accepts, mutates, or rejects a request before it becomes state. It runs at the front door, not inside the worker.

**Lineage.** Inherited, Kubernetes.

**Source.** "An admission controller is a piece of code that intercepts requests to the Kubernetes API server prior to persistence of the resource, but after the request is authenticated and authorized." [Admission Control](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/).

**Not.** Not backpressure. Admission says yes/no (or rewrite) at entry. Backpressure says the consumer cannot take more.

## Fail recovery

**Working definition.** Detect that a worker or coordinator stopped or lied, and continue from durable state without requiring that process to still be alive. **Invented narrowing:** the hierarchy declares the obligation (what must be true after failure). The mechanism is not part of the contract.

**Lineage.** Inherited (reconciliation, Raft failover) plus paper (Meiklejohn's crash-recovery and Byzantine framing; Chang's "recover them like nodes").

**Source.** Kubernetes: "controllers are control loops that watch the state of your cluster, then make or request changes where needed. Each controller tries to move the current cluster state closer to the desired state." [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/). Meiklejohn: "an agent can hit a context window limit, hallucinate a fix, or just stop responding mid-task. The other agents have to detect this, recover in-progress work, and continue without it. This is the crash-recovery model." [post](https://christophermeiklejohn.com/ai/agents/distributed/zabriskie/2026/03/30/multi-agent-systems-have-a-distributed-systems-problem.html). Raft: "A leader can fail or become disconnected from the other servers, in which case a new leader is elected." [paper §5](https://raft.github.io/raft.pdf).

**Not.** Not a retry loop inside one context window. Not leader election by itself (election is one recovery path for the log owner, not recovery of a task).

**Design consequence.** The contract states the recovery obligation: resume from durable state, or fail closed. The scheduler does not babysit inside the hierarchy.

### Reconciliation (adjacent)

**Working definition.** A non-terminating loop that drives current state toward a declared desired state. Recovery is one reason to reconcile; reconcile is not the same as "restart the dead process."

**Lineage.** Inherited, Kubernetes controllers.

**Source.** "a control loop is a non-terminating loop that regulates the state of a system." "The controller(s) for that resource are responsible for making the current state come closer to that desired state." [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/).

**Not.** Not a one-shot grader. Not fail recovery's whole meaning (Meiklejohn also includes stale reads and Byzantine output, which a desired-state loop does not cover).

### Heartbeat (adjacent)

**Working definition.** A liveness update. Absence, after a bound, means "treat as unavailable." It does not carry the task result.

**Lineage.** Inherited. Kubernetes node heartbeats via Lease; Raft uses heartbeats as the base of leader election.

**Source.** "every kubelet heartbeat is an update request to this Lease object, updating the spec.renewTime field." "The Kubernetes control plane uses the time stamp of this field to determine the availability of this Node." [Leases](https://kubernetes.io/docs/concepts/architecture/leases/). Raft: "Raft uses randomized timers to elect leaders. This adds only a small amount of mechanism to the heartbeats already required for any consensus algorithm." [paper §1](https://raft.github.io/raft.pdf).

**Not.** Not observability. Not a summary of work done. Not proof the leader is correct.

## Observability

**Working definition.** Signals exported about activity, so an outside observer can tell what happened without sitting in the worker's context. **Invented narrowing:** the contract names which events exist. The pane a human watches is one consumer of those events, not the definition.

**Lineage.** Inherited, OpenTelemetry. Chang names the need ("enough observability to know which agent is stuck") and does not define the signals.

**Source.** "Signals are system outputs that describe the underlying activity of the operating system and applications running on a platform." Supported: traces, metrics, logs, baggage. [Signals](https://opentelemetry.io/docs/concepts/signals/). Glossary: "OpenTelemetry is structured around signals, or categories of telemetry. Metrics, logs, traces, profiles, and baggage are examples of signals." [spec glossary](https://opentelemetry.io/docs/specs/otel/glossary/).

**Not.** Not the wake channel. Not a heartbeat. Not "I can see the pane."

**Design consequence.** The contract lists observability events (what is emitted). It does not list the viewer.

## Leader

**Working definition.** The single member currently allowed to decide the next append to a shared log, holding that right only while others still accept it. If it disappears, another member can take the right because the log was not inside the leader.

**Lineage.** Inherited, Raft and Kubernetes leases. Paper use: Chang wants a replaceable leader; AgentNet argues for no central coordinator at all. Those are not the same claim.

**Source.** "Raft implements consensus by first electing a distinguished leader, then giving the leader complete responsibility for managing the replicated log. The leader accepts log entries from clients, replicates them on other servers, and tells servers when it is safe to apply log entries to their state machines." "log entries only flow from the leader to other servers." [Raft paper §5 and §1](https://raft.github.io/raft.pdf). Authors' site, log agreement without the election sentence: "The consensus algorithm must ensure that if any state machine applies set x to 3 as the nth command, no other state machine will ever apply a different nth command." [raft.github.io](https://raft.github.io/). Kubernetes: "Kubernetes also uses Leases to ensure only one instance of a component is running at any given time." [Leases](https://kubernetes.io/docs/concepts/architecture/leases/).

**Not.** Not the owner of artifacts. Not the orchestrator as a permanent job. Not a heartbeat (the heartbeat supports the lease; it is not the leader).

**Design consequence.** The contract says leader or no-leader. If leader, the log the leader manages is outliving memory, not the leader's context. The scheduler does not elect the leader.

### Lease (adjacent)

**Working definition.** A time-bounded lock record used to coordinate who holds a role or to publish liveness. The holder is not the owner of the work product.

**Lineage.** Inherited, Kubernetes.

**Source.** "Distributed systems often have a need for leases, which provide a mechanism to lock shared resources and coordinate activity between members of a set. In Kubernetes, the lease concept is represented by Lease objects ... used for system-critical capabilities such as node heartbeats and component-level leader election." [Leases](https://kubernetes.io/docs/concepts/architecture/leases/).

**Not.** Not ownership. A lease expires. An owner reference does not.

### Single point of failure (adjacent)

**Working definition.** A component whose death stops the system because needed state or authority lived only there.

**Lineage.** Paper, as a charge against centralized coordination. Inherited remedy is Raft's replaceable leader plus externalized log — a different design, not a denial that the charge exists.

**Source.** AgentNet: existing systems "often rely on centralized coordination, leading to scalability bottlenecks, reduced adaptability, and single points of failure." [abstract](https://arxiv.org/abs/2504.00587). Chang: "A reliable system can't depend on one intelligent process staying alive forever." [blog](https://www.instacloud.com/blogs/a-million-agents-is-a-distributed-systems-problem).

**Not.** Not "has a leader." A leader is a single point of decision for the log. It is a single point of failure only if the log dies with it.

### Handoff (adjacent)

**Working definition.** **Invented.** The act of a new worker or new leader taking a declared contract plus durable state, without inheriting the dead process's context window.

**Lineage.** Chang uses the word once, as future work, and does not define it: "the handoff when a coordinator dies, deserves its own post." [blog](https://www.instacloud.com/blogs/a-million-agents-is-a-distributed-systems-problem). Raft describes electing a new leader; that is not this term.

**Not.** Not a context restore. Not an owner reference update by itself.

## Contract surface

**Invented.** No source defines a hierarchy contract. Grounding: a scheduler must choose without internals (LAS routes on "query features and gate signals," not on the workflow body — [ACL abstract](https://aclanthology.org/2026.acl-long.581/)); every hierarchy shares one input/output contract plus contracts for outliving memory and ownership (the design sentence, not a paper).

Minimum fields a hierarchy declares. Fields only. No runtime.

| Field | Keep? | Serves | Why |
| --- | --- | --- | --- |
| name | keep | scheduler | Identity in the catalog. Not a description of internals. |
| task-shape | keep | scheduler | `sequential` or `parallelizable` only. Google: architecture must match task structure; sequential multi-agent variants degraded, parallelizable centralized coordination improved ([blog](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/)). Reject richer topology (mesh, DAG): that is mechanism (AgentNet, Silo-Bench). |
| inputs | keep | contract | What the hierarchy accepts. Shared I/O contract. |
| outputs | keep | contract | What it returns. Shared I/O contract. |
| durable state location | keep | outliving memory | Where goals, done, pending, artifacts, checkpoints live outside any worker. Not the storage engine. |
| ownership of workers | keep | ownership | Who is the recorded parent of live workers. Not "who spawned them." |
| ownership of artifacts | keep | ownership | Who is the recorded parent of outputs. May differ from worker ownership. |
| admission / backpressure signal | keep | backpressure, admission | The signal the hierarchy emits or honors (`reject`, `slow`, `queue-depth`). Not the queue algorithm, not a numeric concurrency cap (that cap is mechanism; APF seats are a server policy, not a contract field). |
| failure / recovery obligation | keep | fail recovery | `resume-from-durable-state` or `fail-closed`. Not the babysit loop. |
| leader or no-leader | keep | leader | Declaration only. If `leader`, the log location is the durable-state field. Not the election algorithm (Raft timers are mechanism). |
| observability events | keep | observability | Names of events emitted (span, metric, log). Not the viewer, not the wake channel. |

Rejected as mechanism, not contract: scheduling policy (FIFO, RR, CFS vruntime), context-snapshot format, heartbeat interval, wake-queue implementation, grader, pane layout, shard protocol, reconciliation loop body.

### Contract (adjacent)

**Invented.** The set of fields above. A contract is not a Kubernetes spec (desired state for a controller) and not an owner reference. Those are two fields' lineages, not the whole surface.

## Local prototype, not a spec

Facts in this section are **local code**, as given for this note. They are evidence of a naive working hierarchy. They are not definitions.

- `shep` (yyx_shepherd) owns pane lifecycle and an ownership ledger. ADR 0007: shep never orchestrates. Scope = shepherd session. Foreign panes are not yours. **Accidentally implements:** ownership (ledger as registry), process-like lifecycle of panes. **Does not implement:** scheduler, orchestrator, hierarchy, outliving memory of the task, leader, backpressure.
- Fleet template `templates/fleet`, `driver.sh`: a bash loop that picks chunks, spawns workers, babysits, grades, settles. **Accidentally implements:** scheduler and orchestrator collapsed into one loop. **Does not implement:** the distinction scheduler ≠ orchestrator. Not a hierarchy contract; it is one unlabeled procedure.
- `state.json` / `fleet-state.json`: `done[]`, `failed[]`, `in_flight{}`, midpoint resume. **Accidentally implements:** a checkpoint (one slice of outliving memory). **Does not implement:** Chang's survive-list (goals, plans, decisions, artifacts, ownership). Not a Raft log.
- Wake queue, the only door to the shepherd. Done-skip: successes do not wake; failures wake. **Accidentally implements:** a wake channel, plus a crude attention gate. **Does not implement:** observability, backpressure (no receiver demand signal), admission control as specified by Kubernetes.
- Summary heartbeat every 30 min. **Accidentally implements:** heartbeat as a timer, not as a Lease renew. **Does not implement:** leader election, availability detection with a defined bound in a shared record.
- Grader is the only verdict. **Accidentally implements:** a one-shot pass/fail. **Does not implement:** reconciliation (no loop driving current state to desired state).
- Shepherd attention is a budget. **Accidentally implements:** a concurrency/attention cap. **Does not implement:** backpressure.
- algo-cleaning `seller_name_zh` instantiates the fleet template. **Accidentally implements:** one hierarchy instance, unlabeled. **Does not implement:** a declared contract (no task-shape, no ownership split, no leader flag).
- Observability the user likes: herdr panes a human can watch, plus `fleet.log` audit and the wake channel. **Accidentally implements:** a human view and a log file. **Does not implement:** OpenTelemetry signals as the contract. The wake channel is not observability.

## Product shape (2026-09-28, user intent, not a spec)

A pi agent is the front door. The user types a task. The product does not answer the task. It stands up a subagent system in sub-panes. Workers in those panes may be opencode or pi-agent. One of them may orchestrate. The others work.

Jev is not an agent and not a pane. It does not generate text. Code sends it the task state and a typed question; it returns a calibrated pick or a probability. The pi front door uses that for the cheap choice (which workflow, which worker kind). Low confidence asks the user instead of spawning. Provider rate limits are not a jev question unless that fact is already in the state. The workflow still obeys a 429 by itself.

`shep` stays the pane toolbox. It does not become this product.

## Provisional readings (2026-09-28, not settled)

User guesses, not sources.

- Hierarchy and workflow are one object: the reusable coordination template (algo-cleaning fleet template) with the task-specific hooks empty. One word. Papers say workflow. "Hierarchy" was Chang's undefined word; do not keep both if they name the same thing.
- Leader vs permanent orchestrator vs none is not a system-wide choice. It is a field of the workflow the scheduler selects. The scheduler does not elect.
- Where backpressure sits: on the workflow, at the provider boundary. `CONC=3` is a hand-set stand-in because concurrent web-search MCP calls and LLM calls hit provider limits. It is not an arbitrary slot cap. The missing mechanism is automatic: the provider refuses or slows, the workflow stops opening new calls, then opens them again when the provider can take more. The scheduler does not make those calls.

## Open questions

Sources disagree, or do not answer. Not design decisions. Items 1 and 2 have provisional readings above.

1. **Centralized orchestrator vs elected leader vs no leader.** Google Research blog: independent agents amplified errors by 17.2×; a centralized orchestrator contained that to 4.4×; centralized coordination improved parallelizable financial reasoning by 80.9% ([blog](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/)). The paper abstract does not state 17.2× or 4.4×; it says "architectures without centralized verification tend to propagate errors more than those with centralized coordination," and reports +80.8% to −70.0% across 260 configurations, not the blog's 180 ([arXiv:2512.08296](https://arxiv.org/abs/2512.08296)). AgentNet treats centralized coordination as the source of "single points of failure" and removes the orchestrator ([abstract](https://arxiv.org/abs/2504.00587)). Raft keeps a leader, but only as the replaceable owner of a replicated log ([§5](https://raft.github.io/raft.pdf)). Chang's blog wants the Google default plus Raft-style replacement, and does not show that combination. Unresolved: is the coordinator a permanent orchestrator, an elected leader, or absent?

2. **What "hierarchy" means.** Chang uses it next to teams and managers ([blog](https://www.instacloud.com/blogs/a-million-agents-is-a-distributed-systems-problem)). LAS says workflow ([ACL](https://aclanthology.org/2026.acl-long.581/)). Google says architecture. AgentNet says DAG. No source defines hierarchy as org-tree or as workflow-graph. The contract field `task-shape` does not answer this.

3. **Where backpressure sits.** Reactive Streams puts it on the stream destination ([spec](https://www.reactive-streams.org/)). Kubernetes APF puts queues and seat limits on the API server, in front of controllers ([APF](https://kubernetes.io/docs/concepts/cluster-administration/flow-control/)). AIOS centralizes queues in the scheduler ([§3.3](https://ar5iv.labs.arxiv.org/html/2403.16971)). No agent paper says whether the signal belongs on the scheduler or on the hierarchy. Silo-Bench shows communication is not coordination — "agents spontaneously form task-appropriate coordination topologies and exchange information actively, yet systematically fail to synthesize distributed state into correct answers" ([abstract](https://arxiv.org/abs/2603.01045)) — and does not locate backpressure.

4. **Blog vs paper on the scaling study.** Blog: 180 configurations, R² = 0.513, +80.9%, 17.2× / 4.4×. Abstract: 260 configurations, six benchmarks, cross-validated R² = 0.373 (R² = 0.413 with a task-grounded capability metric), +80.8% / −70.0%. Do not treat Chang's 80.9% / 17.2× / 4.4× as the paper's abstract. The blog is the source that states those three figures.
