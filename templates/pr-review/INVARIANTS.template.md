# INVARIANTS.md — what "right" means in this repo

Each entry: an ID, one sentence, the code areas it governs, how to
test it. The reviewer walks this list and tries to violate each with
the change under review. Every bug that escapes review adds an entry —
that is the whole compounding trick.

- **INV-1 No retire while any worker is working.** Every stop, drain,
  and retire path waits on OBSERVED not-working state for every pane;
  a fixed sleep is never the wait. Areas: engines' stop/drain paths.
  Test: fake port with a pane stuck "working"; assert the retire
  waits.
- **INV-2 Every validated field reaches an engine.** If the parser
  accepts a manifest field, some engine reads it — refuse, never
  vanish. Areas: doors/hooks.ts ↔ engines. Test: set the field with a
  fake port; assert observable behavior changes.
- **INV-3 One function per decision.** A decision ("is this unit
  done", "which model now") lives in exactly one place; a second site
  making the same decision is itself a finding even when the two
  currently agree. Test: grep synonyms; every hit must route through
  the one owner.
- **INV-4 Verdicts are honest.** check judges, run acts, grade binds,
  signal/end observe; an infra failure is never reported as an answer.
  Test: break the hook; assert the failure lands as fault, not verdict.
- **INV-5 Agent state comes from API fields.** OpenCode
  `error.type`/`finish`, herdr `agent_status` — never pane screen
  text. Test: grep for screen-scraping of panes/logs in control flow.
- **INV-6 One wake per commission.** Retire/abort/orphan wake the
  levy exactly once; pause never does.
- **INV-7 Ordering lives in the chain, never in brief text.** A brief
  that says "do this after that" is a finding; the [[stage]] order is
  the only ordering.
