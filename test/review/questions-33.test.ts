// questions-33 (questions lens, Q5/Q6) — THE WATCHER DIES BEFORE THE
// COMMISSION STARTS: the gone-world exit fires on the NORMAL --auto
// path, so the PR is never heard.
//
// The change adds a watcher (src/doors/ship-supervisor.ts:126-151)
// whose loop is:
//
//   `while [ ! -f "$OUT/data/review/merge.json" ]; do`,
//   `  sleep 1; i=$((i+1))`,
//   `  if [ ! -d "$OUT" ]; then exit 4; fi`,
//   `  if [ -f "$OUT/data/review/verdict.json" ] && ! kill -0 "$AGENT" 2>/dev/null; then break; fi`,
//   `  if [ "$i" -ge 7200 ]; then … timeout comment + notify … exit 3; fi`,
//   `done`,
//
// The gone-world exit is meant for a watcher whose staged dir was
// DELETED (the change's own words, ship-supervisor.ts:136-139):
//
//   // THE GONE-WORLD EXIT (the zombie-watcher receipt, 2026-10-30):
//   // a watcher whose staged dir was deleted (a test's tmp dir, a
//   // cancelled round) has NOTHING to watch and NOBODY to tell —
//   // exit quietly, never ride the deadline to a notify nobody wants
//
// But on the NORMAL --auto path the staged dir does not exist YET —
// the --auto door never pre-creates it (bin/whitehartlane:519-523):
//
//   // the --out dir is NEVER pre-created (principles-1000, the P0):
//   // the door's replace-guard refuses an existing non-program dir,
//   // and the supervisor's log must live BESIDE the run dir — an
//   // in-dir log made every parentless auto review dead on arrival
//   const out = val("out") ?? join(homeRoot(), "auto-reviews", `pr${pr}-…`)
//
// and spawnSupervisor creates only the PARENT of the log path
// (ship-supervisor.ts:93: mkdirSync(dirname(opts.logPath)) — the log
// path is `${out}.supervisor.log`, so its dirname is `out`'s PARENT).
// The dir `out` itself is created LATER, by the levy the spawned AGENT
// runs (the brief tells the agent to run `whl review … --out <out>`).
//
// The watcher's first poll is one second in. An agent cannot boot,
// read its brief, and materialize a program dir inside one second —
// so `[ ! -d "$OUT" ]` is TRUE and the watcher exits 4 at once.
//
// THE HARM (the module header, ship-supervisor.ts:1036-1041):
//
//   // "pid N owns the review" is a claim about a LIVE process: an
//   // agent that dies at once (no auth, no model, a bad flag) left the
//   // PR unreviewed AND unreported … The watcher is the watch … so
//   // the commission is watched even when its agent is not.
//
// A watcher that is dead before the commission starts watches
// nothing: the 2h timeout comment never fires, the notify never
// fires, and the BACKSTOP receipt (the watcher's "last word") never
// fires. The PR goes silent forever — the exact hole momentum-905
// was raised to close, reopened by this diff's gone-world exit.
//
// The repro drives the REAL spawnSupervisor with a stub agent that
// materializes the staged dir LATE (as the levy does) and then lands
// the merge seat, and asserts the PR still hears the outcome.
//
// BASE behaviour: src/doors/ship-supervisor.ts does not exist on BASE
// (the whole supervisor is introduced by this diff) → the import is
// absent → this test cannot fail there.
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const HEAD = join(import.meta.dirname, "..", "..")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("the watcher outlives the normal --auto start: the PR hears the outcome even though the agent never posted", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-q33-"))
  let watcherPid: number | undefined
  const prevPath = process.env.PATH
  const prevJid = process.env.AGENTIC_OS_JID
  try {
    // the --auto shape: `out` is NEVER pre-created; the agent's levy
    // creates it later (bin/whitehartlane:519-523).
    const out = join(tmp, "auto-reviews", "pr42-2026-11-01T00-00-00")
    const calls = join(tmp, "gh-calls.txt")
    const gh = join(tmp, "gh")
    writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\nexit 0\n`)
    chmodSync(gh, 0o755)

    // the agent: boots (sleeps), then materializes the staged dir LATE
    // and lands the merge seat. It never posts a comment — the
    // watcher's backstop is the last word (the module's promise).
    const seat = join(out, "data", "review", "merge.json")
    const bin = join(tmp, "stub-opencode")
    writeFileSync(
      bin,
      [
        "#!/bin/sh",
        "sleep 3",
        `mkdir -p ${JSON.stringify(join(out, "data", "review"))}`,
        `printf '%s\\n' '{"outcome":"accept"}' > ${JSON.stringify(seat)}`,
        "",
      ].join("\n"),
    )
    chmodSync(bin, 0o755)

    process.env.PATH = `${tmp}:${prevPath ?? ""}`
    // a scratch drive books nothing: the box-in-box guard is about REAL
    // workflows, and this drive spawns a stub
    delete process.env.AGENTIC_OS_JID

    const supervisor = await import(join(HEAD, "src", "doors", "ship-supervisor.ts")).catch(() => null)
    if (!supervisor) return // BASE shape: no supervisor at all — introduced by this diff

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
      `the PR never heard the outcome — the watcher quit before the commission started (its gone-world exit fired on the seat dir the levy creates LATER, so nothing watches the commission: no timeout comment, no notify, no backstop).\n` +
        `gh calls: ${heard || "(none)"}`,
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
    if (prevPath === undefined) delete process.env.PATH
    else process.env.PATH = prevPath
    rmSync(tmp, { recursive: true, force: true })
  }
})
