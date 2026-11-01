import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import test from "node:test"
import { join } from "node:path"

// momentum-2 (P1) — the supervisor's brief names a verdict path the
// default install cannot reach. supervisorBrief (ship-supervisor.ts:30)
// tells the minted hearer to watch
//   $AGENTIC_OS_HOME/sessions/*/jobs/<jid>/run/data/review/verdict.json
// whenever runDir is absolute — which it ALWAYS is from the mint
// (bin/whitehartlane:511 builds it as join(homeRoot(), "auto-reviews",
// …)). But homeRoot() (src/adapters/store.ts:191-201, ADR 0011) only
// reads AGENTIC_OS_HOME when it is EXPORTED; the default home is
// ~/.local/share/whitehartlane (or the legacy agentic-os disk). On a
// default install $AGENTIC_OS_HOME expands to the EMPTY STRING in the
// supervisor's sh — the "pattern" becomes /sessions/*/jobs/…, a path
// that does not exist. The fallback the brief offers ("the staged
// ${runDir}/data/review/verdict.json may also carry it") is the
// MATERIALIZED PROGRAM dir, which never receives the verdict: prove.sh
// writes it at the JOB's staged run dir (templates/pr-review/hooks/
// prove.sh:190 — prog = the hook's own staged copy under
// homeRoot()/sessions/<sid>/jobs/<jid>/run), the same place the gate's
// readers look (src/doors/review-gate.ts:99,166). So both watched
// paths point nowhere on a default install, and the one-shot agent
// that owns the commission is left to guess where its own verdict
// lands — the 2h timeout comment (brief step 7) is the likely ending
// for a review that merged hours earlier.
//
// BASE shape: no ship-supervisor module there — guarded dynamic import,
// vacuous green on BASE (the repo's own repro convention).
const MOD_URL = new URL("../../src/doors/ship-supervisor.ts", import.meta.url)
const mod = existsSync(MOD_URL) ? await import(MOD_URL) : undefined
const STORE_URL = new URL("../../src/adapters/store.ts", import.meta.url)
const store = existsSync(STORE_URL) ? await import(STORE_URL) : undefined

test("the brief's job-run-dir pattern must resolve under the home the verdict actually lands in (AGENTIC_OS_HOME unset — the default install)", () => {
  if (!mod || !store) return // BASE: no ship-supervisor — nothing to judge
  const { supervisorBrief } = mod as typeof import("../../src/doors/ship-supervisor.ts")
  const { homeRoot, sessionsRoot } = store as typeof import("../../src/adapters/store.ts")

  // the default install: no AGENTIC_OS_HOME exported (save/restore)
  const hadHome = process.env.AGENTIC_OS_HOME
  delete process.env.AGENTIC_OS_HOME
  const tmp = mkdtempSync(join(tmpdir(), "whl-momentum2-"))
  try {
    // the mint's OWN shape (bin/whitehartlane:511): runDir is always
    // absolute under homeRoot()
    const out = join(homeRoot(), "auto-reviews", "pr7-2026-10-30T00-00-00.000Z")
    const brief = supervisorBrief({
      levyCmd: "whl review '/repo' --base 'b' --head 'h' --model 'acme/strong'",
      runDir: out,
      pr: "7",
      repo: "/repo",
    })
    // the pattern as the supervisor's sh would expand it — the job's
    // run dir itself (the 2026-10-30 twin-seat law: the FINDINGS live
    // in the job's record there; the WAIT lives on the merge seat)
    const m = brief.match(/pattern (\S+\/sessions\/\*\/jobs\/<jid>\/run)/)
    assert.ok(m, "the brief states a job-run-dir pattern")
    const expanded = m[1].replace("$AGENTIC_OS_HOME", process.env.AGENTIC_OS_HOME ?? "")
    // ONE wake per commission needs a FINDABLE finish: the path the
    // hearer is told to read must live under the root the rail
    // actually writes (sessionsRoot(), the readers' own home).
    assert.ok(
      expanded.startsWith(sessionsRoot()),
      `the brief's job-run-dir pattern must expand under the real record root ${sessionsRoot()} — it expands to ${expanded} (empty $AGENTIC_OS_HOME on the default install; the staged ${out}/data/review/ seats are the program dir, which the job copies from)`,
    )
  } finally {
    if (hadHome !== undefined) process.env.AGENTIC_OS_HOME = hadHome
    rmSync(tmp, { recursive: true, force: true })
  }
})
