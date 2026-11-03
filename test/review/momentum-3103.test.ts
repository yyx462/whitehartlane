// momentum-3103 — the ship-gate's HUMAN ALERT must be deliverable by
// the notify CLI this host actually runs.
//
// The change (src/doors/ship-supervisor.ts) puts `--problem <key>` on
// every arm's notify call: the watcher's STALLED arm (line 183), the
// watcher's TIMEOUT arm (line 199), and the supervisor BRIEF's step 7
// (line 38). The channel is yyxSkills' notify.sh — v0.3.0 on this
// host — and its parser REJECTS unknown flags:
//
//   notify <title> <body> [--photo FILE] [--dry-run]
//   … *) printf 'error: unknown flag %s\n' "$1" >&2; usage >&2; exit 2
//
// So the arm's DM is REJECTED (exit 2) and NOTHING is sent — and the
// door redirects the channel's stderr to /dev/null, so the drop is
// silent. The arm exists so "a human hears the silence" (the door's
// own words, the brief's step 7) and the PR's 2h timeout becomes a
// silence nobody hears.
//
// The commands under test are read out of the door's OWN artifacts —
// the wrapper script spawnSupervisor writes, and the brief
// supervisorBrief returns — not hand-copied literals, so this test
// tracks the shipped code.
//
// BASE: the same two artifacts call notify WITHOUT --problem → the
// channel accepts them (exit 0) → this test PASSES on BASE. The
// change introduced the drop.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// a notify invocation as the door spells it: title, body, optional key
const NOTIFY_CALL = /notify\s+"[^"]*"\s+"[^"]*"(?:\s+--problem\s+"[^"]*")?/g

const realNotify = (): string | null => {
  const which = spawnSync("sh", ["-c", "command -v notify"], { encoding: "utf8" }).stdout?.trim() ?? ""
  if (which && existsSync(which)) return which
  const fallback = join(homedir(), ".local", "bin", "notify")
  return existsSync(fallback) ? fallback : null
}

test("every ship-gate arm's DM must be deliverable by the notify CLI this host runs", async () => {
  const notifyBin = realNotify()
  assert.ok(notifyBin, "the notify CLI the ship-gate depends on is not installed here — the DM path cannot be proven")
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom3103-"))
  const prevPath = process.env.PATH
  const prevJid = process.env.AGENTIC_OS_JID
  const prevOrch = process.env.AGENTIC_OS_ORCHESTRATOR
  let watcherPid: number | undefined
  try {
    // a stub 'notify' FIRST on PATH: the spawned watcher must never DM
    // a human mid-test (its deadline arm is 7200 waits away)
    const stubDir = join(tmp, "stub")
    mkdirSync(stubDir, { recursive: true })
    writeFileSync(join(stubDir, "notify"), "#!/bin/sh\nexit 0\n")
    chmodSync(join(stubDir, "notify"), 0o755)
    // a dummy channel home: the real notify runs offline and --dry-run
    // renders the message without sending it
    const notifyHome = join(tmp, "notify-home")
    mkdirSync(notifyHome, { recursive: true })
    writeFileSync(join(notifyHome, "telegram.json"), JSON.stringify({ bot_token: "x", chat_id: "y" }))
    // a no-op orchestrator stub: a scratch drive must never book a real
    // workflow
    const orchStub = join(tmp, "orch-stub.mjs")
    writeFileSync(orchStub, "export default {}\n")
    // the fake supervisor agent: dies at once (the deadline arm speaks
    // only over a DEAD agent)
    const bin = join(tmp, "stub-opencode")
    writeFileSync(bin, "#!/bin/sh\nexit 0\n")
    chmodSync(bin, 0o755)

    process.env.PATH = `${stubDir}:${prevPath ?? ""}`
    delete process.env.AGENTIC_OS_JID
    process.env.AGENTIC_OS_ORCHESTRATOR = orchStub

    const mod = await import("../../src/doors/ship-supervisor.ts")
    const outDir = join(tmp, "out")
    mkdirSync(join(outDir, "data", "review"), { recursive: true })
    const logPath = join(tmp, "supervisor.log")
    const s = mod.spawnSupervisor({
      brief: "BRIEF",
      cwd: tmp,
      logPath,
      bin,
      outDir,
      pr: "42",
      repo: tmp,
    })
    assert.ok(s.ok, `the spawn must succeed (why: ${s.ok ? "" : s.why})`)
    if (!s.ok) return
    watcherPid = s.pid

    const wrapper = readFileSync(`${logPath}.watch`, "utf8")
    const brief = mod.supervisorBrief({ levyCmd: "LEVY", runDir: join(tmp, "run42"), pr: "42", repo: tmp })

    const calls = [...wrapper.matchAll(NOTIFY_CALL)].map((m) => m[0]).concat([...brief.matchAll(NOTIFY_CALL)].map((m) => m[0]))
    assert.ok(calls.length >= 2, `the door must spell out its notify calls (found ${calls.length})`)

    // run each of the door's OWN commands against the REAL notify with
    // --dry-run: nothing is sent, but the channel's parser has the last
    // word on whether the command is even legal
    const env = { ...process.env, PATH: prevPath ?? "", NOTIFY_HOME: notifyHome }
    const rejected: string[] = []
    for (const call of calls) {
      const r = spawnSync("sh", ["-c", `PR=42; DV=accept; ${call} --dry-run`], { encoding: "utf8", env })
      if (r.status !== 0) rejected.push(`exit ${r.status} — ${(r.stderr ?? "").split("\n")[0]} — ${call}`)
    }
    assert.equal(
      rejected.length,
      0,
      `the ship-gate's DM must be DELIVERABLE by the notify CLI this host runs (${notifyBin}), but the door's own command is REJECTED by it:\n${rejected.join("\n")}\n\n` +
        `the --problem flag this change puts on every arm (the watcher's stalled arm, the watcher's timeout arm, the brief's step 7) is NOT in the notify CLI installed here — v0.3.0 exits 2 on an unknown flag and sends NOTHING, and the door redirects the channel's stderr to /dev/null, so a stuck PR's timeout DM is dropped SILENTLY and the human never hears the silence the arm exists to report.`,
    )
  } finally {
    if (watcherPid) {
      try {
        process.kill(watcherPid, "SIGTERM")
      } catch {
        /* already gone */
      }
    }
    if (prevPath === undefined) delete process.env.PATH
    else process.env.PATH = prevPath
    if (prevJid === undefined) delete process.env.AGENTIC_OS_JID
    else process.env.AGENTIC_OS_JID = prevJid
    if (prevOrch === undefined) delete process.env.AGENTIC_OS_ORCHESTRATOR
    else process.env.AGENTIC_OS_ORCHESTRATOR = prevOrch
    rmSync(tmp, { recursive: true, force: true })
  }
})
