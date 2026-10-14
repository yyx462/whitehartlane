# Eval the supervision, not the model.

The OS had no eval story and no paper trail. Considered: running the
model on static benchmarks (GPQA-style) and comparing scores — rejected,
it measures the model and the model is held constant here; chasing
leaderboard numbers on SWE-bench/Terminal-Bench — rejected, public
absolute scores confound model, harness, and contamination (OpenAI's
Feb 2026 exit from SWE-bench Verified is the cautionary tale); and
waiting for a multi-agent benchmark that matches this system — rejected,
none exists: no verified benchmark evaluates multi-agent LLM software
collaboration with real OS-level isolation between agent processes.
Adopted: the eval measures what the OS actually varies — supervision —
through three topologies (fleet-over-instances, decomposition-of-one,
rails-around-one) against a bare single-agent baseline, under a paired
iso-model/iso-harness/iso-budget protocol, with pre-registered
falsifiable hypotheses; where no benchmark ships the instrument
(attention, isolation, the trace-to-cheaper-rerun curve) the trace
itself is the instrument. The literature trail lives beside the plan,
supporting and complicating each design bet in the open.
Trail: docs/plans/eval-vs-single-agent.md,
docs/research/eval-landscape.md, docs/research/papers.md.
