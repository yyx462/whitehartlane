---
name: yyx-ship
description: >-
  The ship gate's trigger surface, IN-REPO: run the adversarial
  pre-merge review rail on a branch/PR, handle the verdict (accept →
  merge; reject → targeted fixes + test adoption; dead lens →
  re-levy), and iterate until accept. Triggers: "ship this PR",
  "review then merge", "run the review rail", a review job woke with
  a verdict. The user-level yyx-ship skill (when installed) is this
  same gate; on machines without it, this file and the door's own
  manual are the contract.
---

# yyx-ship — the ship gate (in-repo trigger surface)

The contract for THIS repo's rail, always present and atomic with the
door:

1. `whl review --help` — the manual: the spell, flags, refusals,
   hard rules (re-levy law, model-pin law, adoption contract)
2. `templates/pr-review/README.md` — the deep shape (cost levers:
   its ECONOMICS.md)
3. the user-level **yyx-ship** skill, when the skill library is
   installed — the same loop, carried across machines

The loop: review → reject → divide feedback → fix + adopt tests →
re-review → accept → merge. A dead unit re-levies the SAME program
dir, never a fresh materialization.
