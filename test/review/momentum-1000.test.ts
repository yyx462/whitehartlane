// momentum-1000 — the ship WATCHER retires while the commission is still
// running: the gone-world exit fires on the normal path.
//
// The watcher's own law (src/doors/ship-supervisor.ts, the wrapper the
// door writes):
//
//   # THE GONE-WORLD EXIT (the zombie-watcher receipt, 2026-10-30):
//   # a watcher whose staged dir was deleted (a test's tmp dir, a
//   # cancelled round) has NOTHING to watch and NOBODY to tell —
//   # exit quietly, never ride the deadline to a notify nobody wants
//   `  if [ ! -d "$OUT" ]; then exit 4; fi`
//
// …and the watcher's reason to exist (the same file, the module header):
//
//   // "pid N owns the review" is a claim about a LIVE process: an agent
//   // that dies at once (no auth, no model, a bad flag) left the PR
//   // unreviewed AND unreported … The watcher is the watch … so the
//   // commission is watched even when its agent is not.
//
// THE NORMAL PATH HAS NO $OUT YET. The --auto door (bin/whitehartlane,
// the --auto arm) NEVER pre-creates the --out dir — its own comment
// says so:
//
//   // the --out dir is NEVER pre-created (principles-1000, the P0):
//   // the door's replace-guard refuses an existing non-program dir
//   const out = val("out") ?? join(homeRoot(), "auto-reviews", `pr${pr}-…`)
//   const s = spawnSupervisor({ …, logPath: `${out}.supervisor.log`, outDir: out, … })
//
// spawnSupervisor creates only dirname(logPath) — the PARENT of out — and
// the watcher is handed OUT=out. The dir out is created LATER, by the
// levy the spawned AGENT runs (the agent reads the brief and runs
// `whl review … --out <out>`). An agent cannot start, read a brief and
// book a levy inside the watcher's first one-second poll.
//
// So the watcher's first loop iteration observes "[ ! -d $OUT ]" → true →
// exit 4 — the watch is gone in ~1s, on EVERY --auto run. The commission
// is then unwatched: the 2h timeout comment never fires, the notify never
// fires, and the BACKSTOP receipt (the watcher's "last word") never fires.
// The exact arc the watcher was built for — the agent dies at once (no
// auth, no model, a bad flag) — leaves PR #N silent forever, which is the
// hole momentum-905 was raised to close.
//
// The repro drives the real spawnSupervisor with a stub agent that
// materializes the program dir LATE (as the levy does) and then writes the
// merge seat, and asserts the watcher still speaks: the PR must hear the
// outcome even though the agent never posted (the backstop's job).
//
// BASE behaviour: src/doors/ship-supervisor.ts does not exist on BASE →
// the import is absent → this test cannot fail there; the feature is
// introduced by this diff.
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("the watcher outlives the agent: the PR hears the outcome even when the agent never posted", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom1000-"))
  const prevJid = process.env.AGENTIC_OS_JID
  const prevOrch = process.env.AGENTIC_OS_ORCHESTRATOR
  const prevPath = process.env.PATH
  let watcherPid: number | undefined
  try {
    // the --auto shape: the out dir is NOT pre-created (the door's law)
    const out = join(tmp, "auto-reviews", "pr42-2026-11-01T00-00-00")
    mkdirSync(join(tmp, "auto-reviews"), { recursive: true })

    // the gh stub: every call is recorded (this is the PR's only voice)
    const calls = join(tmp, "gh-calls.txt")
    const gh = join(tmp, "gh")
    writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\nexit 0\n`)
    chmodSync(gh, 0o755)

    // the agent stub: the levy INSIDE the agent materializes the program
    // dir (late — the door never pre-creates it) and then writes the
    // merge seat. It never posts a comment: the watcher's backstop is
    // the last word (momentum-908).
    const seat = join(out, "data", "review", "merge.json")
    const bin = join(tmp, "stub-opencode")
    writeFileSync(
      bin,
      [
        "#!/bin/sh",
        "sleep 3",
        `mkdir -p ${JSON.stringify(join(out, "data", "review"))}`,
        `printf '%s\\n' '{"outcome":"accept","head":"'$(printf 'c%.0s' $(seq 40))'"}' > ${JSON.stringify(seat)}`,
        "",
      ].join("\n"),
    )
    chmodSync(bin, 0o755)

    process.env.PATH = `${tmp}:${prevPath ?? ""}`
    // a scratch drive books nothing: the box-in-box guard is about REAL
    // workflows, and this drive spawns a stub
    delete process.env.AGENTIC_OS_JID
    process.env.AGENTIC_OS_ORCHESTRATOR = join(tmp, "orch-stub.mjs")

    const supervisor = await import("../../src/doors/ship-supervisor.ts").catch(() => null)
    if (!supervisor) return // BASE shape: no supervisor at all — this feature is introduced by the diff
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

    // the commission resolves: the agent's levy lands the merge seat
    let seated = false
    for (let i = 0; i < 60 && !seated; i++) {
      seated = existsSync(seat)
      if (!seated) await sleep(250)
    }
    assert.ok(seated, "the agent's levy must land the merge seat (the control)")

    // the watcher is the LAST WORD: the PR must hear the outcome
    let heard = ""
    for (let i = 0; i < 60 && !heard; i++) {
      if (existsSync(calls)) heard = readFileSync(calls, "utf8")
      if (!heard) await sleep(250)
    }
    assert.ok(
      heard.includes("pr comment 42"),
      `the PR never heard the outcome — the watcher quit before the commission started (its gone-world exit fired on the seat dir the levy creates LATER, so nothing watches the commission: no timeout comment, no notify, no backstop). gh calls: ${heard || "(none)"}`,
    )
  } finally {
    if (watcherPid) {
      try {
        process.kill(watcherPid, "SIGTERM")
      } catch {
        /* already gone */
      }
    }
    if (prevJid === undefined) delete process.env.AGENTIC_OS_JID
    else process.env.AGENTIC_OS_JID = prevJid
    if (prevOrch === undefined) delete process.env.AGENTIC_OS_ORCHESTRATOR
    else process.env.AGENTIC_OS_ORCHESTRATOR = prevOrch
    if (prevPath === undefined) delete process.env.PATH
    else process.env.PATH = prevPath
    rmSync(tmp, { recursive: true, force: true })
  }
})
