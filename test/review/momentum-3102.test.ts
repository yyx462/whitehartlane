// momentum-3102 — one DETECT per problem: every ship-gate arm names the
// SAME --problem key, so the notify channel latches the PROBLEM, not the
// wording (the 2026-11-03 burst receipt: five DMs in a minute for ONE
// stuck PR — re-commissioned watchers plus the supervisor brief's own
// timeout DM re-pinged the human with per-commission wordings).
//
// src/doors/ship-supervisor.ts, three speaking seats:
//
//   the watcher's TIMEOUT arm (dead agent, no verdict):
//   `  … notify "ship-gate" "PR #$PR review timed out — the watcher is
//   `  the last word" --problem "ship-gate:pr$PR:timeout" …`
//
//   the watcher's STALLED arm (dead agent, verdict landed):
//   `  … notify "ship-gate" "PR #$PR: ${DV:-unfinished} — the chain died
//   `  before the merge stage" --problem "ship-gate:pr$PR:stalled" …`
//
//   the supervisor BRIEF, step 7 (the agent's own timeout DM):
//   `  … notify "ship-gate" "PR #<pr> review timed out — supervisor log
//   `  beside <runDir>" --problem "ship-gate:pr<pr>:timeout" …`
//
// The watcher arm and the brief MUST name the same key for the timeout
// (one problem, two possible speakers); the stalled arm names a distinct
// key (a different event: the chain died between prove and merge —
// tests-30001's honest words). The latch itself lives in the notify
// channel (yyxSkills#118, notify >= 0.5.0); this door's contract is the
// KEY SPELLING — a typo here silently un-latches the problem.
//
// BASE behaviour: src/doors/ship-supervisor.ts does not exist on BASE
// → the import fails → this test SKIPS there (not a classification case;
// an incomplete-fix case).
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("every speaking arm names the same per-problem key", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom3102-"))
  const prevPath = process.env.PATH
  const prevJid = process.env.AGENTIC_OS_JID
  const prevOrch = process.env.AGENTIC_OS_ORCHESTRATOR
  let watcherPid: number | undefined
  try {
    // the seat dir EXISTS (the gone-world exit is momentum-1000's finding
    // and must not mask this one); NO verdict, NO merge marker — the
    // honest words at the deadline are "the review timed out (2h)"
    const out = join(tmp, "auto-reviews", "pr42")
    mkdirSync(join(out, "data", "review"), { recursive: true })

    // a FAKE notify: records its argv, never DMs a human mid-test
    const notifyCalls = join(tmp, "notify-calls.txt")
    const notify = join(tmp, "notify")
    writeFileSync(notify, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(notifyCalls)}\nexit 0\n`)
    chmodSync(notify, 0o755)
    // a FAKE gh: the timeout arm also posts the PR receipt — record it
    const ghCalls = join(tmp, "gh-calls.txt")
    const gh = join(tmp, "gh")
    writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(ghCalls)}\nexit 0\n`)
    chmodSync(gh, 0o755)
    // a FAKE sleep: the counted deadline (7200 iterations) must be
    // reachable in a test without wall-clock hours
    const fakeSleep = join(tmp, "sleep")
    writeFileSync(fakeSleep, "#!/bin/sh\nexit 0\n")
    chmodSync(fakeSleep, 0o755)

    // a stub supervisor AGENT that DIES AT ONCE: the deadline arm speaks
    // only over a dead agent (principles-6001), so the stub must be dead
    // by the time the counted deadline lands
    const agentPidFile = join(tmp, "agent.pid")
    const bin = join(tmp, "stub-opencode")
    writeFileSync(
      bin,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$$" > ${JSON.stringify(agentPidFile)}`,
        "exit 0",
        "",
      ].join("\n"),
    )
    chmodSync(bin, 0o755)

    process.env.PATH = `${tmp}:${prevPath ?? ""}`
    delete process.env.AGENTIC_OS_JID
    process.env.AGENTIC_OS_ORCHESTRATOR = join(tmp, "orch-stub.mjs")

    const supervisor = await import("../../src/doors/ship-supervisor.ts").catch(() => null)
    if (!supervisor) return // BASE shape: no supervisor at all

    // SEAT 1 — the brief: the agent's own timeout DM names the same key
    // the watcher's timeout arm names (one problem, two speakers)
    const brief = supervisor.supervisorBrief({ levyCmd: "LEVY", runDir: "/tmp/run42", pr: "42", repo: tmp })
    assert.match(
      brief,
      /--problem "ship-gate:pr42:timeout"/,
      `the supervisor brief's step-7 notify must carry the problem key the watcher's timeout arm names — different wordings of ONE timeout must latch as ONE problem, else the human gets the burst back:\n${brief}`,
    )

    // SEAT 2 — the watcher's timeout arm over a DEAD agent, no verdict:
    // the DM must carry --problem ship-gate:pr42:timeout
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

    const dms = existsSync(notifyCalls) ? readFileSync(notifyCalls, "utf8").split("\n").filter((l) => l.trim()) : []
    assert.ok(
      dms.some((l) => l.includes("--problem ship-gate:pr42:timeout")),
      `the watcher's timeout DM must carry the problem key --problem ship-gate:pr42:timeout (the channel latches the PROBLEM; a missing key un-latches the burst fix). notify calls heard:\n${dms.join("\n") || "(none)"}`,
    )
    assert.equal(
      dms.length,
      1,
      `the watcher speaks ONCE per commission — got ${dms.length} DM call(s):\n${dms.join("\n")}`,
    )
    // the PR still hears its own receipt (the silence law) — untouched
    const comments = existsSync(ghCalls) ? readFileSync(ghCalls, "utf8") : ""
    assert.match(comments, /pr comment 42/, "the PR receipt must still post (the latch is on the HUMAN's DM, never on the PR's receipt)")
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
