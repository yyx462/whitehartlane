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
} from "../src/hooks.ts"
import { RefusedError } from "../src/backpressure.ts"

const EXAMPLE = join(import.meta.dirname, "fixtures", "three-lookups")

async function copyExample(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agentic-os-hooks-"))
  cpSync(EXAMPLE, dir, { recursive: true })
  return dir
}

test("the manifest names the workflow, worker kind, and hook commands", () => {
  const manifest = loadManifest(EXAMPLE)
  assert.equal(manifest.workflow.name, "three-lookups")
  assert.equal(manifest.workflow.worker_kind, "opencode")
  // ADR 0014: the units-hook quick-mint is retired — the workers are
  // the stages; grade and counts remain the program's own hooks
  assert.equal(manifest.hooks.units, undefined)
  assert.equal(manifest.stages?.length, 1)
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

test("workflow.canary is program policy — boolean, absent means the door default", async () => {
  const dir = await copyExample()
  const toml = join(dir, "workflow.toml")
  writeFileSync(toml, readFileSync(toml, "utf8").replace('slots = 2\n', 'slots = 2\ncanary = false\n'))
  assert.equal(loadManifest(dir).workflow.canary, false)
  writeFileSync(toml, readFileSync(toml, "utf8").replace('canary = false\n', 'canary = true\n'))
  assert.equal(loadManifest(dir).workflow.canary, true)
  writeFileSync(toml, readFileSync(toml, "utf8").replace('canary = true\n', ''))
  assert.equal(loadManifest(dir).workflow.canary, undefined)
  writeFileSync(toml, readFileSync(toml, "utf8").replace('slots = 2\n', 'slots = 2\ncanary = "no"\n'))
  assert.throws(() => loadManifest(dir), /workflow.canary must be true or false/)
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

test("the workers are the stages — hooksFromDir derives units, a stage-less manifest refuses (ADR 0014)", async () => {
  const { hooks } = hooksFromDir(EXAMPLE)
  const units = hooks.units()
  assert.deepEqual(
    units.map((unit) => unit.id),
    ["france", "japan", "peru"],
  )
  assert.ok(units.every((unit) => unit.brief.length > 0))
  const dir = await copyExample()
  writeFileSync(
    join(dir, "workflow.toml"),
    readFileSync(join(dir, "workflow.toml"), "utf8").replace(/\n\[\[stage\]\][\s\S]*$/, "\n"),
  )
  assert.throws(() => hooksFromDir(dir).hooks.units(), /\[\[stage\]\] entries/)
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

test("a hook that outlives the ceiling dies as a HookError, whatever shape Node kills it in (j-5701b2)", async () => {
  const dir = await copyExample()
  const toml = join(dir, "workflow.toml")
  // the unit id is appended to the command — comment it out so sleep runs
  writeFileSync(toml, readFileSync(toml, "utf8").replace(/grade = "[^"]*"/, 'grade = "sleep 5 #"'))
  const manifest = loadManifest(dir)
  process.env.AGENTIC_OS_HOOK_TIMEOUT_MS = "1000"
  try {
    assert.throws(() => runGrade(dir, manifest, { id: "france", brief: "" }), /timed out after 1000ms/)
  } finally {
    delete process.env.AGENTIC_OS_HOOK_TIMEOUT_MS
  }
})

test("counts summarizes the finished table", async () => {
  const dir = await copyExample()
  const manifest = loadManifest(dir)
  const counts = runCounts(dir, manifest, [
    { unit: "france", result: "found", pass: true },
    { unit: "japan", result: "missing", pass: false },
  ])
  assert.deepEqual(counts, { lookups: 2, failed: 1 })
})

test("the finished table lands in table.json for the counts hook", async () => {
  const dir = await copyExample()
  const manifest = loadManifest(dir)
  runCounts(dir, manifest, [{ unit: "france", result: "found", pass: true }])
  const table = JSON.parse(readFileSync(join(dir, "table.json"), "utf8"))
  assert.deepEqual(table, [{ unit: "france", result: "found", pass: true }])
})

test("hooks are optional — omitted counts uses the built-in counter, omitted grade always passes (issue #120)", async () => {
  const dir = await copyExample()
  const toml = join(dir, "workflow.toml")
  // strip the whole [hooks] table
  writeFileSync(toml, readFileSync(toml, "utf8").replace(/\[hooks\][\s\S]*?(?=\n\[|$)/, ""))
  const manifest = loadManifest(dir)
  assert.equal(manifest.hooks.counts, undefined)
  assert.equal(manifest.hooks.grade, undefined)
  assert.equal(manifest.hooks.units, undefined)
  assert.deepEqual(
    runCounts(dir, manifest, [
      { unit: "france", result: "found", pass: true },
      { unit: "japan", result: "missing", pass: false },
    ]),
    { units: 2, passed: 1, failed: 1 },
  )
  assert.deepEqual(runGrade(dir, manifest, { id: "france", brief: "" }), { pass: true, row: "ok" })
  // the workers survive the strip — they are the stages, never a hook
  assert.equal(hooksFromDir(dir).hooks.units().length, 3)
})

test("hooksFromDir binds the manifest into the Hooks shape", async () => {
  const dir = await copyExample()
  const { hooks, manifest } = hooksFromDir(dir)
  assert.equal(hooks.workerKind, "opencode")
  assert.equal(manifest.workflow.name, "three-lookups")
  assert.equal(hooks.units().length, 3)
  assert.equal(hooks.grade({ id: "france", brief: "" }).pass, false)
  assert.deepEqual(hooks.counts([{ unit: "france", result: "found", pass: true }]), {
    lookups: 1,
    failed: 0,
  })
})

test("counts = \"default\" is the explicit spelling of the built-in counter (issue #120)", async () => {
  const dir = await copyExample()
  const toml = join(dir, "workflow.toml")
  writeFileSync(toml, readFileSync(toml, "utf8").replace(/counts = "[^"]*"/, 'counts = "default"'))
  const manifest = loadManifest(dir)
  assert.equal(manifest.hooks.counts, "default")
  assert.deepEqual(runCounts(dir, manifest, [{ unit: "france", result: "found", pass: true }]), {
    units: 1,
    passed: 1,
    failed: 0,
  })
})

test('counts = "true" is refused at load — it prints nothing and aborts the run at report time (j-64e035, issue #120)', async () => {
  const dir = await copyExample()
  const toml = join(dir, "workflow.toml")
  writeFileSync(toml, readFileSync(toml, "utf8").replace(/counts = "[^"]*"/, 'counts = "true"'))
  assert.throws(() => loadManifest(dir), /counts = "true" prints nothing.*issue #120, j-64e035/s)
})

test("the manifest resolution chain prefers local, then env, then user, then builtin", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "resolve-cwd-"))

  // nothing anywhere except the builtin
  const emptyHome = mkdtempSync(join(tmpdir(), "resolve-home-"))
  assert.equal(resolveManifestPath(cwd, { HOME: emptyHome })?.origin, "builtin")

  // user-global beats builtin (ADR 0011: the global manifest lives in
  // ~/.config/whitehartlane/)
  const userHome = mkdtempSync(join(tmpdir(), "resolve-userhome-"))
  mkdirSync(join(userHome, ".config", "whitehartlane"), { recursive: true })
  const userToml = join(userHome, ".config", "whitehartlane", "workflow.toml")
  writeFileSync(userToml, "# user override\n")
  assert.equal(resolveManifestPath(cwd, { HOME: userHome })?.path, userToml)

  // a legacy ~/.config/agentic-os/workflow.toml is still honored (ADR 0011)
  const legacyHome = mkdtempSync(join(tmpdir(), "resolve-legacy-"))
  mkdirSync(join(legacyHome, ".config", "agentic-os"), { recursive: true })
  const legacyToml = join(legacyHome, ".config", "agentic-os", "workflow.toml")
  writeFileSync(legacyToml, "# legacy override\n")
  assert.equal(resolveManifestPath(cwd, { HOME: legacyHome })?.path, legacyToml)

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
