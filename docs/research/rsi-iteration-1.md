# RSI iteration 1 — the record (2026-10-17)

The first run of the loop this repo now iterates by: **mine → triage →
fix → evaluate → remember**. Commissioned by the owner's verdict on
the system ("works but pretty buggy, hard to use"), executed in one
session with quiet subagents (the rail itself was mid-repair —
iteration 2 runs as a real spur, which is its own proof).

## The loop, as run

1. **Baseline first.** `npm test` on trunk, recorded before touching
   anything: 370 tests, 368 pass, 2 flaky failures
   (`perm-hardening` #52/#53a). Everything after is compared to this.
2. **Mine.** Every opencode session with cwd in this repo (70: 24
   modern + 46 stranded under the pre-rename path, frozen in the
   legacy table) dumped once from the 4.1 GB db to flat JSONL. Eight
   miner agents, one shard each, extracted 337 friction events
   (complaints, confusions, corrections, repeat-instructions, wishes,
   observed failures) — verbatim quotes, severity, category.
3. **Triage (the cheap gate).** One reviewer clustered the events by
   root cause (24 clusters), then checked each against current code:
   **already-fixed** (9 — extraction is not a to-do list; stale
   friction is a finding, never work), **still-live** (with
   file:line), **stale-env**, **unknown**. Deduped against the 27 open
   issues; ranked by severity × recency × frequency × owner emphasis.
4. **Fix.** One cluster per PR through the gwt lane, test-first:
   - **#137 docs truth pass** — rename-era drift (CONTEXT title, ADR
     renumber, decision count, window bind).
   - **#138 wake chain** (C01+C02, the owner's two angriest clusters)
     — the v1-shaped wake plugin ported to the opencode v2 API; the
     ladder reordered **spool → parent-pane → fork → doorbell** (a
     listening conversation never pays for a rebirth tab); the spool
     rung arms itself when the plugin is installed; the fork targets
     the levy's own tab/workspace (`herdr pane split` takes a PANE_ID
     — the "herdr can't place panes" belief was wrong; whl never
     asked); the verb and the rail now share one birth body.
   - **#139 perf** — one shared read-only db handle keyed on
     (path, mtime); fault-probe memo; window scan TTL cache with
     POST-bust.
   - **#140 test debt** — the two flaky tests de-flaked (wall-clock
     choreography → event choreography), duplicate `paneOf` removed,
     the viewer lane pinned dead forever.
   - **#141 e2e gate** — the battery itself was broken: all 8
     fixtures printed pre-#121 counts shapes the hardened admission
     probe refuses; it ran 0 jobs, silently. Fixed + the probe now
     names a non-object JSON honestly.
   - **yyxSkills #102** — the dead skill-stub path (cold agents hit a
     broken entry).
5. **Evaluate.** Merged trunk: **379/379** deterministic (baseline
   370/368+2 flaky), de-flake proven by 3 consecutive loaded runs.
   The real e2e battery fired with the iteration's own session as the
   levy — 8/8 scenarios booked and ran, and every completing job woke
   **in-band through the ported plugin's spool rung** (six `[agentic-wake]`
   prompts landed in the commissioning conversation; zero fork tabs,
   zero doorbell fallbacks). The wake chain fix proved itself by
   carrying its own evaluator.
6. **Remember.** This file, the GOAL decision entry, the RAILS note.

## Post-merge rollout (one manual step, once)

`whl plugin install` has run; **restart opencode** and the in-band
wake channel is live (heartbeats appear, wakes land in conversations,
fork tabs stop being born in the common path).

## Iteration 2 recipe

Run the loop AS a spur (the dogfood): miners as fan-out units over
fresh shards, the triage reviewer as a member, fixes as gwt PRs, the
evaluator hook comparing against this file's numbers. Signals to
watch: new-session complaints only (the corpus before 2026-10-17 is
mined), and the deferred clusters below.

## Deferred (with reasons)

- **C12** concurrent-spawn brief loss (#78) — unknown status; fold a
  7-way spawn battery into the next e2e pass.
- **C14** eval program gaps (tokens/cost, per-component timing) —
  ticketed workstream (#44/#45/#46/#67/#104–#110).
- **C20** window UI polish — cosmetic; after reliability + perf.
- **C22** architecture wishes (lego rail, ReWOO) — needs an ADR, not
  a session.

## Corpus + artifacts

- events: `events/*.jsonl` (337 rows, 8 shards) — session temp dir
  `whl-rsi-iter1`, regenerated on demand by re-dumping
- clusters: `clusters.jsonl` / `clusters.md` (24)
- baseline: 370 tests / 368 pass / 2 flaky — after: **379/379**
