// Issue #152 slice 1 + #150 — stage-first workflows. [[stage]] tables
// are the chain (table order = execution order); each stage declares
// its own topology (solo | fan-out | coworker | gate) and its own
// hooks. The mcmc regression is the headline: a 3-stage chain where
// verify.sh fires ONCE in the final gate — never after the install
// unit mid-chain. "split" is dead: ordering is the workflow's job.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runOrchestrator, type ShepPort } from "../src/orchestrator.ts"
import { gradePlanFromStages, stepsFromStages, unitsFromStages, loadManifest, type Stage } from "../src/hooks.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-stages-"))
process.env.AGENTIC_OS_NOTIFY = "0"

test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

function fakeShep() {
  const spawned: string[] = []
  const port: ShepPort = {
    setLayout: () => {},
    spawnWorker: (name, _kind, _briefPath, cwd) => {
      spawned.push(name)
      const id = name.slice(2)
      writeFileSync(join(cwd, "result.md"), "READY\n")
      writeFileSync(join(cwd, "log.txt"), `done ${id}\n`)
      return true
    },
    paneAlive: () => true,
    retire: () => {},
    retireAll: () => {},
    verify: () => "pane-reap: 0 remaining",
    wake: () => {},
    tickPrivilege: () => ({ answered: new Set<string>(), capped: new Set<string>() }),
  }
  return { port, spawned }
}

function taskDir(name: string): string {
  const dir = join(process.env.AGENTIC_OS_HOME!, name)
  mkdirSync(join(dir, "hooks"), { recursive: true })
  return dir
}

const run = (dir: string, port: ShepPort) =>
  runOrchestrator({
    taskDir: dir,
    shep: port,
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    log: () => {},
  })

// ── the mcmc regression: verify fires once, in the final gate ──────
test("3-stage chain: install checks itself, pipeline task-grades, gate verifies ONCE at the end", async () => {
  const dir = taskDir("chain")
  writeFileSync(join(dir, "hooks", "install-check.sh"), "echo install >> order.log\necho passed\n")
  writeFileSync(join(dir, "hooks", "grade.sh"), "echo grade >> order.log\nexit 0\n")
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "chain"
worker_kind = "opencode"
slots = 1

[[stage]]
id = "install"
topology = "solo"
brief = "install rstan"
check = "bash hooks/install-check.sh"

[[stage]]
id = "pipeline"
topology = "solo"
brief = "run the full pipeline"

[[stage]]
id = "grade"
topology = "gate"
run = "bash hooks/grade.sh"
`,
  )
  const shep = fakeShep()
  const report = await run(dir, shep.port)
  assert.equal(report.status, "done")
  const byUnit = Object.fromEntries(report.table.map((r) => [r.unit, r.result]))
  assert.equal(byUnit.install, "stage check passed")
  assert.match(byUnit.pipeline, /ok/)
  assert.equal(byUnit.grade, "stage gate passed")
  // order: the install CHECK ran before the final GATE
  const order = readFileSync(join(dir, "order.log"), "utf8").trim().split("\n")
  assert.deepEqual(order, ["install", "grade"])
  // the task verifier never fired mid-chain (#150's card would live here)
  const cards = readFileSync(join(dir, "checkpoints.jsonl"), "utf8")
  assert.ok(!cards.includes("grade:install"), "no grade card for the install unit")
  assert.ok(cards.includes("check:install"), "the stage check has its own card")
  assert.ok(cards.includes("gate:grade"), "the final gate has its card")
  // every unit was a fresh worker (the split-is-dead invariant)
  assert.deepEqual(shep.spawned, ["w-install", "w-pipeline"])
})

// ── a failed mid-chain gate blocks downstream honestly ─────────────
test("mid-chain gate failure blocks the downstream stage as a row, never spawns it", async () => {
  const dir = taskDir("gatefail")
  writeFileSync(join(dir, "gate.sh"), "exit 1\n")
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "gatefail"
worker_kind = "opencode"

[[stage]]
id = "prepare"
topology = "solo"
brief = "prepare"

[[stage]]
id = "hold"
topology = "gate"
run = "bash gate.sh"

[[stage]]
id = "payload"
topology = "solo"
brief = "the payload"
`,
  )
  const shep = fakeShep()
  const report = await run(dir, shep.port)
  assert.equal(report.status, "failed")
  const byUnit = Object.fromEntries(report.table.map((r) => [r.unit, r.result]))
  assert.match(byUnit.hold, /stage gate failed/)
  assert.match(byUnit.payload, /wave blocked by failed hold/)
  assert.deepEqual(shep.spawned, ["w-prepare"]) // payload never spawned
})

// ── grade = false on the last stage: no task verifier anywhere ─────
test("last stage opts out of the task verifier and declares its own check", async () => {
  const dir = taskDir("optout")
  writeFileSync(join(dir, "final-check.sh"), "exit 0\n")
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "optout"
worker_kind = "opencode"

[[stage]]
id = "work"
topology = "solo"
brief = "do the work"

[[stage]]
id = "final"
topology = "solo"
brief = "finish"
grade = false
check = "bash final-check.sh"
`,
  )
  const report = await run(dir, fakeShep().port)
  assert.equal(report.status, "done")
  const byUnit = Object.fromEntries(report.table.map((r) => [r.unit, r.result]))
  assert.equal(byUnit.final, "stage check passed")
})

// ── fan-out stage: units share the wave, the chain still gates ──────
test("fan-out stage units ride one wave and gate the next stage", async () => {
  const dir = taskDir("fanout")
  writeFileSync(join(dir, "verify.sh"), "exit 0\n")
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "fanout"
worker_kind = "opencode"
slots = 2

[[stage]]
id = "shard-a"
topology = "fan-out"
units = [
  { id = "shard-one", brief = "first shard" },
  { id = "shard-two", brief = "second shard" },
]

[[stage]]
id = "merge"
topology = "solo"
brief = "merge the shards"

[[stage]]
id = "verify"
topology = "gate"
run = "bash verify.sh"
`,
  )
  const shep = fakeShep()
  const report = await run(dir, shep.port)
  assert.equal(report.status, "done")
  assert.deepEqual([...shep.spawned].sort(), ["w-merge", "w-shard-one", "w-shard-two"])
  // the fan-out units carry no task grade (the gate owns verification)
  const cards = readFileSync(join(dir, "checkpoints.jsonl"), "utf8")
  assert.ok(!cards.includes("grade:shard-one"))
})

// ── compilation units (pure functions) ─────────────────────────────
test("stages compile: units, per-unit steps sharing waves, grade plan defaults", () => {
  const stages: Stage[] = [
    { id: "a", topology: "solo", brief: "A" },
    { id: "fan", topology: "fan-out", units: [{ id: "f1", brief: "F1" }, { id: "f2", brief: "F2" }] },
    { id: "g", topology: "gate", run: "true" },
    { id: "z", topology: "solo", brief: "Z" },
  ]
  const units = unitsFromStages(stages)
  assert.deepEqual(units.map((u) => u.id), ["a", "f1", "f2", "z"])
  const steps = stepsFromStages(stages)
  assert.deepEqual(steps.map((s) => [s.id, s.wave]), [
    ["a", "stage-0"],
    ["f1", "stage-1"],
    ["f2", "stage-1"],
    ["g", "stage-2"],
    ["z", "stage-3"],
  ])
  const plan = gradePlanFromStages(stages)
  // last unit stage (z) takes the task verifier by default; earlier
  // stages without checks finish on the worker's word
  assert.deepEqual(plan.get("z"), { grade: "task" })
  assert.deepEqual(plan.get("a"), { grade: "none" })
  assert.deepEqual(plan.get("f1"), { grade: "none" })
})

// ── refusals: bad declarations fail the run, never vanish it ───────
test("stage declarations refuse honestly", async () => {
  const cases: Array<[string, string, RegExp]> = [
    [
      "coworker",
      `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "pair"
topology = "coworker"
`,
      /coworker stages land with the runner unification/,
    ],
    [
      "split",
      `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "chain"
topology = "split"
`,
      /"split" is dead/,
    ],
    [
      "fan-out without units",
      `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "fan"
topology = "fan-out"
`,
      /units must be a non-empty array/,
    ],
    [
      "units on a solo stage",
      `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "s"
topology = "solo"
brief = "b"
units = [{ id = "u", brief = "ub" }]
`,
      /units belong to fan-out stages/,
    ],
    [
      "brief on a fan-out stage",
      `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "fan"
topology = "fan-out"
brief = "shared preamble"
units = [{ id = "u", brief = "ub" }]
`,
      /units carry their own briefs/,
    ],
    [
      "run on a solo stage",
      `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "s"
topology = "solo"
brief = "b"
run = "true"
`,
      /run belongs to gate stages/,
    ],
    [
      "steps and stages both",
      `[workflow]
name = "x"
worker_kind = "opencode"

[[step]]
id = "s1"
finished_by = "end"
wave = "w1"

[[stage]]
id = "st"
topology = "solo"
brief = "b"
`,
      /not both/,
    ],
  ]
  for (const [name, toml, pattern] of cases) {
    const dir = taskDir(`refuse-${name}`)
    writeFileSync(join(dir, "workflow.toml"), toml)
    assert.throws(() => loadManifest(dir), pattern, name)
  }
})

// ── back-compat: no [[stage]], the units hook path is unchanged ────
test("a units-hook workflow (no stages) task-grades every unit, exactly as before", async () => {
  const dir = taskDir("backcompat")
  writeFileSync(
    join(dir, "units.sh"),
    `#!/bin/sh
echo '{"id":"u1","brief":"one"}'
echo '{"id":"u2","brief":"two"}'
`,
  )
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "backcompat"
worker_kind = "opencode"

[hooks]
units = "sh units.sh"
`,
  )
  const shep = fakeShep()
  const report = await run(dir, shep.port)
  assert.equal(report.status, "done")
  assert.deepEqual(shep.spawned.sort(), ["w-u1", "w-u2"])
  // the default grade (always-pass) fired for BOTH units — the old
  // contract, byte for byte
  const cards = readFileSync(join(dir, "checkpoints.jsonl"), "utf8")
  assert.ok(cards.includes("grade:u1") && cards.includes("grade:u2"))
})
