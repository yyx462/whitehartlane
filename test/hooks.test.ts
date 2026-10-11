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
  runEndDetector,
  runGateDetector,
  runGrade,
  runSignalDetector,
  runUnits,
} from "../src/hooks.ts"
import { RefusedError } from "../src/backpressure.ts"

const EXAMPLE = join(import.meta.dirname, "..", "examples", "fan-out-spurs", "three-lookups")

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

test("a legacy dag_id key still resolves the spur_id, loudly (ADR 0009)", async () => {
  const dir = await copyExample()
  const toml = join(dir, "workflow.toml")
  // legacy-only: dag_id resolves to spur_id with a loud warning
  writeFileSync(toml, readFileSync(toml, "utf8").replace('name = "three-lookups"\n', 'name = "three-lookups"\ndag_id = "legacy-id"\n'))
  const warnings: string[] = []
  const manifest = loadManifest(dir, (m) => warnings.push(m))
  assert.equal(manifest.workflow.spur_id, "legacy-id")
  assert.deepEqual(warnings, ["legacy dag_id in workflow.toml — rename to spur_id"])
  // both keys: spur_id wins, no warning — nothing new is written in the old spelling
  writeFileSync(toml, readFileSync(toml, "utf8").replace('dag_id = "legacy-id"\n', 'dag_id = "legacy-id"\nspur_id = "new-id"\n'))
  const both: string[] = []
  assert.equal(loadManifest(dir, (m) => both.push(m)).workflow.spur_id, "new-id")
  assert.deepEqual(both, [])
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

test("counts summarizes the finished table", async () => {
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

test("the finished table lands in table.json for the counts hook", async () => {
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

function detectorDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-detectors-"))
  mkdirSync(join(dir, "hooks"))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      "[workflow]",
      'name = "detected"',
      'worker_kind = "opencode"',
      "",
      "[hooks]",
      'units = "node hooks/true.mjs"',
      'grade = "node hooks/true.mjs"',
      'counts = "node hooks/true.mjs"',
      "",
      "[detectors]",
      'signal = "node hooks/signal.mjs"',
      'end = "node hooks/end.mjs"',
      "",
      "[gates]",
      "await-review = \"node hooks/gate.mjs\"",
      "",
    ].join("\n"),
  )
  writeFileSync(join(dir, "hooks", "true.mjs"), "process.exit(0)\n")
  writeFileSync(join(dir, "hooks", "signal.mjs"), "process.stdout.write(process.env.DETECT_OUT ?? '')\nprocess.exit(Number(process.env.DETECT_STATUS ?? 0))\n")
  writeFileSync(join(dir, "hooks", "end.mjs"), "console.log(process.env.DETECT_OUT ?? '')\nprocess.exit(Number(process.env.DETECT_STATUS ?? 0))\n")
  writeFileSync(join(dir, "hooks", "gate.mjs"), "console.log(process.env.DETECT_OUT ?? '')\nprocess.exit(Number(process.env.DETECT_STATUS ?? 0))\n")
  return dir
}

function detectEnv(out: string, status = 0): Record<string, string> {
  return { DETECT_OUT: out, DETECT_STATUS: String(status) }
}

function detect<T>(env: Record<string, string>, fn: () => T): T | Error {
  const old = process.env
  process.env = { ...process.env, ...env }
  try {
    return fn()
  } catch (err) {
    return err as Error
  } finally {
    process.env = old
  }
}

test("the manifest names detectors and gates, or neither", () => {
  const manifest = loadManifest(detectorDir())
  assert.equal(manifest.detectors?.signal, "node hooks/signal.mjs")
  assert.equal(manifest.detectors?.end, "node hooks/end.mjs")
  assert.deepEqual(manifest.gates, { "await-review": "node hooks/gate.mjs" })
  assert.equal(loadManifest(EXAMPLE).detectors, undefined)
  assert.equal(loadManifest(EXAMPLE).gates, undefined)
})

test("a signal detector prints the wave or the stop, like protocol.json would", () => {
  const dir = detectorDir()
  const manifest = loadManifest(dir)
  const kind = (env: Record<string, string>): string =>
    (detect(env, () => runSignalDetector(dir, manifest)) as { kind: string }).kind
  assert.equal(kind(detectEnv("")), "missing")
  assert.equal(kind(detectEnv(JSON.stringify({ units: [{ id: "u1", brief: "go" }] }))), "wave")
  assert.equal(kind(detectEnv(JSON.stringify({ stop: true }))), "stop")
  assert.equal(kind(detectEnv("{not json")), "partial")
})

test("refusal from any detector is a RefusedError the rail can retry", () => {
  const dir = detectorDir()
  const manifest = loadManifest(dir)
  assert.ok(detect(detectEnv("", 75), () => runSignalDetector(dir, manifest)) instanceof RefusedError)
  assert.ok(detect(detectEnv("", 75), () => runEndDetector(dir, manifest, "u1")) instanceof RefusedError)
  assert.ok(detect(detectEnv("", 75), () => runGateDetector(dir, manifest, "await-review")) instanceof RefusedError)
})

test("an end detector prints done, blocked, dead, or nothing", () => {
  const dir = detectorDir()
  const manifest = loadManifest(dir)
  assert.equal(detect(detectEnv("done"), () => runEndDetector(dir, manifest, "u1")), "done")
  assert.equal(detect(detectEnv("blocked"), () => runEndDetector(dir, manifest, "u1")), "blocked")
  assert.equal(detect(detectEnv(""), () => runEndDetector(dir, manifest, "u1")), null)
  assert.ok(detect(detectEnv("banana"), () => runEndDetector(dir, manifest, "u1")) instanceof HookError)
})

test("a gate detector is ready only when it prints done", () => {
  const dir = detectorDir()
  const manifest = loadManifest(dir)
  assert.equal(detect(detectEnv("done"), () => runGateDetector(dir, manifest, "await-review")), true)
  assert.equal(detect(detectEnv(""), () => runGateDetector(dir, manifest, "await-review")), false)
  assert.equal(detect(detectEnv("pending"), () => runGateDetector(dir, manifest, "await-review")), false)
  assert.ok(detect({}, () => runGateDetector(dir, manifest, "unknown-gate")) instanceof HookError)
})
