// tests-10402 (tests lens) — THE HARNESS-TREE RUNG GUARDS THE WRONG
// TREE: IT RE-IMPLEMENTS THE HARNESS-HOME RESOLUTION WITH A HARD-CODED
// LEGACY SPELLING, SO THE RUNG IS INERT ON THE STORE'S DEFAULT DISK.
//
// WHAT THE CHANGE CLAIMS (src/core/permission.ts, the rung this diff
// adds — and the fix this diff's own last commits claim for it):
//
//   // The home is the STORE'S resolution, not the raw env — the
//   // production orchestrator runs with the default home and no
//   // AGENTIC_OS_HOME exported (the r16 receipt: the rung existed and
//   // still did not fire).
//   const harnessHome = process.env.AGENTIC_OS_HOME || join(homedir(), ".local/share/agentic-os")
//   const harnessTree = resolve(harnessHome, "..")
//   if (under(path, harnessHome) || (under(path, harnessTree) && allowedRoots.some((root) => under(root, path)))) {
//     return { decision: "allow", ... }
//   }
//
// and (test/permission.test.ts, added by THIS diff):
//
//   test("THE r16 REGRESSION: the rung fires with AGENTIC_OS_HOME unset
//   — the production orchestrator exports no env, the store's default
//   home governs", ...)
//
// THE STORE'S RESOLUTION (src/adapters/store.ts:191-202, ADR 0011) is:
//
//   if (process.env.AGENTIC_OS_HOME) return process.env.AGENTIC_OS_HOME
//   const next = join(homedir(), ".local", "share", "whitehartlane")
//   const old  = join(homedir(), ".local", "share", "agentic-os")
//   return existsSync(old) && !existsSync(next) ? old : next
//
// So the DEFAULT disk is `~/.local/share/whitehartlane`; `agentic-os`
// is the LEGACY spelling that wins ONLY while it is the only one that
// exists. The rung hard-codes the LEGACY spelling — a THIRD site for
// the "where is the harness home?" decision (store.ts and
// scripts/review-trace.mjs already carry their own copies, and
// store.ts's own comment warns: "TWIN WARNING ... if you change the
// order or the spellings, change both").
//
// CONSEQUENCE ON THE NORMAL PATH: the store's default disk holds the
// sessions, so every lens pane's cwd is
// `<home>/sessions/<sid>/jobs/<jid>/run/units/<lens>` under
// whitehartlane — while the rung guards `~/.local/share/agentic-os`,
// which does not exist there. The rung NEVER FIRES: the asks that
// actually arrive (a coarse ancestor, a sibling inside the job tree)
// fall to the tuned judge, whose coin denies them ("deny-unneeded") —
// the exact starvation the r12/r14/r15 receipts describe (three whole
// review rounds starved to pane-reap).
//
// The diff's own test for the r16 "regression" proves the wrong thing:
// it sets HOME=/Users/me and asks about "/Users/me/.local/share" —
// which is the LEGACY spelling's ancestor, so the hard-coded spelling
// happens to cover it. The store's own default disk (whitehartlane) is
// the case the change never proves.
//
// INV-3 (one decision — "where is the harness home?" — one place) plus
// the change's own written claim.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { decidePermission, declareScope } from "../../src/core/permission.ts"
import { homeRoot } from "../../src/adapters/store.ts"

test("the harness-tree rung must guard the tree the STORE resolves (the whitehartlane disk), not the legacy agentic-os one", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "aos-harness-tree-"))
  const prevHome = process.env.HOME
  const prevAoh = process.env.AGENTIC_OS_HOME
  try {
    // the ADR-0011 DEFAULT disk: ~/.local/share/whitehartlane exists,
    // the legacy ~/.local/share/agentic-os does NOT.
    const harness = join(fakeHome, ".local", "share", "whitehartlane")
    mkdirSync(join(harness, "sessions", "s-1", "jobs", "j-1", "run", "units", "principles"), { recursive: true })
    process.env.HOME = fakeHome
    delete process.env.AGENTIC_OS_HOME

    assert.equal(
      homeRoot(),
      harness,
      "the store's resolution on the ADR-0011 default disk is ~/.local/share/whitehartlane — the rung must guard THAT tree",
    )

    // the lens pane's world (the shape the rail actually spawns)
    const cwd = join(harness, "sessions", "s-1", "jobs", "j-1", "run", "units", "principles")
    const scope = declareScope([cwd])

    // (1) the SIBLING inside the job's own tree (the r15 receipt): no
    //     root contains it and it is not an ancestor of the cwd
    const sibling = join(harness, "sessions", "s-1", "jobs", "j-1", "jobs")
    const sib = decidePermission({
      question: `Permission required\n⏎   ┃    ← Access external directory ${sibling}`,
      scope,
      home: `${fakeHome}/`,
      cwd,
    })
    assert.equal(
      sib.decision,
      "allow",
      `an ask inside the harness's own tree must be allowed without the judge (the r15 receipt); got '${sib.decision}' — ${sib.message}`,
    )

    // (2) the COARSE ANCESTOR the roots test can never match (the
    //     r12/r14 receipt): an ancestor of the Job's own roots
    const ancestor = join(harness, "sessions")
    const anc = decidePermission({
      question: `Permission required\n⏎   ┃    ← Access external directory ${ancestor}`,
      scope,
      home: `${fakeHome}/`,
      cwd,
    })
    assert.equal(
      anc.decision,
      "allow",
      `an ancestor of the Job's own roots inside the harness tree must be allowed; got '${anc.decision}' — ${anc.message}`,
    )
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevAoh !== undefined) process.env.AGENTIC_OS_HOME = prevAoh
    rmSync(fakeHome, { recursive: true, force: true })
  }
})

test("the rung's home resolution is the STORE's — one decision, one place (INV-3)", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "aos-harness-one-"))
  const prevHome = process.env.HOME
  const prevAoh = process.env.AGENTIC_OS_HOME
  try {
    const harness = join(fakeHome, ".local", "share", "whitehartlane")
    mkdirSync(harness, { recursive: true })
    process.env.HOME = fakeHome
    delete process.env.AGENTIC_OS_HOME
    // the rung must resolve the SAME home the store resolves — the
    // store is the owner of that decision (ADR 0011). A rung that
    // spells its own home is a second site with its own answer.
    const cwd = join(harness, "sessions", "s-1", "jobs", "j-1", "run", "units", "principles")
    const scope = declareScope([cwd])
    const inside = join(harness, "sessions", "s-1", "jobs", "j-1", "jobs")
    const v = decidePermission({
      question: `Permission required\n⏎   ┃    ← Access external directory ${inside}`,
      scope,
      home: `${fakeHome}/`,
      cwd,
    })
    assert.equal(
      v.decision,
      "allow",
      `the rung must resolve homeRoot(), not a hard-coded spelling — got '${v.decision}' — ${v.message}`,
    )
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevAoh !== undefined) process.env.AGENTIC_OS_HOME = prevAoh
    rmSync(fakeHome, { recursive: true, force: true })
  }
})
