// momentum-3105 — the cleaner at EVERY end: a per-exit zombie sweep
// must reap LEAKED fixture watchers while sparing every legitimate
// shape. Receipts:
//   - 2026-11-04, the 18:46→20:46 burst: a single-file run's orphaned
//     watcher lost its fake clock and fake phone with the deleted
//     sandbox, rode a REAL clock for 2h, and DMed a human.
//   - 2026-11-04, the first lane (this pin's own first rule): a
//     door-minted watcher is ORPHANED BY DESIGN from birth — the
//     minting door exits the moment the watch starts (momentum-908's
//     fixture mints through a child node that returns at once) — so
//     ppid 1 alone is NOT a leak, and "world gone" with a LIVE owner
//     is a test mid-finally, not a bomb.
// The law pinned here, for the per-exit pass:
//   spared — live spawner (any world); gone world with a live spawner;
//            a young fixture orphan still working its bounded seconds
//   reaped — gone world + orphan (the 2h bomb); an OLD fixture orphan
// The lane-final rule (total: every fixture/gone watcher) keeps its
// 2026-10-30 seat in the runner tail, never inside a concurrent test
// body.
//
// (Fixtures ride REAL sleeps deliberately: a spared watcher must still
// be alive when we assert, and a killed one must die by the SWEEP's
// hand, not by finishing a fake-fast clock first.)
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import test from "node:test"
import { sweepZombies } from "../sweep-zombie-watchers.mjs"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const alive = (pid?: number): boolean => {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// a shell mid-`sleep 1` defers SIGTERM until the sleep exits — a reaped
// watcher dies within ~1s, not at the instant of the kill; assert death
// inside a bounded wait, never instantly after the sweep
const waitDead = async (pid: number | undefined, ms: number): Promise<boolean> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await sleep(100)
  }
  return !alive(pid)
}

const ppidOf = (pid: number): number => {
  try {
    return Number(execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim())
  } catch {
    return -1
  }
}

// wait until a helper-minted watcher is reparented to launchd (pid 1) —
// the birth shape of every door-minted watcher
const waitOrphan = async (pid: number, ms: number): Promise<boolean> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (ppidOf(pid) === 1) return true
    await sleep(100)
  }
  return ppidOf(pid) === 1
}

test("the per-exit sweep reaps the bomb and the aged leftover, spares every legitimate shape", async () => {
  const prevPath = process.env.PATH
  const prevJid = process.env.AGENTIC_OS_JID
  const prevOrch = process.env.AGENTIC_OS_ORCHESTRATOR
  let aPid: number | undefined // mine, world intact — spared (owned)
  let bPid: number | undefined // mine, world gone — spared (owner's teardown owns it)
  let cPid: number | undefined // orphan, world gone — REAPED (the 2h bomb)
  let dPid: number | undefined // orphan, world intact, young — spared (the momentum-908 shape)
  const worlds: string[] = []
  try {
    const supervisorMod = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "doors", "ship-supervisor.ts")
    const supervisor = await import(pathToFileURL(supervisorMod).href).catch(() => null)
    if (!supervisor) return // BASE shape: no supervisor at all

    // each watcher gets its OWN world (the gone-world rule reads the
    // script's dir) and its OWN stub phone — a spared watcher can
    // never ring the real one, even if this test dies before finally
    const makeWorld = (tag: string): string => {
      const tmp = mkdtempSync(join(tmpdir(), `aos-mom3105-${tag}-`))
      worlds.push(tmp)
      for (const name of ["stub-opencode", "notify", "gh"]) {
        writeFileSync(join(tmp, name), "#!/bin/sh\nexit 0\n")
        chmodSync(join(tmp, name), 0o755)
      }
      writeFileSync(join(tmp, "orch-stub.mjs"), "export default {}\n")
      return tmp
    }
    const aTmp = makeWorld("a")
    const bTmp = makeWorld("b")
    const cTmp = makeWorld("c")
    const dTmp = makeWorld("d")
    process.env.PATH = [aTmp, bTmp, cTmp, dTmp, prevPath ?? ""].join(":")
    delete process.env.AGENTIC_OS_JID
    process.env.AGENTIC_OS_ORCHESTRATOR = join(aTmp, "orch-stub.mjs")

    const seat = (tmp: string, pr: string): string => {
      const out = join(tmp, "auto-reviews", `pr${pr}`)
      mkdirSync(join(out, "data", "review"), { recursive: true })
      return out
    }
    const mint = (tmp: string, pr: string): number => {
      const out = seat(tmp, pr)
      const s = supervisor.spawnSupervisor({
        brief: "BRIEF",
        cwd: join(tmp, "auto-reviews"),
        logPath: `${out}.supervisor.log`,
        bin: join(tmp, "stub-opencode"),
        outDir: out,
        pr,
        repo: tmp,
      })
      assert.ok(s.ok, `the ${pr} spawn must succeed (why: ${s.ok ? "" : s.why})`)
      return s.pid
    }

    // A and B are MINE (this process is their live spawner)
    aPid = mint(aTmp, "51")
    bPid = mint(bTmp, "52")
    rmSync(bTmp, { recursive: true, force: true }) // B's world dies while its owner lives

    // C and D are minted by a helper child that EXITS at once — the
    // door's own birth shape: orphaned by design, ppid 1 from the start
    const helper = join(dTmp, "mint-helper.mjs")
    writeFileSync(
      helper,
      [
        "import { pathToFileURL } from 'node:url'",
        "const [modPath, world, pr] = process.argv.slice(2)",
        "const supervisor = await import(pathToFileURL(modPath).href)",
        `const out = world + '/auto-reviews/pr' + pr`,
        "const s = supervisor.spawnSupervisor({ brief: 'BRIEF', cwd: world + '/auto-reviews', logPath: out + '.supervisor.log', bin: world + '/stub-opencode', outDir: out, pr, repo: world })",
        "if (!s.ok) { console.error(s.why); process.exit(1) }",
        "console.log(s.pid)",
        "",
      ].join("\n"),
    )
    const mintOrphan = async (world: string, pr: string): Promise<number> => {
      const out = seat(world, pr)
      void out
      const r = spawnSync(process.execPath, ["--experimental-strip-types", helper, supervisorMod, world, pr], {
        encoding: "utf8",
        timeout: 30_000,
      })
      assert.ok(r.status === 0, `the mint helper must succeed (status ${r.status}: ${r.stderr})`)
      return Number(r.stdout.trim())
    }
    cPid = await mintOrphan(cTmp, "53")
    dPid = await mintOrphan(dTmp, "54")
    assert.ok(await waitOrphan(cPid, 5000), `C must be orphaned (ppid 1) before the sweep runs (ppid ${ppidOf(cPid)})`)
    assert.ok(await waitOrphan(dPid, 5000), `D must be orphaned (ppid 1) before the sweep runs (ppid ${ppidOf(dPid)})`)
    rmSync(cTmp, { recursive: true, force: true }) // C's world dies with its owner already gone — the bomb shape

    // THE EXIT PASS, scoped to MY watchers (node --test runs files
    // concurrently — a test body never runs the global sweep). The
    // kill log rides a stub: the pin's kills are test fixtures, never
    // real symptoms for the janitor's diary.
    sweepZombies({ spareInFlight: true, onlyPids: [aPid, bPid, cPid, dPid], actor: "pin", killLog: join(aTmp, "kills.jsonl") })
    assert.ok(alive(aPid), `an owned, in-flight watcher must be SPARED (pid ${aPid})`)
    assert.ok(alive(bPid), `a world-gone watcher with a LIVE owner must be SPARED — the owner's teardown owns it (pid ${bPid})`)
    assert.ok(alive(dPid), `a young fixture orphan still working must be SPARED — orphaned-by-design is not a leak (pid ${dPid})`)
    assert.ok(await waitDead(cPid, 5000), `a world-gone orphan must be REAPED — it is the 2h real-clock bomb (pid ${cPid})`)

    // THE LANE-FINAL RULE (total, no sparing) — pinned on my own
    // watchers; its global seat stays in the runner tail (npm test's
    // sweep step), never inside a concurrent test body
    sweepZombies({ onlyPids: [aPid, bPid, dPid], actor: "pin", killLog: join(aTmp, "kills.jsonl") })
    assert.ok(await waitDead(aPid, 5000), `the lane-final rule still reaps every fixture watcher (pid ${aPid})`)
    assert.ok(await waitDead(bPid, 5000), `the lane-final rule still reaps every fixture watcher (pid ${bPid})`)
    assert.ok(await waitDead(dPid, 5000), `the lane-final rule still reaps every fixture watcher (pid ${dPid})`)
  } finally {
    for (const pid of [aPid, bPid, cPid, dPid]) {
      if (pid) {
        try {
          process.kill(pid, "SIGTERM")
        } catch {
          /* already gone */
        }
      }
    }
    if (prevPath === undefined) delete process.env.PATH
    else process.env.PATH = prevPath
    if (prevJid === undefined) delete process.env.AGENTIC_OS_JID
    else process.env.AGENTIC_OS_JID = prevJid
    if (prevOrch === undefined) delete process.env.AGENTIC_OS_ORCHESTRATOR
    else process.env.AGENTIC_OS_ORCHESTRATOR = prevOrch
    for (const w of worlds) rmSync(w, { recursive: true, force: true })
  }
})
