// principles-6001 — the ship WATCHER's timeout arm speaks over a LIVE
// supervisor agent.
//
// src/doors/ship-supervisor.ts, the wrapper the door writes (the file
// that mints the watch for a parentless `--auto` commission):
//
//   `while [ ! -f "$OUT/data/review/merge.json" ]; do`
//   `  sleep 1; i=$((i+1))`
//   `  …`
//   `  if [ -f "$OUT/data/review/verdict.json" ] && ! kill -0 "$AGENT" 2>/dev/null; then break; fi`
//   `  if [ "$i" -ge 7200 ]; then`
//   `    … gh pr comment "$PR" --body "ship-gate: the review timed out (2h) …"`
//   `    … notify "ship-gate" "PR #$PR review timed out — the watcher is the last word"`
//   `    exit 3`
//   `  fi`
//   `done`
//   // the BACKSTOP receipt (momentum-908 / momentum-1003): the watcher
//   // speaks only over a DEAD agent that never posted —
//   `while kill -0 "$AGENT" 2>/dev/null && [ "$w" -lt 3600 ]; do sleep 2; w=$((w+2)); done`
//   `if test -f "$OUT/supervisor-posted.md"; then :; elif [ -n "$PR" ] && command -v gh >/dev/null 2>&1 && ! kill -0 "$AGENT" 2>/dev/null; then`
//   `  … gh pr comment "$PR" --body "ship-gate: ${V:-unfinished} — the supervisor did not post …"`
//   `fi`
//
// ONE decision — "may the watcher publish a receipt to the PR?" — is
// answered in TWO arms of the SAME script with TWO different answers:
// the BACKSTOP arm waits for the agent to be DEAD ("speak only over a
// DEAD agent that never posted"), the TIMEOUT arm publishes while the
// agent is ALIVE. The agent is alive at the deadline by construction:
// it is the process waiting for the merge seat (its own brief's step 2
// waits the same 7200s), and the watcher's clock starts BEFORE the
// agent's (the watcher spawns it), so the watcher's deadline lands
// first.
//
// The consequence is TWO receipts and TWO notify DMs for ONE
// commission at the deadline — and the FIRST one states a fact about
// a commission that is still live ("the review timed out (2h) — no
// outcome landed"), which the supervisor's own receipt (a few seconds
// later) contradicts. The watcher's own DM claims "the watcher is the
// last word"; it is not.
//
// BASE behaviour: src/doors/ship-supervisor.ts does not exist on BASE
// → the import fails → this test SKIPS there (it is not a
// classification case; it is an incomplete-fix case).
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("a LIVE supervisor owns the receipt: the watcher publishes nothing over it", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-principles6001-"))
  const prevPath = process.env.PATH
  const prevJid = process.env.AGENTIC_OS_JID
  const prevOrch = process.env.AGENTIC_OS_ORCHESTRATOR
  let watcherPid: number | undefined
  let agentPid: number | undefined
  try {
    // the seat dir EXISTS (the gone-world exit is a DIFFERENT finding —
    // momentum-1000 — and must not mask this one)
    const out = join(tmp, "auto-reviews", "pr42")
    mkdirSync(join(out, "data", "review"), { recursive: true })

    const calls = join(tmp, "gh-calls.txt")
    const gh = join(tmp, "gh")
    writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\nexit 0\n`)
    chmodSync(gh, 0o755)
    // a FAKE notify: the real one would DM a human mid-test
    const notify = join(tmp, "notify")
    writeFileSync(notify, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(join(tmp, "notify-calls.txt"))}\nexit 0\n`)
    chmodSync(notify, 0o755)
    // a FAKE sleep: the watcher's deadline is 7200 iterations of
    // `sleep 1` — two hours of wall clock. The stub sleep makes the
    // COUNTED deadline reachable in a test without changing the
    // countdown the script actually performs.
    const fakeSleep = join(tmp, "sleep")
    writeFileSync(fakeSleep, "#!/bin/sh\nexit 0\n")
    chmodSync(fakeSleep, 0o755)

    // the stub supervisor AGENT: ALIVE and waiting (the commission is
    // still live — the chain has not reached the merge seat). It never
    // posts: the question is whether the WATCHER speaks over it.
    const agentPidFile = join(tmp, "agent.pid")
    const bin = join(tmp, "stub-opencode")
    writeFileSync(
      bin,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$$" > ${JSON.stringify(agentPidFile)}`,
        // absolute /bin/sleep: the PATH shim above must not shorten the
        // agent's own life
        "/bin/sleep 300",
        "",
      ].join("\n"),
    )
    chmodSync(bin, 0o755)

    process.env.PATH = `${tmp}:${prevPath ?? ""}`
    delete process.env.AGENTIC_OS_JID
    process.env.AGENTIC_OS_ORCHESTRATOR = join(tmp, "orch-stub.mjs")

    const supervisor = await import("../../src/doors/ship-supervisor.ts").catch(() => null)
    if (!supervisor) return // BASE shape: no supervisor at all
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

    // wait for the watcher to finish its (counted) deadline
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
    if (existsSync(agentPidFile)) agentPid = Number(readFileSync(agentPidFile, "utf8").trim())

    const posted = existsSync(calls)
      ? readFileSync(calls, "utf8")
          .split("\n")
          .filter((l) => l.includes("pr comment 42"))
      : []
    assert.equal(
      posted.length,
      0,
      `a LIVE supervisor owns the receipt — the watcher's own backstop arm says "speak only over a DEAD agent that never posted", yet the TIMEOUT arm published ${posted.length} receipt(s) over a live agent:\n${posted.join("\n")}\n(two receipts for ONE commission: the watcher's timeout comment plus the supervisor's own, a few seconds later — and the watcher's DM claims "the watcher is the last word")`,
    )
  } finally {
    if (watcherPid) {
      try {
        process.kill(watcherPid, "SIGTERM")
      } catch {
        /* already gone */
      }
    }
    if (agentPid) {
      try {
        process.kill(agentPid, "SIGTERM")
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
