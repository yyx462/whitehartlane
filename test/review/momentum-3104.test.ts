// momentum-3104 — one DETECT per problem, DELIVERED on every host: the
// ship-gate arms spell PLAIN notify calls (any notify delivers them)
// and inject the --problem key only when the channel's own --help
// advertises it. The review round of 2026-11-03 produced both halves:
// momentum-1 (P1) proved a spelled --problem is DROPPED by notify
// v0.3.0 (unknown flag → exit 2, stderr swallowed → a stuck PR's
// silence unreported); the 2026-11-03 burst receipt (five DMs in a
// minute for ONE stuck PR) proved per-wording dedup is not enough.
// The guarantee this pin holds: the DM is DELIVERED by a notify that
// does not know --problem, and CARRIES the problem key when it does —
// watcher arm and supervisor brief latch as ONE problem.
//
// (The door's key contract was first pinned at momentum-3102; that id
// is r269's adopted P0-window repro — the collision was principles-2
// of the same review round. This pin lives at a fresh, non-colliding
// id, per principles-3102's law.)
//
// BASE behaviour: src/doors/ship-supervisor.ts does not exist on BASE
// → the import fails → this test SKIPS there (not a classification
// case; an incomplete-fix case).
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// a notify stub with a `--help` that advertises --problem (a v0.5.0+
// channel): the probe must inject the key, and the DM must carry it
function capableStub(dir: string, log: string): string {
  const p = join(dir, "notify-capable")
  writeFileSync(
    p,
    [
      "#!/bin/sh",
      `if [ "${"$"}1" = "--help" ]; then printf 'notify <title> <body> [--problem KEY]\\n'; exit 0; fi`,
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      "exit 0",
    ].join("\n"),
  )
  chmodSync(p, 0o755)
  return p
}

// a notify stub WITHOUT --problem (v0.3.0 semantics: unknown flag →
// exit 2, nothing sent): the spelled plain call must still be delivered
function legacyStub(dir: string, log: string): string {
  const p = join(dir, "notify-legacy")
  writeFileSync(
    p,
    [
      "#!/bin/sh",
      `if [ "${"$"}1" = "--help" ]; then printf 'notify <title> <body> [--photo FILE]\\n'; exit 0; fi`,
      `case "${"$"}*" in *--problem*) exit 2 ;; esac`,
      `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
      "exit 0",
    ].join("\n"),
  )
  chmodSync(p, 0o755)
  return p
}

test("the DM is delivered by a legacy notify and carries the key on a capable one", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom3104-"))
  const prevPath = process.env.PATH
  const prevJid = process.env.AGENTIC_OS_JID
  const prevOrch = process.env.AGENTIC_OS_ORCHESTRATOR
  let watcherPid: number | undefined
  try {
    const out = join(tmp, "auto-reviews", "pr42")
    mkdirSync(join(out, "data", "review"), { recursive: true })

    const capableLog = join(tmp, "capable-dms.txt")
    const legacyLog = join(tmp, "legacy-dms.txt")
    const capable = capableStub(tmp, capableLog)
    const legacy = legacyStub(tmp, legacyLog)
    const ghCalls = join(tmp, "gh-calls.txt")
    const gh = join(tmp, "gh")
    writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(ghCalls)}\nexit 0\n`)
    chmodSync(gh, 0o755)
    const fakeSleep = join(tmp, "sleep")
    writeFileSync(fakeSleep, "#!/bin/sh\nexit 0\n")
    chmodSync(fakeSleep, 0o755)

    // a stub supervisor AGENT that DIES AT ONCE (the deadline arm
    // speaks only over a dead agent — principles-6001)
    const bin = join(tmp, "stub-opencode")
    writeFileSync(bin, "#!/bin/sh\nexit 0\n")
    chmodSync(bin, 0o755)

    process.env.PATH = `${tmp}:${prevPath ?? ""}`
    delete process.env.AGENTIC_OS_JID
    process.env.AGENTIC_OS_ORCHESTRATOR = join(tmp, "orch-stub.mjs")

    const supervisor = await import("../../src/doors/ship-supervisor.ts").catch(() => null)
    if (!supervisor) return // BASE shape: no supervisor at all

    // SEAT 1 — the brief spells the probe + the plain call, and names
    // the key so every timeout speaker latches as one problem
    const brief = supervisor.supervisorBrief({ levyCmd: "LEVY", runDir: "/tmp/run42", pr: "42", repo: tmp })
    assert.match(
      brief,
      /--problem ship-gate:pr42:timeout/,
      `the supervisor brief must name the problem key (ship-gate:pr42:timeout) so the agent's own timeout DM latches as the same problem as the watcher's:\n${brief}`,
    )
    assert.match(
      brief,
      /notify "ship-gate" "PR #42 review timed out[^"]*" \$PF/,
      `the brief's spelled notify call must be the PLAIN shape ending in $PF (deliverable by any notify):\n${brief}`,
    )
    assert.doesNotMatch(
      brief,
      /notify "ship-gate" "PR #42 review timed out[^"]*" --problem/,
      `the brief's spelled call must not carry the flag literally — the key rides the probe variable, never the spelled call:\n${brief}`,
    )

    // SEAT 2 — capable channel: the deadline DM carries the problem key
    // (the watcher resolves 'notify' by name; tmp/ is first on PATH and
    // holds the capable stub under that name)
    const capName = join(tmp, "notify")
    writeFileSync(capName, readFileSync(capable, "utf8"))
    chmodSync(capName, 0o755)
    const s = supervisor.spawnSupervisor({
      brief: "BRIEF",
      cwd: join(tmp, "auto-reviews"),
      logPath: `${out}.supervisor.log`,
      bin,
      outDir: out,
      pr: "42",
      repo: tmp,
    })
    assert.ok(s.ok, `the spawn must succeed (why: ${s.ok ? "" : s.why})`)
    if (!s.ok) return
    watcherPid = s.pid
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      let alive = true
      try {
        process.kill(s.pid, 0)
      } catch {
        alive = false
      }
      if (!alive) break
      await sleep(200)
    }

    const dms = existsSync(capableLog) ? readFileSync(capableLog, "utf8").split("\n").filter((l) => l.trim()) : []
    assert.equal(
      dms.length,
      1,
      `the watcher speaks ONCE per commission — got ${dms.length} DM call(s):\n${dms.join("\n")}`,
    )
    assert.match(
      dms[0] ?? "",
      /--problem ship-gate:pr42:timeout/,
      `on a channel that advertises --problem, the timeout DM must carry the problem key (one detect per problem). DM heard:\n${dms.join("\n") || "(none)"}`,
    )
    // the PR still hears its own receipt (the silence law) — untouched
    const comments = existsSync(ghCalls) ? readFileSync(ghCalls, "utf8") : ""
    assert.match(comments, /pr comment 42/, "the PR receipt must still post (the latch is on the HUMAN's DM, never on the PR's receipt)")

    // SEAT 3 — legacy channel: the SAME spelled call must still DELIVER
    // (plain), or a stuck PR's silence goes unreported (momentum-1)
    const legacyName = join(tmp, "notify")
    writeFileSync(legacyName, readFileSync(legacy, "utf8"))
    chmodSync(legacyName, 0o755)
    rmSync(capableLog, { force: true })
    const s2 = supervisor.spawnSupervisor({
      brief: "BRIEF",
      cwd: join(tmp, "auto-reviews"),
      logPath: `${out}.supervisor-legacy.log`,
      bin,
      outDir: out,
      pr: "43",
      repo: tmp,
    })
    assert.ok(s2.ok, `the second spawn must succeed (why: ${s2.ok ? "" : s2.why})`)
    if (!s2.ok) return
    watcherPid = s2.pid
    const deadline2 = Date.now() + 90_000
    while (Date.now() < deadline2) {
      let alive = true
      try {
        process.kill(s2.pid, 0)
      } catch {
        alive = false
      }
      if (!alive) break
      await sleep(200)
    }
    const legacyDms = existsSync(legacyLog) ? readFileSync(legacyLog, "utf8").split("\n").filter((l) => l.trim()) : []
    assert.equal(
      legacyDms.length,
      1,
      `on a legacy notify the timeout DM must still be DELIVERED exactly once (plain spelling) — got ${legacyDms.length}:\n${legacyDms.join("\n") || "(none)"}`,
    )
    assert.doesNotMatch(
      legacyDms[0] ?? "",
      /--problem/,
      `a legacy channel must not be handed the flag it cannot parse:\n${legacyDms.join("\n") || "(none)"}`,
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
