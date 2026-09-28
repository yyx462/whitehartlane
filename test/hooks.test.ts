import assert from "node:assert/strict"
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  HookError,
  hooksFromDir,
  loadManifest,
  runCounts,
  runGrade,
  runUnits,
} from "../src/hooks.ts"

const EXAMPLE = join(import.meta.dirname, "..", "examples", "three-lookups")

async function copyExample(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agentic-os-hooks-"))
  cpSync(EXAMPLE, dir, { recursive: true })
  return dir
}

test("the manifest names the workflow, worker kind, and hook commands", () => {
  const manifest = loadManifest(EXAMPLE)
  assert.equal(manifest.workflow.name, "three-lookups")
  assert.equal(manifest.workflow.worker_kind, "opencode")
  assert.equal(manifest.hooks.units, "bash hooks/units.sh")
  assert.equal(manifest.hooks.grade, "bash hooks/grade.sh")
  assert.equal(manifest.hooks.counts, "bash hooks/counts.sh")
  assert.equal(manifest.report?.where, "results/")
})

test("a task directory without workflow.toml is a clean error", async () => {
  const empty = await mkdtemp(join(tmpdir(), "agentic-os-empty-"))
  assert.throws(() => loadManifest(empty), HookError)
})

test("units prints one JSONL unit each, with its own brief", () => {
  const manifest = loadManifest(EXAMPLE)
  const units = runUnits(EXAMPLE, manifest)
  assert.deepEqual(
    units.map((unit) => unit.id),
    ["france", "japan", "peru"],
  )
  assert.ok(units.every((unit) => unit.brief.length > 0))
})

test("a unit id that is not shep-safe is rejected", async () => {
  const dir = await copyExample()
  writeFileSync(
    join(dir, "hooks", "units.sh"),
    "#!/usr/bin/env bash\necho '{\"id\":\"Bad/Id\",\"brief\":\"x\"}'\n",
  )
  const manifest = loadManifest(dir)
  assert.throws(() => runUnits(dir, manifest), HookError)
})

test("grade passes when the worker artifact exists and fails when it does not", async () => {
  const dir = await copyExample()
  const manifest = loadManifest(dir)
  mkdirSync(join(dir, "results"), { recursive: true })
  writeFileSync(join(dir, "results", "france.txt"), "Paris\n")

  assert.deepEqual(runGrade(dir, manifest, { id: "france", brief: "" }), {
    pass: true,
    row: "found",
  })
  assert.deepEqual(runGrade(dir, manifest, { id: "japan", brief: "" }), {
    pass: false,
    row: "missing",
  })
})

test("counts summarizes the settled table", async () => {
  const dir = await copyExample()
  const manifest = loadManifest(dir)
  const counts = runCounts(dir, manifest, [
    { unit: "france", result: "found" },
    { unit: "japan", result: "missing" },
  ])
  assert.deepEqual(counts, { lookups: 2, failed: 1 })
})

test("hooksFromDir binds the manifest into the Hooks shape", async () => {
  const dir = await copyExample()
  mkdirSync(join(dir, "results"), { recursive: true })
  const { hooks, manifest } = hooksFromDir(dir)
  assert.equal(hooks.workerKind, "opencode")
  assert.equal(manifest.workflow.name, "three-lookups")
  assert.equal(hooks.units().length, 3)
  assert.equal(hooks.grade({ id: "france", brief: "" }).pass, false)
  assert.deepEqual(hooks.counts([{ unit: "france", result: "found" }]), {
    lookups: 1,
    failed: 0,
  })
})

test("the settled table lands in results/table.json for the counts hook", async () => {
  const dir = await copyExample()
  const manifest = loadManifest(dir)
  runCounts(dir, manifest, [{ unit: "france", result: "found" }])
  const table = JSON.parse(readFileSync(join(dir, "results", "table.json"), "utf8"))
  assert.deepEqual(table, [{ unit: "france", result: "found" }])
})
