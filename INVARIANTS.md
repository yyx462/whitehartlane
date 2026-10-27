# INVARIANTS.md — what "right" means in this repo

The reviewer's checklist (read by `whl review` and by humans): walk
this list and try to violate each with the change under review. Every
bug that escapes review adds an entry — that is the compounding trick
(the Bugbot-rules / Codex-guidelines pattern).

- **INV-1 No retire while any worker is working.** Every stop, drain,
  and retire path waits on OBSERVED not-working state for every pane;
  a fixed sleep is never the wait. Areas: the engines' stop/drain
  paths. Test: fake port with a pane stuck "working"; assert the
  retire waits (the run #17 escape — coworker stop settled on a 5s
  mail-quiet beat while the interviewer pane was still writing).
- **INV-2 Every validated field reaches an engine.** If the parser
  accepts a manifest field, some engine reads it — refuse, never
  vanish. Areas: doors/hooks.ts ↔ engines. Test: set the field with a
  fake port; assert observable behavior changes.
- **INV-3 One function per decision.** A decision ("is this unit
  done", "which model now") lives in exactly one place; a second site
  making the same decision is itself a finding even when the two
  currently agree. Test: grep synonyms (sleep, settle, drain, idle,
  done, wait); every hit must route through the one owner.
- **INV-4 Verdicts are honest.** check judges, run acts, grade binds,
  signal/end observe; an infra failure is never reported as an answer.
  Test: break the hook; assert the failure lands as fault, not verdict.
- **INV-5 Agent state comes from API fields.** OpenCode
  `error.type`/`finish`, herdr `agent_status` — never pane screen
  text. Test: grep control flow for screen/log-text scraping of panes.
- **INV-6 One wake per commission.** Retire/abort/orphan wake the levy
  exactly once; pause never does.
- **INV-7 Ordering lives in the chain, never in brief text.** A brief
  that says "do this after that" is a finding; the [[stage]] order is
  the only ordering.
- **INV-8 A blocking review finding is a fact.** The pr-review rail
  blocks a merge ONLY on a repro that fails on HEAD twice and
  classifies introduced/incomplete-fix against BASE; everything else
  is advisory (templates/pr-review/hooks/prove.sh). A hook that
  blocks on opinion fights Greptile's 79%-nits failure.
