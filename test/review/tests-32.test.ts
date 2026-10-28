import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

// the unit ledger rides the OS-disk trace — settles resolve a session
// there, so this repro points AGENTIC_OS_HOME at its own temp disk
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-tests32-"))

import { listJobs } from "../../src/adapters/store.ts"
import { hooksFromDir } from "../../src/doors/hooks.ts"
import { stageRun } from "../../src/doors/run.ts"
import { cycle, type CycleDeps, type ShepPort } from "../../src/engines/orchestrator.ts"
import { readState } from "../../src/core/state.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const FIXTURE = join(import.meta.dirname, "..", "..", "test", "fixtures", "three-lookups")

function port() {
  const spawned: string[] = []
  const p: ShepPort = {
    setLayout: () => {},
    spawnWorker: (name) => {
      spawned.push(name)
      return true
    },
    paneAlive: () => true,
    workerStatus: () => "unknown",
    reprompt: () => true,
    retire: () => {},
    retireAll: () => {},
    verify: () => "pane-reap: 0 remaining",
    wake: () => {},
    tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
  }
  return { port: p, spawned }
}

function depsFor(dir: string, shep: ShepPort): CycleDeps {
  return {
    taskDir: dir,
    hooks: hooksFromDir(dir).hooks,
    shep,
    inFlight: new Map(),
    attempts: new Map(),
    slots: 3,
    log: () => {},
  }
}

// QUESTIONS.md #5 (break each new call: where does the error land) /
// INV-4 (an infra failure is never reported as an answer — the door
// answers, it does not crash): the diff's re-levy fold (src/doors/run.ts
// copyBeside, reached via stageRun:123 ← book():469) copies the prior
// run's done unit dirs with cpSync and checkpoints them — with NO error
// handling anywhere on the path. A prior whose done unit dir cannot be
// READ (permission fault, dying disk, torn checkout) makes cpSync throw
// hard enough to kill the caller outright — no {ok:false, why, code}
// refusal is formed — AND the Job record for the new booking was ALREADY
// written (run.ts:460 createJob precedes run.ts:469 stage), so the crash
// strands a state:"running", pid-less phantom booking that vetoes every
// re-levy for the booking grace and hands the operator a native abort
// where every other door fault gets a why and a fix.
//
// The re-levy runs in a child process so THIS assertion survives to
// speak. On BASE there is no fold: nothing reads the prior run's unit
// dirs, the second booking answers normally, and the scenario cannot
// arise — the fault is introduced by this change.
test("the fold's mid-failure is a door answer, never a native abort beside a phantom booking", () => {
  const source = mkdtempSync(join(tmpdir(), "whl-t32-src-"))
  cpSync(FIXTURE, source, { recursive: true })
  let prior = ""
  let childOut = ""
  let childStatus: number | null = 0
  try {
    // ── run 1: a prior booking of the SAME program dir, one unit done
    prior = join(process.env.AGENTIC_OS_HOME!, "sessions", "s-t32", "jobs", "j-t32", "run")
    stageRun(source, prior)
    const one = port()
    const d1 = depsFor(prior, one.port)
    cycle(d1)
    appendFileSync(join(prior, "units", "france", "log.txt"), "done france\n")
    writeFileSync(join(prior, "units", "france", "result.md"), "Paris\n")
    cycle(d1)
    assert.ok(
      readState(prior).done.includes("france"),
      "sanity: france settled done in run 1's ledger",
    )

    // ── the mid-failure shape: the prior's done unit dir becomes
    // unreadable (the disk/permission fault mid-recovery)
    chmodSync(join(prior, "units", "france"), 0o000)

    // ── the re-levy, in a child so the abort cannot take this
    // assertion with it
    const child = join(process.env.AGENTIC_OS_HOME!, "relevy.mjs")
    writeFileSync(
      child,
      [
        `import { prepareRun } from ${JSON.stringify(join(ROOT, "src", "doors", "run.ts"))}`,
        `const r = prepareRun(process.argv[2])`,
        `console.log("RESULT:" + JSON.stringify({ ok: r.ok, why: r.ok ? "" : (r.why ?? "") }))`,
        ``,
      ].join("\n"),
    )
    const run = spawnSync(process.execPath, ["--experimental-strip-types", child, source], {
      encoding: "utf8",
      timeout: 120_000,
    })
    childStatus = run.status
    childOut = `${run.stdout ?? ""}${run.stderr ?? ""}`

    const phantom = listJobs().find((j) => j.state === "running")
    assert.equal(
      childStatus,
      0,
      `INV-4 (an infra failure is never reported as an answer — here it is not even a JS throw, it kills the process): ` +
        `the re-levy fold (run.ts copyBeside, run.ts:233-237) cpSync's the prior run's done unit dirs with no error ` +
        `handling, so a re-levy whose prior unit dir is unreadable exits with status ${String(childStatus)} — ` +
        `no {ok:false, why, code} refusal is formed (child output: ${JSON.stringify(childOut.trim().split("\n").slice(-3).join(" | "))}) — ` +
        `and the booking's Job record was already written (run.ts:460 createJob precedes run.ts:469 stage), ` +
        `stranding ${phantom ? `a state:"running" pid-less phantom booking ${phantom.id} that vetoes every re-levy for the booking grace` : "no record (unexpected)"} — ` +
        `the operator gets a native abort where every other door fault gets a why and a fix. ` +
        `On BASE the fold does not exist: nothing reads the prior's unit dirs and this scenario cannot arise.`,
    )
    if (childStatus === 0) {
      const m = childOut.match(/RESULT:(\{.*\})/)
      const result = m ? JSON.parse(m[1]) as { ok: boolean; why: string } : undefined
      assert.ok(result, "sanity: the child printed a door answer")
      if (result && !result.ok) {
        assert.match(
          result.why,
          /fold|prior|unit/i,
          "if the door refuses, the refusal must name the fold/prior problem — the fix the message prescribes must be passable",
        )
      }
    }
  } finally {
    try {
      chmodSync(join(prior, "units", "france"), 0o755)
    } catch { /* already gone or never restricted */ }
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(source, { recursive: true, force: true })
  }
})
