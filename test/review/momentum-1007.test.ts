// momentum-1007 — the harness-tree permission rung must resolve the
// harness home the way the STORE resolves it.
//
// The rung's own comment (the r16 receipt) says:
//
//   "The home is the STORE'S resolution, not the raw env — the
//    production orchestrator runs with the default home and no
//    AGENTIC_OS_HOME exported (the r16 receipt: the rung existed and
//    still did not fire)."
//
// But the rung does NOT use the store's resolution — it re-implements
// it with the LEGACY spelling:
//
//   src/core/permission.ts:  join(homedir(), ".local/share/agentic-os")
//   src/adapters/store.ts:   join(homedir(), ".local", "share", "whitehartlane")
//                             (ADR 0011/0012: the disk default is
//                              whitehartlane; the legacy agentic-os disk
//                              wins ONLY while it is the only one that
//                              exists)
//
// So on the store's DEFAULT disk the rung's tree is the wrong tree:
// the sessions (and every lens pane's cwd) live under
// ~/.local/share/whitehartlane/sessions/..., while the rung guards
// ~/.local/share/agentic-os/... — the rung never fires, and the asks
// fall to the tuned judge, whose coin denies them ("deny-unneeded").
// That is the exact starvation the r12/r14/r15 receipts describe
// (three whole rounds starved to pane-reap).
//
// The store's homeRoot() carries the warning: "TWIN WARNING:
// scripts/review-trace.mjs replicates this exact resolution — if you
// change the order or the spellings, change both". The permission
// rung is a third site for the same decision, and it did not change.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { decidePermission, declareScope } from "../../src/core/permission.ts"
import { homeRoot } from "../../src/adapters/store.ts"

test("the harness-tree rung must guard the home the STORE resolves (the whitehartlane disk), not the legacy agentic-os one", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-harness-home-"))
  const prevHome = process.env.HOME
  const prevAoh = process.env.AGENTIC_OS_HOME
  try {
    delete process.env.AGENTIC_OS_HOME
    process.env.HOME = tmp
    // the store's DEFAULT disk exists (ADR 0011/0012) and the legacy
    // one does not — so the store's resolution IS the new spelling
    const harnessHome = join(tmp, ".local", "share", "whitehartlane")
    const jobDir = join(harnessHome, "sessions", "s-1", "jobs", "j-1", "run", "units", "principles")
    mkdirSync(jobDir, { recursive: true })
    assert.equal(
      homeRoot(),
      harnessHome,
      "the store resolves the harness home to the whitehartlane disk — the rung must guard THAT tree",
    )
    // the SIBLING inside the job's own tree (the r15 receipt): the pane's
    // NARROW scope (cwd only, the shape the rail actually spawns) cannot
    // match it, and it is not an ancestor of any root
    const narrow = declareScope([jobDir])
    const sib = join(harnessHome, "sessions", "s-1", "jobs", "j-1", "jobs")
    const v = decidePermission({
      question: `Permission required\n⏎   ┃    ← Access external directory ${sib}`,
      scope: narrow,
      home: `${tmp}/`,
      cwd: jobDir,
    })
    assert.equal(
      v.decision,
      "allow",
      `the harness's own tree is the Job's own territory — the rung must fire; got ${v.decision}: ${v.message}`,
    )
    assert.match(v.message, /harness's own tree/, `the grant names the rung (message: ${v.message})`)
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevAoh === undefined) delete process.env.AGENTIC_OS_HOME
    else process.env.AGENTIC_OS_HOME = prevAoh
    rmSync(tmp, { recursive: true, force: true })
  }
})
