// principles-5104 — the harness-tree rung resolves the harness home
// with a HARD-CODED legacy disk spelling, not the STORE's resolution.
//
// THE CHANGE'S OWN CLAIM (src/core/permission.ts:330-336, added by
// this diff):
//
//   // The home is the STORE'S resolution, not the raw env — the
//   // production orchestrator runs with the default home and no
//   // AGENTIC_OS_HOME exported (the r16 receipt: the rung existed and
//   // still did not fire).
//   const harnessHome = process.env.AGENTIC_OS_HOME || join(homedir(), ".local/share/agentic-os")
//
// The STORE's resolution (src/adapters/store.ts:191-202, ADR 0011) is:
//
//   const next = join(homedir(), ".local", "share", "whitehartlane")
//   const old  = join(homedir(), ".local", "share", "agentic-os")
//   return existsSync(old) && !existsSync(next) ? old : next
//
// So the DEFAULT disk is `~/.local/share/whitehartlane`; `agentic-os`
// is the LEGACY spelling that only wins while it is the ONLY one that
// exists. The rung hard-codes the LEGACY spelling — a THIRD site for
// the "where is the harness home?" decision (store.ts, project.ts,
// trace.ts already carry their own copies), and the two disagree on
// every ADR-0011 machine.
//
// CONSEQUENCE: the rung's first clause (`under(path, harnessHome)`) is
//INERT on a default disk. The r15 receipt's SIBLING ask —
// `…/sessions/<sid>/jobs/<jid>/jobs`, inside the job's own tree, no
// root contains it — is not an ancestor of the cwd, so the second
// clause cannot catch it either: it falls to the tuned judge, whose
// coin denied it and starved whole review rounds. That is the exact
// bug the rung was added to fix.
//
// INV-3 (one function per decision) + the change's own claim.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { decidePermission, declareScope } from "../../src/core/permission.ts"
import { homeRoot } from "../../src/adapters/store.ts"

test("the harness-tree rung uses the STORE's home resolution, not a hard-coded legacy disk spelling", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "aos-harness-home-"))
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
      "the store's resolution on an ADR-0011 default disk is ~/.local/share/whitehartlane",
    )

    // the lens pane's world: <harness>/sessions/<sid>/jobs/<jid>/run/units/<lens>
    const cwd = join(harness, "sessions", "s-1", "jobs", "j-1", "run", "units", "principles")
    const scope = declareScope([cwd])

    // the SIBLING ask (the r15 receipt): inside the job's own tree,
    // no root contains it.
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
      `an ask inside the harness's own tree must be allowed without the judge (the r15 receipt); got '${v.decision}' — ${v.message}`,
    )
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevAoh !== undefined) process.env.AGENTIC_OS_HOME = prevAoh
    rmSync(fakeHome, { recursive: true, force: true })
  }
})
