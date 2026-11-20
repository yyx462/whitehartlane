# ADR 0017 — program identity for "changed since booking" is the booked pages

Date: 2026-11-20 · Zen: docs/zen/2026-11-20-zen-10-plain-laws.md · Ships: PR #299

## Decision

The only proof an "edited program since booking" claim may cite is the
**booked-pages photo** — the `.whl-program` marker staging writes at
booking (`buildProgramPages`, `src/doors/project.ts`). A whole-folder
hash is never that proof.

## Why

- j-dd28ac (2026-11-18, #296): the run dropped `report.md` into the
  program folder two minutes before a red gate; the pile hash moved and
  the failed wake claimed "program changed since booking" 0.1s after
  the red — before any human could have edited anything — then
  prescribed `whl continue`, a verb that refuses retired jobs, the
  exact state a failed finish books.
- The same pile compare fed the `continue` NOTE — one disease, two
  doors (the every-door law).

## Consequences

- One builder feeds the fold marker, the wake hint, and the continue
  NOTE; "which page changed?" has exactly one answer.
- A file the photo has no page for is a **dropping**: not an edit, no
  claim. No photo (legacy booking) → no claim (refusal beats silence).
- The folder hash keeps its versioning job (spur version, layout
  changes — principles-5201 holds).
- Repair tickets prescribe re-levy (changed pages never fold,
  momentum-4) or `regrade` — never `continue`.
- Clean-room follow-up (declared seats, droppings named in the
  report): parked as #298.
