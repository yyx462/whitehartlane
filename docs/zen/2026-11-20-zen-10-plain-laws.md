# Zen 10 — plain laws: program edits, finished runs, retired pages
2026-11-20. Session: opencode: the #296 investigation→fix conversation (the distiller cannot introspect its own session id; the mechanism's diff is PR #299). Distilled by yyx-project-meta.

## Context
Issue #296: a failed run's wake suggested a command that only works on paused runs, one tenth of a second after the failure had already finished the run. The session proved both halves from the job records (j-dd28ac's wake fired on a file the run itself left behind; j-93d652's "worked" receipt was an old paused-run path removed the same day it was cited), fixed the code (PR #299), and set two house rules with the owner: zens speak plain law, and the two GOAL pages retire.

## Final (these lines are law)
- **A claim that the program was edited must compare the files registered at booking — never the whole folder.** — a run may leave files behind; those are not edits. The whole-folder hash keeps a different job: versioning the program. [agent-proposed, owner-approved] → aspect: admission
- **A finished run is over; its wake may only suggest commands that work on a finished run.** — run the same program again, or re-grade the existing work. Never "continue": it only accepts paused or abandoned runs. [agent-recommended, owner-approved] → aspect: wakes
- **Files a run leaves in the program folder must be named in the report, never silently ignored.** — visible mess beats trusted cleanliness; workers are briefed, the report verifies. Parked as #298. [owner instinct, agent merged] → aspect: storage
- **GOAL.md and GOAL.decision.md are retired.** — direction lives in one place (docs/prd/OPTIMUM.md, regenerated whole); history lives in the zens and ADRs. [owner-ruled]
- **A zen line is plain law a newcomer understands without this session.** — receipts, ids, and metaphors live in Context; the law line carries none of them. [owner-ruled, this entry rewritten to it]

## Rejected proposals
- Park failed runs in a resumable state — rejected (OPTIMUM "verdicts are honest": a red verdict is an honest finish, not a costume for infra; the momentum rule demands a PRD why first).

## Coinages
- **booked-pages photo** — the snapshot of registered files a booking stages (`.whl-program`); the only proof an "edited program" claim may cite → glossary
- **dropping** — a file in the program folder that no booking registered; not an edit, and (once #298 lands) named in the report → glossary
