// Issue #152 slice 1 + #150 — stage-first workflows. [[stage]] tables
// are the chain (table order = execution order); each stage declares
// its own topology (solo | fan-out | coworker | gate) and its own
// hooks. The mcmc regression is the headline: a 3-stage chain where
// verify.sh fires ONCE in the final gate — never after the install
// unit mid-chain. "split" is dead: ordering is the workflow's job.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { runOrchestrator, type ShepPort } from "../src/engines/orchestrator.ts"
import { readCheckpoints } from "../src/core/state.ts"
import { gradePlanFromStages, stepsFromStages, unitsFromStages, loadManifest, landMockUnit, modelPlanFromStages, type Stage } from "../src/doors/hooks.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-stages-"))
process.env.AGENTIC_OS_NOTIFY = "0"

test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

function fakeShep() {
  const spawned: string[] = []
  const models = new Map<string, string | undefined>()
  const port: ShepPort = {
    setLayout: () => {},
    spawnWorker: (name, _kind, _briefPath, cwd, model) => {
      spawned.push(name)
      models.set(name.slice(2), model)
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
  return { port, spawned, models }
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
  // — the ledger read goes through the seam: the cards ride the OS-disk
  // trace now (OPTIMUM §8), the task dir keeps no card file
  const cards = readCheckpoints(dir).map((c) => `${c.stage}:${c.status}`).join("\n")
  assert.ok(!cards.includes("grade:install"), "no grade card for the install unit")
  assert.ok(cards.includes("check:install:ok"), "the stage check has its own card")
  assert.ok(cards.includes("gate:grade:ok"), "the final gate has its card")
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
  const cards = readCheckpoints(dir).map((c) => c.stage).join("\n")
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
      "coworker with one member",
      `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "pair"
topology = "coworker"
members = [{ name = "alex", brief = "b", initiates = true }]
`,
      /at least two/,
    ],
    [
      "coworker with no initiator",
      `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "pair"
topology = "coworker"
members = [
  { name = "alex", brief = "b" },
  { name = "sam", brief = "b" },
]
`,
      /exactly one member must carry initiates/,
    ],
    [
      "members on a solo stage",
      `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "s"
topology = "solo"
brief = "b"
members = [{ name = "alex", brief = "b", initiates = true }]
`,
      /members belong to coworker stages/,
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
      "grade on a coworker stage",
      `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "pair"
topology = "coworker"
grade = true
members = [
  { name = "alex", brief = "b", initiates = true },
  { name = "sam", brief = "b" },
]
`,
      /grade does not apply — the task verifier binds to unit stages and gates/,
    ],
    [
      "signal on a solo stage",
      `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "s"
topology = "solo"
brief = "b"
signal = "true"
`,
      /signal\/end detectors belong to lab stages/,
    ],
    [
      "lab without a brief",
      `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "exp"
topology = "lab"
`,
      /stage exp brief/,
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
      "steps anywhere are retired (ADR 0014)",
      `[workflow]
name = "x"
worker_kind = "opencode"

[[step]]
id = "s1"
finished_by = "end"
wave = "w1"
`,
      /\[\[step\]\] tables are retired/,
    ],
  ]
  for (const [name, toml, pattern] of cases) {
    const dir = taskDir(`refuse-${name}`)
    writeFileSync(join(dir, "workflow.toml"), toml)
    assert.throws(() => loadManifest(dir), pattern, name)
  }
})

// ── coworker stages: delegation to a minted child program ─────────
test("a coworker stage needs a levy port — refused before any booking", async () => {
  const dir = taskDir("coworker-noport")
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "work"
topology = "solo"
brief = "w"

[[stage]]
id = "review"
topology = "coworker"
members = [
  { name = "alex", brief = "review as alex", initiates = true },
  { name = "sam", brief = "review as sam" },
]
`,
  )
  await assert.rejects(
    () => run(dir, fakeShep().port),
    /wake steps \(and coworker stages, which delegate to a child program\) need a levy port/,
  )
})

test("coworker stage mints its child program, levies it once, wakes advance the chain", async () => {
  const dir = taskDir("coworker-flow")
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "coworker-flow"
worker_kind = "opencode"
model = "zhipuai-coding-plan/glm-5.3-flash"

[[stage]]
id = "draft"
topology = "solo"
brief = "draft the thing"

[[stage]]
id = "review"
topology = "coworker"
members = [
  { name = "alex", brief = "review as alex", initiates = true },
  { name = "sam", brief = "review as sam", model = "zhipuai-coding-plan/glm-5.3" },
]

[[stage]]
id = "grade"
topology = "gate"
run = "true"
`,
  )
  const levies: Array<{ unitId: string; folder: string }> = []
  const levyChild = (unitId: string, folder: string) => {
    levies.push({ unitId, folder })
    const jobDir = join(dir, "child-jobs", unitId)
    mkdirSync(jobDir, { recursive: true })
    writeFileSync(
      join(jobDir, "job.json"),
      JSON.stringify({
        id: `j-${unitId}`,
        sid: "s-child",
        workflow: "coworker",
        task: unitId,
        dir: jobDir,
        state: "running",
        spawner: { tool: "rail", session_id: "s-parent", since: new Date().toISOString() },
      }),
    )
    // the child exchange completes immediately: its end-of-job wake
    writeFileSync(
      join(jobDir, "wake.json"),
      JSON.stringify({ outcome: "done", report: join(jobDir, "report.json"), at: new Date().toISOString() }),
    )
    return { ok: true as const, jid: `j-${unitId}`, jobDir, warnings: [] }
  }
  const shep = fakeShep()
  const report = await runOrchestrator({
    taskDir: dir,
    shep: shep.port,
    levyChild,
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    log: () => {},
  })
  assert.equal(report.status, "done")
  // the child program was minted from the stage's members
  const childToml = readFileSync(join(dir, "stages", "review", "workflow.toml"), "utf8")
  assert.match(childToml, /\[members\.alex\][\s\S]*initiates = true/)
  assert.match(childToml, /\[members\.sam\][\s\S]*model = "zhipuai-coding-plan\/glm-5\.3"/)
  assert.match(childToml, /model = "zhipuai-coding-plan\/glm-5\.3-flash"/) // inherited default
  assert.equal(
    readFileSync(join(dir, "stages", "review", "members", "sam.md"), "utf8"),
    "review as sam\n",
  )
  // levied exactly once, into the minted folder
  assert.deepEqual(levies, [{ unitId: "review", folder: join(dir, "stages", "review") }])
  // NO worker pane was born for the coworker stage — the members are
  // the child program's workers, not this rail's
  assert.deepEqual(shep.spawned, ["w-draft"])
  const byUnit = Object.fromEntries(report.table.map((r) => [r.unit, r.result]))
  assert.match(byUnit.review, /^child j-review done/)
})

// ── dry-run: worker_kind = "mock" births no agent ──────────────────
test("mock worker kind parses and the mock lands the done line itself", async () => {
  const dir = taskDir("mock")
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "mockrun"
worker_kind = "mock"

[[stage]]
id = "a"
topology = "solo"
brief = "anything"

[[stage]]
id = "grade"
topology = "gate"
run = "true"
`,
  )
  // loadManifest accepts the mock kind
  // (already implied by the run below; explicit for the matrix)
  const shep = fakeShep()
  const report = await run(dir, shep.port)
  assert.equal(report.status, "done")
  // the helper the REAL rail calls: brief in, done line + result out
  const briefPath = join(dir, "units", "a", "brief.md")
  mkdirSync(dirname(briefPath), { recursive: true })
  writeFileSync(briefPath, "b\n")
  const logPath = landMockUnit(briefPath, "w-a")
  assert.equal(logPath, join(dir, "units", "a", "log.txt"))
  assert.equal(readFileSync(logPath, "utf8"), "done a\n")
  assert.match(readFileSync(join(dir, "units", "a", "result.md"), "utf8"), /DRY-RUN/)
})

// ── lab stages: the actor experiment, delegated like coworker ─────
function autoWakeLevy(dir: string, outcome: string, levies: Array<{ unitId: string; folder: string }>) {
  return (unitId: string, folder: string) => {
    levies.push({ unitId, folder })
    const jobDir = join(dir, "child-jobs", unitId)
    mkdirSync(jobDir, { recursive: true })
    writeFileSync(
      join(jobDir, "job.json"),
      JSON.stringify({ id: `j-${unitId}`, dir: jobDir, state: "running", spawner: { tool: "rail" } }),
    )
    writeFileSync(
      join(jobDir, "wake.json"),
      JSON.stringify({ outcome, report: join(jobDir, "report.json"), at: new Date().toISOString() }),
    )
    return { ok: true as const, jid: `j-${unitId}`, jobDir, warnings: [] }
  }
}

test("lab stage mints a kind=lab child with actor.md + detectors, levied once", async () => {
  const dir = taskDir("lab-flow")
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "lab-flow"
worker_kind = "opencode"

[[stage]]
id = "explore"
topology = "lab"
brief = "find the signal in the noise"
end = "test -f found.md"

[[stage]]
id = "grade"
topology = "gate"
run = "true"
`,
  )
  const levies: Array<{ unitId: string; folder: string }> = []
  const shep = fakeShep()
  const report = await runOrchestrator({
    taskDir: dir,
    shep: shep.port,
    levyChild: autoWakeLevy(dir, "done", levies),
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    log: () => {},
  })
  assert.equal(report.status, "done")
  const childToml = readFileSync(join(dir, "stages", "explore", "workflow.toml"), "utf8")
  assert.match(childToml, /^kind = "lab"$/m)
  assert.match(childToml, /\[detectors\][\s\S]*end = "test -f found\.md"/)
  assert.equal(readFileSync(join(dir, "stages", "explore", "actor.md"), "utf8"), "find the signal in the noise\n")
  assert.deepEqual(levies.map((l) => l.unitId), ["explore"])
  assert.deepEqual(shep.spawned, []) // the actor is the child's, not ours
  const byUnit = Object.fromEntries(report.table.map((r) => [r.unit, r.result]))
  assert.match(byUnit.explore, /^child j-explore done/)
})

test("a coworker stage's check runs after the wake — green receipt, red check fails", async () => {
  const dir = taskDir("coworker-check")
  writeFileSync(join(dir, "check.sh"), "echo checked >> trail.log\nexit 1\n")
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "coworker-check"
worker_kind = "opencode"

[[stage]]
id = "review"
topology = "coworker"
check = "bash check.sh"
members = [
  { name = "alex", brief = "b", initiates = true },
  { name = "sam", brief = "b" },
]

[[stage]]
id = "payload"
topology = "solo"
brief = "after the exchange"
`,
  )
  const shep = fakeShep()
  const report = await runOrchestrator({
    taskDir: dir,
    shep: shep.port,
    levyChild: autoWakeLevy(dir, "done", []),
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    log: () => {},
  })
  assert.equal(report.status, "failed")
  const byUnit = Object.fromEntries(report.table.map((r) => [r.unit, r.result]))
  assert.match(byUnit.review, /stage check failed/)
  // the check actually RAN (the receipt was green; the check made it red)
  assert.equal(readFileSync(join(dir, "trail.log"), "utf8"), "checked\n")
  // downstream never spawned
  assert.deepEqual(shep.spawned, [])
})

// ── preamble: the roster's shared context, authored once ──────────
test("preamble prepends to every fan-out unit brief and every coworker member brief", async () => {
  const dir = taskDir("preamble")
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "preamble"
worker_kind = "opencode"
slots = 2

[[stage]]
id = "shards"
topology = "fan-out"
preamble = "SHARED: output one JSON object per line."
units = [
  { id = "one", brief = "shard one" },
  { id = "two", brief = "shard two" },
]

[[stage]]
id = "review"
topology = "coworker"
preamble = "We are building the orders API."
members = [
  { name = "alex", brief = "backend first", initiates = true },
  { name = "sam", brief = "frontend after" },
]

[[stage]]
id = "grade"
topology = "gate"
run = "true"
`,
  )
  const report = await runOrchestrator({
    taskDir: dir,
    shep: fakeShep().port,
    levyChild: autoWakeLevy(dir, "done", []),
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    log: () => {},
  })
  assert.equal(report.status, "done")
  // fan-out: every unit's effective brief carries the preamble
  const units = readFileSync(join(dir, "units.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { id: string; brief: string })
  assert.ok(units.every((u) => u.brief.startsWith("SHARED: output one JSON object per line.\n\n")))
  // coworker: every minted member file carries the preamble
  for (const name of ["alex", "sam"]) {
    assert.match(
      readFileSync(join(dir, "stages", "review", "members", `${name}.md`), "utf8"),
      /^We are building the orders API\.\n\n/,
    )
  }
})

test("preamble on a one-mind stage refuses", () => {
  const dir = taskDir("preamble-refuse")
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "s"
topology = "solo"
brief = "b"
preamble = "shared"
`,
  )
  assert.throws(() => loadManifest(dir), /preamble belongs to roster stages/)
})

// ── per-mind model pins: nearest declaration wins ─────────────────
test("fan-out units spawn with their own pins; solo carries its stage pin; nothing declared → undefined", async () => {
  const dir = taskDir("model-pins")
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "model-pins"
worker_kind = "opencode"
model = "prov/run-default"
slots = 2

[[stage]]
id = "prep"
topology = "solo"
model = "prov/solo-pin"
brief = "prepare"

[[stage]]
id = "shards"
topology = "fan-out"
model = "prov/stage-default"
units = [
  { id = "csv",     brief = "csv slice" },
  { id = "parquet", brief = "parquet slice", model = "prov/own-pin" },
]

[[stage]]
id = "plain"
topology = "solo"
brief = "no pin declared"

[[stage]]
id = "grade"
topology = "gate"
run = "true"
`,
  )
  const shep = fakeShep()
  const report = await runOrchestrator({
    taskDir: dir,
    shep: shep.port,
    gateCheckMs: 50,
    logPollMs: 50,
    stallMs: 60_000,
    briefGraceMs: 60_000,
    log: () => {},
  })
  assert.equal(report.status, "done")
  assert.equal(shep.models.get("prep"), "prov/solo-pin") // solo: stage pin
  assert.equal(shep.models.get("csv"), "prov/stage-default") // roster default
  assert.equal(shep.models.get("parquet"), "prov/own-pin") // own pin wins
  assert.equal(shep.models.get("plain"), undefined) // falls to the manifest pin
})

test("modelPlanFromStages compiles the nearest-declaration ladder", () => {
  const stages: Stage[] = [
    { id: "a", topology: "solo", brief: "A", model: "prov/a" },
    { id: "fan", topology: "fan-out", model: "prov/default", units: [
      { id: "f1", brief: "F1" },
      { id: "f2", brief: "F2", model: "prov/f2" },
    ] },
    { id: "nopin", topology: "solo", brief: "N" },
    { id: "g", topology: "gate", run: "true" },
  ]
  const pins = modelPlanFromStages(stages)
  assert.equal(pins.get("a"), "prov/a")
  assert.equal(pins.get("f1"), "prov/default")
  assert.equal(pins.get("f2"), "prov/f2")
  assert.ok(!pins.has("nopin"))
  assert.ok(!pins.has("g"))
})

test("model on a gate stage refuses: no mind, no pin", () => {
  const dir = taskDir("gate-model-refuse")
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "x"
worker_kind = "opencode"

[[stage]]
id = "g"
topology = "gate"
run = "true"
model = "prov/pin"
`,
  )
  assert.throws(() => loadManifest(dir), /no mind, no pin/)
})

// ── ADR 0014: the units-hook quick-mint is retired — refused, loudly ─
test("a units-hook workflow (no stages) is refused — no silent legacy path", async () => {
  const dir = taskDir("units-hook-retired")
  writeFileSync(join(dir, "units.sh"), "#!/bin/sh\necho '{}\n")
  writeFileSync(
    join(dir, "workflow.toml"),
    `[workflow]
name = "backcompat"
worker_kind = "opencode"

[hooks]
units = "sh units.sh"
`,
  )
  assert.throws(() => loadManifest(dir), /hooks\.units is retired/)
  const shep = fakeShep()
  await assert.rejects(() => run(dir, shep.port), /hooks\.units is retired/)
  assert.deepEqual(shep.spawned, [])
})
