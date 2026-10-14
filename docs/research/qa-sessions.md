# QA sessions — Agentic Application Engineering in the job market

Recurring study/QA sessions. The subject is the 2026 Agent Dev job market;
the differentiator is that every concept is grounded in this repo's code, so
the "in this OS" claims must be re-checked against master at each session —
the OS moves, the glossary is a snapshot.

## Outputs

| Artifact | Where |
|---|---|
| Agent Dev JD Glossary (prose, canonical) | `docs/research/agent-jd-glossary.md` |
| Study companion page (deployed) | `docs/research/agent-glossary.html` → https://411adf3c.ht-ml.app/ |
| Feature decision this research unblocked | `docs/adr/0004-main-agent-planner.md` (Composer, still Proposed) |

The deployed page is the local HTML file. If the glossary md changes, the
html must be regenerated and redeployed in the same change, or the page
drifts from the doc.

## Session log

- **2026-10-08/09 — research session** (`jd-research` lane, PR #23, fca00fa →
  b6ac1ab): market scan (§1), glossary in five axes + system shape +
  production + infra words + ecosystem (§2), tradeoff tables (§3),
  concept→WhiteHartLane map (§4), study page deployed to ht-ml.app, ADR 0004.
- **2026-10-10 — QA session**: verified the deployed URL still matches the
  local html; audited §4's file pointers against master. One drifted (below);
  everything else resolved. Core framing (axes, taxonomy, tradeoffs, the
  "agent once at compile time" pitch) unchanged and still the party line.

## Known drift (checked 2026-10-10, master @ 8246197)

- **§4 Orchestrator-workers row says `src/wave.ts`** — deleted in d32f780
  ("retire the orchestrator pane — no workflow runs on a mind", 10-09).
  Wave logic now lives in `src/live-run.ts` (Wave type, `waveClosed`),
  `src/lab.ts` (`birth-wave`, `spawnWave`), and wave gating in
  `src/orchestrator.ts` (ADR 0007). `global/hooks/units.sh` still exists.
- ADRs the glossary predates: 0005 (resumable jobs), 0006 (whl wake & fork),
  0007 (settle typed steps) — none contradict it; they deepen it.
- Verified still accurate: `bin/pick-workflow` (jev-routed fan-out vs
  direct), `src/workflow-kind.ts` (kind → orchestrator bin), ADR 0004 status
  "Proposed" (no Composer in src/ yet).

## How to run a QA session

1. Read the glossary md once, or drill on the deployed page (press `/` to
   search). §3 / panel 2 is the interview spine — decision rules, not
   definitions.
2. Before repeating any "in this OS" line, spot-check the pointer:
   `ls src/<file>` or `git log --oneline -- <path>` if unsure.
3. Append a session row above; record any new drift while it is fresh.
