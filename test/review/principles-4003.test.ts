// principles-4003 — the box-in-box law needs a seat at the NEW spawn.
//
// The change's law (src/adapters/levy.ts): "a process running INSIDE a
// review job (the orchestrator exports AGENTIC_OS_SID/JID to every lens and
// gate shell) may not book another REAL workflow — reviewer-spawned reviewer
// panes are zombies grinding on sandboxes the reviewer already deleted."
// The escape is a STUB: "a set AGENTIC_OS_ORCHESTRATOR means the spawn
// targets a STUB … the ban is on recursion, not on verification".
//
// That law has exactly ONE seat: spawnRunner (the levy/orchestrator spawn).
// The change adds a SECOND spawn that books a real agent —
// spawnSupervisor (src/doors/ship-supervisor.ts), the --auto mint's
// one-shot headless owner — and it has NO box-in-box guard. The new lens
// preamble tells the reader exactly how to drive a door safely ("export
// AGENTIC_OS_ORCHESTRATOR pointing at a no-op stub first"), but that stub
// only makes the ORCHESTRATOR spawn a stub: the supervisor seat still
// spawns the real `opencode`.
//
// So inside a review job the ban is bypassable on the new path: a lens that
// hand-drives `whl review --auto` mints a REAL agent (the very zombie the
// ruling kills), the levy inside it then refuses (box-in-box), and the PR
// gets a false "no verdict" comment.
//
// The repro: inside a review job (AGENTIC_OS_JID set), with the preamble's
// stub exported, the supervisor seat must REFUSE to mint an owner.
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

test("box-in-box: inside a review job the supervisor seat must not mint a real owner", async () => {
  // the seat is NEW in this change: on a BASE without it the law is
  // violated too (there is no guard at all) — so the import is dynamic
  // and the missing seat FAILS the test instead of breaking the load.
  const mod = (await import("../../src/doors/ship-supervisor.ts").catch(() => null)) as
    | typeof import("../../src/doors/ship-supervisor.ts")
    | null
  assert.ok(mod, "the supervisor seat must exist — and it must carry the box-in-box guard")
  const { spawnSupervisor } = mod
  const tmp = mkdtempSync(join(tmpdir(), "aos-boxinbox-sup-"))
  const prev = { ...process.env }
  try {
    // the stub door the preamble tells a lens to export
    const stub = join(tmp, "orch-stub.mjs")
    writeFileSync(stub, "// no-op stub\n")
    // a stub `opencode` on PATH: the preflight finds it, and NOTHING real
    // is spawned by the test. The supervisor bin is NOT pinned
    // (WHL_SUPERVISOR_BIN unset) — the default spelling, exactly what the
    // --auto mint uses.
    const bindir = join(tmp, "bin")
    mkdirSync(bindir, { recursive: true })
    const verdict = join(tmp, "run", "data", "review", "verdict.json")
    writeFileSync(
      join(bindir, "opencode"),
      ["#!/bin/sh", "sleep 3", `mkdir -p "$(dirname ${JSON.stringify(verdict)})"`, `echo '{}' > ${JSON.stringify(verdict)}`, ""].join("\n"),
    )
    chmodSync(join(bindir, "opencode"), 0o755)

    process.env.AGENTIC_OS_JID = "j-inside"
    process.env.AGENTIC_OS_ORCHESTRATOR = stub
    delete process.env.WHL_SUPERVISOR_BIN
    process.env.PATH = `${bindir}:${prev.PATH ?? ""}`

    const s = spawnSupervisor({
      brief: "BRIEF",
      cwd: tmp,
      logPath: join(tmp, "supervisor.log"),
      outDir: join(tmp, "run"),
      pr: "42",
      repo: tmp,
    })
    if (s.ok) {
      // never leave the watcher behind
      try {
        process.kill(s.pid, "SIGKILL")
      } catch {
        /* already gone */
      }
    }
    assert.ok(
      !s.ok,
      `inside a review job (AGENTIC_OS_JID=${process.env.AGENTIC_OS_JID}) the supervisor seat must refuse to book an agent — the orchestrator stub does not make the supervisor a stub (got ok:true, pid ${s.ok ? s.pid : "?"})`,
    )
  } finally {
    for (const k of ["AGENTIC_OS_JID", "AGENTIC_OS_ORCHESTRATOR", "WHL_SUPERVISOR_BIN", "PATH"]) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
    rmSync(tmp, { recursive: true, force: true })
  }
})
