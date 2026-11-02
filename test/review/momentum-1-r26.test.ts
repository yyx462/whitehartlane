import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// momentum-1 (P1) — the wrong-owner wake: resolveCaller's newest-bind
// can hand the verdict wake to a SIBLING while the commissioner's own
// session is mid-turn and therefore quiet-looking.
//
// The code's own model (src/doors/ship-supervisor.ts:86-88): "`updated`
// ticks per turn, not per tool call" — the exact reason tier 2 refuses
// a freshness window on SELF. But the coworker guard (:135) applies a
// 10-minute window to every OTHER session: `busySibling` treats a
// 25-min-old `updated` as quiet, which by the code's own model is a
// LIVE session mid-turn, not a dead one. So in a whl fan-out (several
// live sessions in one project — the scenario :89-95 says the guard
// exists for), the pane running `gwt submit-pr` mid-turn (updated =
// turn start, 25 min ago) loses the newest-contest to a sibling that
// went idle 12 min ago — matching[0] IS the sibling, the quiet-looking
// mid-turn commissioner is skipped by `busySibling`, and the bind
// lands on `opencode:<sibling>`. bin/whitehartlane:475-479 then pushes
// `--from opencode:<sibling>` and prints "this session hears the
// verdict" — the wake (run.ts spawnerFromArgs → job.spawner) books a
// session that never commissioned anything, and the commissioner that
// launched submit-pr never hears its own review finish: the
// information gap the whl-driving law (AGENTS.md) forbids, and the
// exact "wrong-owner wake ... worse than minting a supervisor" the
// comment at :92-95 claims the quiet-sibling rule prevents.
//
// The pane's own session is unidentifiable from `session list` (no
// pane→session field is read), so whenever the newest cannot be
// attributed to THIS pane the only lawful answer is null (mint the
// supervisor) — never the sibling.
//
// BASE shape: no ship-supervisor module exists there — guarded dynamic
// import, vacuous green on BASE (the repo's own repro convention,
// test/review/tests-702.test.ts).
const MOD_URL = new URL("../../src/doors/ship-supervisor.ts", import.meta.url)
const mod = existsSync(MOD_URL) ? await import(MOD_URL) : undefined

const stubBin = (dir: string, name: string, out: string): string => {
  const p = join(dir, name)
  writeFileSync(p, `#!/bin/sh\ncat <<'EOF'\n${out}\nEOF\n`)
  chmodSync(p, 0o755)
  return p
}

test("the newest-bind must never land on a sibling while the commissioner's own session is mid-turn (quiet by the per-turn updated model)", () => {
  if (!mod) return // BASE: no ship-supervisor — nothing to judge
  const { resolveCaller } = mod as typeof import("../../src/doors/ship-supervisor.ts")

  const tmp = mkdtempSync(join(tmpdir(), "whl-momentum1-"))
  const repo = join(tmp, "repo")
  mkdirSync(repo, { recursive: true }) // execFileSync spawns with this cwd — it must exist

  const herdr = stubBin(tmp, "herdr", JSON.stringify({ result: { agent: { agent: "opencode" } } }))
  const now = 1793339266367
  // the world, exactly as the code's own model reads it: THIS pane's
  // session (ses_self) is mid-turn — updated at turn start 25 min ago;
  // the sibling (ses_sib) went idle 12 min ago, fresher than self but
  // itself plausibly only mid-turn (turns run longer than 10 min — the
  // receipt at :86-88 for why windows on `updated` "break long turns").
  const oc = stubBin(tmp, "oc", JSON.stringify([
    { id: "ses_self", directory: repo, updated: now - 25 * 60 * 1000 }, // the commissioner, LIVE, quiet-looking
    { id: "ses_sib", directory: repo, updated: now - 12 * 60 * 1000 }, // a sibling, idle 12 min
  ]))
  const env = { HERDR_ENV: "1", HERDR_PANE_ID: "wK:pSV", WHL_HERDR_BIN: herdr, WHL_OPENCODE_BIN: oc }

  try {
    const c = resolveCaller(repo, { env, now })
    // the wake must reach the commissioner (ses_self) or refuse to
    // guess (null → the supervisor is minted). Binding the sibling is
    // the wrong-owner wake — INV-6's commission heard by nobody that
    // commissioned it.
    assert.notEqual(c?.from, "opencode:ses_sib", "a newest-bind that lands on a sibling while the pane's own session is quiet-looking mid-turn is the wrong-owner wake (ship-supervisor.ts:132-139) — refuse (null) or bind the commissioner, never the sibling")
    assert.ok(c === null || c.from === "opencode:ses_self", `expected null or the commissioner ses_self, got ${JSON.stringify(c)}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
