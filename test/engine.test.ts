import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { engineFor, programRootsOf, stagedKind } from "../src/engine.ts"
import type { Rail } from "../src/rail.ts"
import type { Report } from "../src/report.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "./util.ts"

const dirOf = (toml?: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "engine-"))
  if (toml !== undefined) writeFileSync(join(dir, "workflow.toml"), toml)
  return dir
}

test("stagedKind: the staged program names its shape; missing = fan-out; garbage refuses", () => {
  assert.equal(stagedKind(dirOf('kind = "coworker"\n')), "coworker")
  assert.equal(stagedKind(dirOf('kind = "lab"\n')), "lab")
  assert.equal(stagedKind(dirOf("live = true\n")), "lab")
  assert.equal(stagedKind(dirOf()), "fan-out")
  assert.throws(() => stagedKind(dirOf('kind = "swarm"\n')), /swarm/)
})

test("programRootsOf: roots.txt rides along, hard-deny roots never do", () => {
  const dir = dirOf()
  assert.deepEqual(programRootsOf(dir), [])
  writeFileSync(join(dir, "roots.txt"), ["/tmp/some-root", "/Users/x/.ssh/id_rsa", ""].join("\n"))
  assert.deepEqual(programRootsOf(dir), ["/tmp/some-root"])
})

test("engineFor: one dispatch — the shape picks the engine, in process", async () => {
  const report: Report = { status: "done", rows: [], counts: { units: 0, failed: 0 } } as never
  const seen: string[] = []
  const deps = {
    runCoworker: (rail: Rail) => {
      seen.push(`coworker:${rail.taskDir !== ""}`)
      return Promise.resolve(report)
    },
    runLab: (rail: Rail) => {
      seen.push(`lab:${rail.taskDir !== ""}`)
      return Promise.resolve(report)
    },
    runFanOut: (() => Promise.resolve(report)) as never,
  }
  const rail = fakeRail(dirOf(), fakeHerdr(), null)
  assert.equal(await engineFor(rail, "coworker", "/x", deps)(), report)
  assert.equal(await engineFor(rail, "lab", "/x", deps)(), report)
  assert.deepEqual(seen, ["coworker:true", "lab:true"])
})

test("fanOutEngine: the moved wiring — levy port only with a ledger, manifest deadline, env canary", async () => {
  const toml = ["[workflow]", 'name = "w"', "deadline_ms = 900000", ""].join("\n")
  let got: Record<string, unknown> | null = null
  const deps = {
    runFanOut: ((input: never) => {
      got = input
      return Promise.resolve(null)
    }) as never,
  }
  // no ledger → no levy port (the rail cannot spawn child jobs)
  const bare = fakeRail(dirOf(toml), fakeHerdr(), null)
  await engineFor(bare, "fan-out", "/x", deps)()
  assert.equal(got!.levyChild, undefined)
  assert.equal((got!.deadlineMs as number), 900000)
  assert.equal(got!.existingRows, undefined)
  // a ledger → the levy port exists; env canary wins over the manifest
  const booked = fakeRail(dirOf(toml), fakeHerdr(), fakeLedger() as never)
  process.env.AGENTIC_OS_CANARY = "0"
  try {
    await engineFor(booked, "fan-out", "/door-root", deps)()
  } finally {
    delete process.env.AGENTIC_OS_CANARY
  }
  assert.equal(typeof got!.levyChild, "function")
  assert.equal(got!.canary, false)
  assert.equal((got!.taskDir as string), booked.taskDir)
  assert.deepEqual(got!.existingRows, [])
})
