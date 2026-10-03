import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  HookError,
  hooksFromDir,
  loadManifest,
  resolveManifestPath,
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
  assert.equal(manifest.report?.where, "units/")
})

test("workflow.model is provider/model or absent", async () => {
  const dir = await copyExample()
  const toml = join(dir, "workflow.toml")
  writeFileSync(toml, readFileSync(toml, "utf8").replace('slots = 2\n', 'slots = 2\nmodel = "xai/grok-4.7"\n'))
  assert.equal(loadManifest(dir).workflow.model, "xai/grok-4.7")
  writeFileSync(toml, readFileSync(toml, "utf8").replace('model = "xai/grok-4.7"\n', 'model = "grok"\n'))
  assert.throws(() => loadManifest(dir), /provider\/model/)
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
  mkdirSync(join(dir, "units", "france"), { recursive: true })
  writeFileSync(join(dir, "units", "france", "result.md"), "Paris\n")

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

test("the settled table lands in table.json for the counts hook", async () => {
  const dir = await copyExample()
  const manifest = loadManifest(dir)
  runCounts(dir, manifest, [{ unit: "france", result: "found" }])
  const table = JSON.parse(readFileSync(join(dir, "table.json"), "utf8"))
  assert.deepEqual(table, [{ unit: "france", result: "found" }])
})

test("the manifest resolution chain prefers local, then env, then user, then builtin", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "resolve-cwd-"))

  // nothing anywhere except the builtin
  const emptyHome = mkdtempSync(join(tmpdir(), "resolve-home-"))
  assert.equal(resolveManifestPath(cwd, { HOME: emptyHome })?.origin, "builtin")

  // user-global beats builtin
  const userHome = mkdtempSync(join(tmpdir(), "resolve-userhome-"))
  mkdirSync(join(userHome, ".config", "agentic-os"), { recursive: true })
  const userToml = join(userHome, ".config", "agentic-os", "workflow.toml")
  writeFileSync(userToml, "# user override\n")
  assert.equal(resolveManifestPath(cwd, { HOME: userHome })?.path, userToml)

  // env beats user-global
  const envToml = join(mkdtempSync(join(tmpdir(), "resolve-env-")), "workflow.toml")
  writeFileSync(envToml, "# env override\n")
  assert.equal(
    resolveManifestPath(cwd, { HOME: userHome, AGENTIC_OS_WORKFLOW: envToml })?.origin,
    "env",
  )

  // local beats everything
  writeFileSync(join(cwd, "workflow.toml"), "# local\n")
  assert.equal(
    resolveManifestPath(cwd, { HOME: userHome, AGENTIC_OS_WORKFLOW: envToml })?.origin,
    "local",
  )

  // the global chain can be disabled entirely (a local manifest still wins)
  const bare = mkdtempSync(join(tmpdir(), "resolve-bare-"))
  assert.equal(
    resolveManifestPath(bare, { HOME: userHome, AGENTIC_OS_GLOBAL: "0" }),
    null,
  )
  assert.equal(
    resolveManifestPath(cwd, { HOME: userHome, AGENTIC_OS_GLOBAL: "0" })?.origin,
    "local",
  )
})
