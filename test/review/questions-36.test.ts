// questions-36 (questions lens, Q2) — THE HARNESS-TREE RUNG GUARDS A
// DISK SPELLING THAT IS NOT THE STORE'S, SO THE RUNG IS INERT WHERE THE
// CHANGE SAYS IT FIRES.
//
// WHAT THE DIFF CLAIMS (src/core/permission.ts:330-336, added by THIS
// diff — the rung's own comment):
//
//   // The home is the STORE'S resolution, not the raw env — the
//   // production orchestrator runs with the default home and no
//   // AGENTIC_OS_HOME exported (the r16 receipt: the rung existed and
//   // still did not fire).
//   const harnessHome = process.env.AGENTIC_OS_HOME || join(homedir(), ".local/share/agentic-os")
//
// THE STORE'S RESOLUTION (src/adapters/store.ts:191-202, ADR 0011 —
// unchanged by this diff):
//
//   const next = join(homedir(), ".local", "share", "whitehartlane")
//   const old  = join(homedir(), ".local", "share", "agentic-os")
//   return existsSync(old) && !existsSync(next) ? old : next
//
// The store's DEFAULT disk is `~/.local/share/whitehartlane`;
// `agentic-os` is the LEGACY spelling that only wins while it is the
// ONLY one that exists. The rung hard-codes the LEGACY spelling — it
// is NOT "the STORE's resolution", it is a third hand-written copy
// that disagrees with the store on every ADR-0011 machine.
//
// The same divergence already exists at four other sites
// (src/adapters/trace.ts:24-25, src/doors/project.ts:39-40,
// scripts/review-trace.mjs:23-24, and store.ts itself) — the repo's own
// store.ts carries the TWIN WARNING for exactly this hazard. This diff
// adds a FIFTH site, and it is the one the permission ladder depends
// on.
//
// CONSEQUENCE (verified by running this): on the default disk the rung's
// first clause (`under(path, harnessHome)`) is INERT — the harness's
// own tree is spelled `whitehartlane`, not `agentic-os`. The r15
// receipt's SIBLING ask (`…/sessions/<sid>/jobs/<jid>/jobs`, inside
// the job's own tree, no root contains it) is not an ancestor of the
// cwd, so the second clause cannot catch it either: it falls to the
// tuned judge, whose coin denied it and starved whole review rounds —
// the exact bug this rung was added to fix.
//
// Q2 (one decision, one place): the "where is the harness home?"
// decision now has five sites and this one disagrees with the owner.
//
// The assertion uses only the module's own public surface plus the
// store's homeRoot(), so it LOADS and PASSES on BASE (BASE has no
// rung at all — the ask is denied there too, and the assertion is
// about the rung FIRING) and FAILS on HEAD.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { decidePermission, declareScope } from "../../src/core/permission.ts"
import { homeRoot } from "../../src/adapters/store.ts"

test("the harness-tree rung guards the tree the STORE resolves (the default disk), not a legacy spelling", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "aos-q36-harness-"))
  const prevHome = process.env.HOME
  const prevAoh = process.env.AGENTIC_OS_HOME
  try {
    // the ADR-0011 DEFAULT disk: ~/.local/share/whitehartlane exists,
    // the legacy ~/.local/share/agentic-os does NOT.
    mkdirSync(join(fakeHome, ".local", "share", "whitehartlane"), { recursive: true })
    process.env.HOME = fakeHome
    delete process.env.AGENTIC_OS_HOME

    const harness = join(fakeHome, ".local", "share", "whitehartlane")
    assert.equal(
      homeRoot(),
      harness,
      "the store's resolution on an ADR-0011 default disk is ~/.local/share/whitehartlane — the rung must guard THAT tree",
    )

    // the lens pane's world: <harness>/sessions/<sid>/jobs/<jid>/run/units/<lens>
    const cwd = join(harness, "sessions", "s-1", "jobs", "j-1", "run", "units", "questions")
    const scope = declareScope([cwd])

    // the SIBLING ask (the r15 receipt): inside the job's own tree, no
    // root contains it — the shape the rung was added for.
    const sibling = join(harness, "sessions", "s-1", "jobs", "j-1", "jobs")
    const v = decidePermission({
      question: `Permission required\n⏎   ┃    ← Access external directory ${sibling}`,
      scope,
      home: `${fakeHome}/`,
      cwd,
    })
    assert.equal(
      v.decision,
      "allow",
      `an ask inside the harness's own tree must be allowed without the judge (the r15 receipt) — the rung guards '${join(fakeHome, ".local/share/agentic-os")}', but the store's tree is '${harness}'; got '${v.decision}' — ${v.message}`,
    )
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevAoh !== undefined) process.env.AGENTIC_OS_HOME = prevAoh
    rmSync(fakeHome, { recursive: true, force: true })
  }
})
