// tests-1 — WHL_FROM + `whl review --auto`: the traceable-parent arm
// must LEVY. bin/whitehartlane:431-436 states the contract: "A
// traceable parent (--from, or WHL_FROM exported by the calling agent)
// keeps the existing wake law — this process levies below and the
// session hears the finish." But `spawner` is captured at bin:347,
// BEFORE the late `args.push("--from", process.env.WHL_FROM)` at
// bin:441 — so the pushed --from is invisible to spawnerFromArgs, and
// the fall-through hits the materialize-only gate at bin:529
// (!spawner && !unattended && !gateAudit): receipt printed, exit 0,
// NO levy, NO wake. The commission the caller believes is in flight
// never runs.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const HEAD = join(import.meta.dirname, "..", "..")

function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  g("add -A")
  g("commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\nexport const waitFast = () => true\n")
  g("add -A")
  g("commit -qm feat")
  return where
}

// a jev stub printing the exact `jev run --json` answer shape
function jevStub(dir: string, noul: Record<string, number>): string {
  const answers: Record<string, { type: string; noul: number }> = {}
  for (const [k, v] of Object.entries(noul)) answers[`l_${k}`] = { type: "noul", noul: v }
  const p = join(dir, "jev-stub.sh")
  writeFileSync(p, `#!/bin/sh\necho '${JSON.stringify({ answers })}'\n`)
  chmodSync(p, 0o755)
  return p
}

test("auto flow with WHL_FROM: this process levies and wakes that session", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-auto-from-"))
  const home = join(tmp, "home")
  mkdirSync(home, { recursive: true })
  const repo = fixtureRepo(join(tmp, "repo"))
  const stub = jevStub(tmp, { principles: 0.9, tests: 0.2, momentum: 0.2, questions: 0.2 }) // gate: review
  // the orchestrator door seam: a stub that records it ran with the job dir
  // (the seam spawns it as NODE — a .mjs stub, never sh)
  const orch = join(tmp, "orch-door.mjs")
  const orchMarker = join(tmp, "orchestrator-ran.txt")
  writeFileSync(orch, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(orchMarker)}, process.argv.slice(2).join(' ') + '\\n')\n`)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENTIC_OS_HOME: home,
    WHL_GATE_LEDGER: join(home, "gate.jsonl"),
    AGENTIC_OS_NOTIFY: "0",
    WHL_JEV_BIN: stub,
    AGENTIC_OS_ORCHESTRATOR: orch,
    WHL_FROM: "opencode:ses-parent", // the calling agent exported its address
  }
  delete env.WHL_GATE
  delete env.WHL_SUPERVISOR_BIN
  delete env.NODE_OPTIONS
  try {
    const r = spawnSync(
      process.execPath,
      [join(HEAD, "bin", "whitehartlane"), "review", repo, "--base", "main", "--head", "feat", "--pr", "42", "--auto", "--model", "p/m", "--title", "t", "--out", join(tmp, "prog")],
      { env, encoding: "utf8", timeout: 60_000 },
    )
    // THE invariant: a traceable parent means THIS process levies (the
    // gate decided review above); the review must actually run. The
    // orchestrator stub is spawned DETACHED — poll for its marker the
    // way the brief-recording stubs do (a one-shot existsSync raced
    // the spawn and failed green runs)
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    let levied = existsSync(orchMarker)
    for (let i = 0; i < 60 && !levied; i++) {
      await sleep(50)
      levied = existsSync(orchMarker)
    }
    assert.ok(
      levied,
      `the auto flow with a traceable parent (WHL_FROM) must LEVY the review — bin promises "this process levies below and the session hears the finish", but no orchestrator ran (stdout: ${r.stdout.slice(0, 400)})`,
    )
    // and the wake goes to that session: the booked Job carries the parent as its spawner
    const jobs: string[] = []
    const sroot = join(home, "sessions")
    if (existsSync(sroot)) {
      for (const sid of readdirSync(sroot)) {
        const jdir = join(sroot, sid, "jobs")
        if (!existsSync(jdir)) continue
        for (const jid of readdirSync(jdir)) if (existsSync(join(jdir, jid, "job.json"))) jobs.push(join(jdir, jid, "job.json"))
      }
    }
    assert.ok(jobs.length > 0, "the levy must book a Job the parent session can be woken by")
    const spawners = jobs.map((p) => JSON.parse(readFileSync(p, "utf8")).spawner)
    assert.ok(
      spawners.some((s) => s?.session_id === "ses-parent"),
      `the booked Job must carry the WHL_FROM parent as its spawner (got ${JSON.stringify(spawners)}) — otherwise the finish wakes nobody`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
