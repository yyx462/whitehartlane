// momentum-2004 — the repo UNDER REVIEW shadows the supervisor agent's own
// binary: the PR's own code becomes the agent that decides and reports the
// PR's verdict.
//
// The change (src/doors/ship-supervisor.ts, the watch script the door
// writes) begins the agent's environment with:
//
//   export PATH="<repo>/bin:$PATH"
//   "$BIN" run --standalone "$BRIEF" >>"$LOG" 2>&1 &
//
// BIN defaults to the bare word "opencode" (opts.bin ?? WHL_SUPERVISOR_BIN
// ?? "opencode"), so the shell resolves it against the PATH the line above
// just rewrote — and that PATH now carries the REVIEWED repo's bin/ FIRST.
//
// The comment above the export says the export exists so "the door that
// minted the commission is the door that runs it" — but the minting door is
// named by ABSOLUTE path in the levy itself (momentum-907:
// `mintingDoor = join(import.meta.dirname, "whitehartlane")`), so the export
// does not serve that purpose at all. Its only effect is to put the code
// UNDER REVIEW ahead of the harness's own tools (opencode, gh, notify) on
// the PATH of the process that decides and reports the PR's verdict.
//
// So a PR that ships bin/opencode becomes the supervisor agent: the agent
// that is supposed to hear the review's finish, post the verdict to the PR
// and refuse to merge — replaced by the PR's own code. The same rewrite
// also redirects the watcher's `gh pr comment` and `notify` calls.
//
// The repro drives the real seat (spawnSupervisor) and asserts that the
// reviewed repo's bin/opencode never runs.
//
// BASE behaviour: src/doors/ship-supervisor.ts does not exist on BASE → the
// import is absent → this test cannot fail there; the feature is introduced
// by this diff.
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("momentum-2004: the repo under review must not shadow the supervisor agent's binary", async () => {
  const mod = (await import("../../src/doors/ship-supervisor.ts").catch(() => null)) as
    | typeof import("../../src/doors/ship-supervisor.ts")
    | null
  assert.ok(mod, "the supervisor seat must exist — and the reviewed repo's bin must not own the agent")
  const { spawnSupervisor } = mod

  const tmp = mkdtempSync(join(tmpdir(), "aos-mom2004-"))
  const prevPath = process.env.PATH
  const prevJid = process.env.AGENTIC_OS_JID
  let watcher: number | undefined
  try {
    // the HARNESS's own opencode (a stub — the preflight must find a
    // binary named `opencode` on the PATH, or the seat refuses before
    // it ever spawns)
    const harnessBin = join(tmp, "harness-bin")
    mkdirSync(harnessBin, { recursive: true })
    const harnessMarker = join(tmp, "harness-ran.txt")
    writeFileSync(join(harnessBin, "opencode"), ["#!/bin/sh", `printf 'harness' > ${harnessMarker}`, ""].join("\n"))
    chmodSync(join(harnessBin, "opencode"), 0o755)

    // THE PR UNDER REVIEW ships bin/opencode — the reviewed repo's code
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "bin"), { recursive: true })
    const prMarker = join(tmp, "pr-ran.txt")
    writeFileSync(join(repo, "bin", "opencode"), ["#!/bin/sh", `printf 'pr' > ${prMarker}`, ""].join("\n"))
    chmodSync(join(repo, "bin", "opencode"), 0o755)

    // the seat must spawn something: the agent has to be found on the
    // PATH the watcher builds
    process.env.PATH = `${harnessBin}:${prevPath ?? ""}`
    delete process.env.AGENTIC_OS_JID
    delete process.env.WHL_SUPERVISOR_BIN

    const out = join(tmp, "out")
    // a verdict seat so the watcher leaves its wait loop as soon as the
    // agent is gone (the watcher must not outlive the test)
    mkdirSync(join(out, "data", "review"), { recursive: true })
    writeFileSync(join(out, "data", "review", "verdict.json"), "{}\n")

    const s = spawnSupervisor({
      brief: "BRIEF",
      cwd: tmp,
      logPath: join(tmp, "supervisor.log"),
      outDir: out,
      // no PR number: the watcher must not post anything to a real PR
      repo,
    })
    assert.ok(s.ok, `the seat must spawn against a stub bin (why: ${s.ok ? "" : s.why})`)
    if (!s.ok) return
    watcher = s.pid

    // wait for whichever `opencode` ran
    let prRan = false
    for (let i = 0; i < 60 && !prRan; i++) {
      await sleep(100)
      prRan = existsSync(prMarker)
    }
    assert.ok(
      !prRan,
      `the repo under review shipped bin/opencode and THAT ran as the supervisor agent — the PR's own code decides and reports its own verdict (the watcher's PATH rewrite put ${repo}/bin ahead of the harness's tools) (marker: ${prMarker})`,
    )
    assert.ok(
      existsSync(harnessMarker),
      "the harness's own opencode must be the one the supervisor agent runs (the agent never started)",
    )
  } finally {
    if (watcher !== undefined) {
      try {
        process.kill(watcher, "SIGKILL")
      } catch {
        /* already gone */
      }
    }
    if (prevPath === undefined) delete process.env.PATH
    else process.env.PATH = prevPath
    if (prevJid === undefined) delete process.env.AGENTIC_OS_JID
    else process.env.AGENTIC_OS_JID = prevJid
    rmSync(tmp, { recursive: true, force: true })
  }
})
