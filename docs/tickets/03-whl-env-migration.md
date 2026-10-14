# Ticket 03 — WHL_* env migration (deferred from the rename)

> Split out of ticket 02 / ADR 0011. The `AGENTIC_OS_*` env prefix survives the
> branding rename on purpose: 36 distinct names, some dynamically constructed —
> too risky as a rider on a branding PR, invisible to the brand.

## Problem

Every env knob is spelled `AGENTIC_OS_*` (HOME, ROOT, DOOR, ORCHESTRATOR, PICK,
GRILL, JEV, VERBOSE, SID, JID, NOTIFY, SPOOL_WAKE, FORK_WAKE, BACKOFF_MS,
CHECK_MS, RELAY_CAP, DRAIN_MS, GWT_ROOT, SUBMIT, GLOBAL, WORKFLOW, WORKTREE,
PLANNER, CANARY, SLOTS, TUNER_GATES, TUNER_MODEL, JEV_PROMPTS_DIR, BIRTH_JITTER_MS,
BROWN_X_MS, BROWN_X_TRIES, FORK_BACKOFF_MS, FORK_TRIES, START_BACKOFF_MS,
START_TRIES). Full inventory:

```bash
grep -rhoE "AGENTIC_OS_[A-Z_]+" src bin web .pi test | sort -u
```

## Plan

1. One seam: `src/env.ts` — `envGet(env, "HOME")` reads `WHL_HOME` first,
   `AGENTIC_OS_HOME` as the deprecated fallback. Mirrors the ADR 0009/0011
   read-both-write-new policy.
2. Codemod the static reads (`process.env.AGENTIC_OS_X` and injected
   `env.AGENTIC_OS_X` — note `src/hooks.ts` takes `env` as a parameter for
   testability; keep that seam).
3. Handle the dynamic sites by hand: `AGENTIC_OS_BIRTH_*` template construction,
   `src/backoff.ts` helpers that receive whole var names, `web/server.mjs`
   (stdlib-only, no src imports — inline policy), `.pi/extensions/front-door.ts`.
4. Tests: migrate fixtures to `WHL_*`, keep one legacy-name test proving the
   back-compat read, cover a both-set case (new wins).
5. Consider riding along: the `customType` tags (`agentic-os-jobs` → `whl-jobs`,
   etc.) — nothing matches on them today.

## Done criteria

- [ ] Every read goes through the seam; `grep -rE "AGENTIC_OS_" src` finds only
      the fallback helper (and tests proving it)
- [ ] ADR note appended: deprecation window for the old spellings
- [ ] `npm test` green
