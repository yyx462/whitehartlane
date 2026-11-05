import assert from "node:assert/strict"
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the unit ledger rides the OS-disk trace (OPTIMUM §8) — settles and
// state reads resolve a session there, so the suite needs its own disk
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-utok-"))

const { appendEvent, createJob, openSession } = await import("../src/adapters/store.ts")
const { jobTracePath, sumUnitTokens } = await import("../src/adapters/trace.ts")
const { hooksFromDir } = await import("../src/doors/hooks.ts")
import { cycle, type CycleDeps, type ShepPort } from "../src/engines/orchestrator.ts"

import { copyExample } from "./util.ts"

const sid = "s-utok"
openSession({ cwd: tmpdir() })

type Ev = { kind: string; payload: Record<string, unknown> }

// -- writer ≡ reader: appendEvent's unit.tokens rows fold back exactly -

test("sumUnitTokens: last row per unit wins, torn tail skipped, honest null", () => {
  const job = createJob({ sid, stoodUpBy: "standalone", workflow: "fan-out", task: "t1", runDir: true })
  // unit "principles" settles twice (fail, then its re-attempt passes):
  // the sample is cumulative — only the FINAL row is the unit's truth
  appendEvent(sid, { actor: "orchestrator", jid: job.id, kind: "unit.tokens", unit: "principles", input: 100_000, output: 10_000, cacheRead: 1_000_000, cost: 0, sessions: 2 })
  appendEvent(sid, { actor: "orchestrator", jid: job.id, kind: "unit.tokens", unit: "principles", input: 160_000, output: 12_000, cacheRead: 1_400_000, cost: 0, sessions: 3 })
  appendEvent(sid, { actor: "orchestrator", jid: job.id, kind: "unit.tokens", unit: "tests", input: 150_000, output: 17_000, cacheRead: 1_100_000, cost: 0, sessions: 1 })
  // a torn final line (crash mid-append) — skipped, never folded
  const file = jobTracePath(sid, job.id)
  appendFileSync(file, `99\t123\t\torchestrator\tunit.tokens`)

  const sum = sumUnitTokens(file)!
  assert.equal(sum.units, 2, "two distinct units folded")
  assert.equal(sum.input, 310_000, "principles counts its LAST row only (160k) + tests (150k)")
  assert.equal(sum.output, 29_000)
  assert.equal(sum.cacheRead, 2_500_000)

  // a run with no unit.tokens rows (pre-economics, worktree mode, or a
  // host that keeps none) folds to null — never a fake zero
  const quiet = createJob({ sid, stoodUpBy: "standalone", workflow: "fan-out", task: "t2", runDir: true })
  appendEvent(sid, { actor: "orchestrator", jid: quiet.id, kind: "unit.finished", unit: "solo", pass: true, result: "ok" })
  assert.equal(sumUnitTokens(jobTracePath(sid, quiet.id)), null, "no rows → null")
  assert.equal(sumUnitTokens(join(tmpdir(), "no-such-file.tsv")), null, "no file → null")
})

// -- the emitter: cycle samples usage at finish, or stays silent -------

function fakeShep(status: () => "working" | "idle" | "blocked" | "unknown") {
  const retired: string[] = []
  const port: ShepPort = {
    setLayout: () => {},
    spawnWorker: () => true,
    paneAlive: () => true,
    workerStatus: status,
    reprompt: () => true,
    retire: (name) => retired.push(name),
    retireAll: () => {},
    verify: () => "pane-reap: 0 remaining",
    wake: () => {},
    tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
  }
  return { port, retired }
}

function deps(dir: string, port: ShepPort, extra: Partial<CycleDeps> = {}): CycleDeps & { events: Ev[] } {
  const events: Ev[] = []
  return {
    taskDir: dir,
    hooks: hooksFromDir(dir).hooks,
    shep: port,
    inFlight: new Map(),
    attempts: new Map(),
    slots: 3,
    emit: (kind, payload) => events.push({ kind, payload }),
    events,
    ...extra,
  }
}

async function settledDirWithUsage(
  usage: (() => { input: number; output: number; cacheRead: number; cost: number; sessions: number } | null) | undefined,
  extra: Partial<CycleDeps> = {},
): Promise<Ev[]> {
  const dir = await copyExample("whl-utok-task-")
  writeFileSync(join(dir, "units.jsonl"), `${JSON.stringify({ id: "demo", brief: "Produce the deliverable named in the closing contract." })}\n`)
  let phase: "working" | "idle" = "working"
  const shep = fakeShep(() => phase)
  const d = deps(dir, shep.port, { settleMode: "status-first", fallbackLadder: false, ...extra })
  if (usage) (d as CycleDeps & { usageOf?: unknown }).usageOf = (_id: string, since: number) => {
    if (since !== 0) throw new Error("usage must be sampled cumulative (since=0)")
    return usage()
  }
  cycle(d)
  phase = "idle"
  writeFileSync(join(dir, "units", "demo", "result.md"), "Paris\n")
  cycle(d)
  return d.events
}

test("finish samples the unit's usage once, cumulative, as unit.tokens", async () => {
  const events = await settledDirWithUsage(() => ({ input: 590_000, output: 55_000, cacheRead: 15_400_000, cost: 0, sessions: 1 }))
  const rows = events.filter((e) => e.kind === "unit.tokens")
  assert.equal(rows.length, 1, "exactly one row per finish")
  assert.equal(rows[0].payload.unit, "demo")
  assert.equal(rows[0].payload.input, 590_000)
  assert.equal(rows[0].payload.cacheRead, 15_400_000)
  assert.ok(events.some((e) => e.kind === "unit.finished"), "the settle itself still fired")
})

test("a host with no usage row (or no seam) emits NOTHING — never a fake zero", async () => {
  const nullHost = await settledDirWithUsage(() => null)
  assert.ok(!nullHost.some((e) => e.kind === "unit.tokens"), "null host → no row")
  const noSeam = await settledDirWithUsage(undefined)
  assert.ok(!noSeam.some((e) => e.kind === "unit.tokens"), "no seam → no row")
})

test("worktree mode is exempt: the shared cwd would re-count the run per unit", async () => {
  const events = await settledDirWithUsage(() => ({ input: 1, output: 1, cacheRead: 1, cost: 0, sessions: 1 }), { worktree: "/tmp/some-worktree" })
  assert.ok(!events.some((e) => e.kind === "unit.tokens"), "worktree run → no per-unit row")
})
