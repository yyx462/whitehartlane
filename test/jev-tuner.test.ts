import assert from "node:assert/strict"
import test from "node:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendCases,
  gatesRoot,
  listGates,
  loadCandidates,
  loadCases,
  readWinner,
  runGate,
  type TunerCase,
} from "../src/jev-tuner.ts"
import { initCases, parseSeedCases } from "../src/jev-tuner-init.ts"
import { loadPrompt } from "../src/jev-prompts.ts"

const repoGates = gatesRoot() // captured before the env points elsewhere

test("the repo's gates each hold at least 50 valid cases and 2 candidates", () => {
  const prev = process.env.AGENTIC_OS_TUNER_GATES
  process.env.AGENTIC_OS_TUNER_GATES = repoGates
  try {
    const gates = listGates()
    assert.deepEqual(gates.map((g) => g.id).sort(), ["grill-enough", "permission-needed", "workflow-choice"])
    for (const g of gates) {
      const cases = loadCases(g.id)
      assert.ok(cases.length >= g.min_cases, `${g.id}: ${cases.length} cases < min ${g.min_cases}`)
      const labeled = new Set(cases.map((c) => c.expected))
      assert.ok(labeled.has(g.positive) && labeled.has(g.negative), `${g.id}: cases must carry both labels`)
      const candidates = loadCandidates(g.id, g.kind)
      assert.ok(candidates.length >= 2, `${g.id}: needs at least 2 candidates`)
    }
  } finally {
    process.env.AGENTIC_OS_TUNER_GATES = prev ?? gatesTmp
  }
})

const gatesTmp = mkdtempSync(join(tmpdir(), "aos-tuner-"))
const promptsTmp = mkdtempSync(join(tmpdir(), "aos-tuner-p-"))

function writeGate(id: string, cfg: Record<string, unknown>, cases: TunerCase[], candidates: Record<string, string>): void {
  mkdirSync(join(gatesTmp, id, "prompts"), { recursive: true })
  writeFileSync(join(gatesTmp, id, "gate.json"), JSON.stringify(cfg))
  writeFileSync(join(gatesTmp, id, "cases.jsonl"), cases.map((c) => JSON.stringify(c)).join("\n") + "\n")
  for (const [name, body] of Object.entries(candidates)) {
    writeFileSync(join(gatesTmp, id, "prompts", name), body)
  }
}

process.env.AGENTIC_OS_TUNER_GATES = gatesTmp
process.env.AGENTIC_OS_JEV_PROMPTS_DIR = promptsTmp

const demoCases: TunerCase[] = [
  { id: "d1", input: { task: "NEEDED read the vista shots for the visual harness" }, expected: "allow" },
  { id: "d2", input: { task: "NEEDED check the notify config has a chat id" }, expected: "allow" },
  { id: "d3", input: { task: "refactor the auth module only" }, expected: "deny-unneeded" },
  { id: "d4", input: { task: "fix the css overflow bug only" }, expected: "deny-unneeded" },
]

writeGate(
  "demo",
  { id: "demo", kind: "noul", min_cases: 4, margin: 0.1, positive: "allow", negative: "deny-unneeded", state: "task", describes: "test gate", input_fields: { task: "task text" } },
  demoCases,
  { "v1-always.txt": "always-yes", "v2-marker.txt": "marker" },
)

const fakeNoul = async (question: string, state: string): Promise<number> => {
  if (question === "always-yes") return 0.9
  return state.includes("NEEDED") ? 0.95 : 0.05
}

test("runGate scores candidates, and the winner lands in production automatically", async () => {
  const report = await runGate("demo", { askers: { noul: fakeNoul }, jobs: 2 })
  assert.equal(report.cases, 4)
  const byName = Object.fromEntries(report.candidates.map((c) => [c.name, c]))
  assert.equal(byName["v1-always"].accuracy, 0.5)
  assert.deepEqual(byName["v1-always"].misses, ["d3", "d4"])
  assert.equal(byName["v2-marker"].accuracy, 1)
  assert.equal(report.winner?.name, "v2-marker")
  assert.equal(report.landed, true)
  assert.equal(loadPrompt("demo" as never), "marker")
  const winner = readWinner("demo")
  assert.equal(winner?.name, "v2-marker")
  assert.equal(winner?.accuracy, 1)
})

test("a second run against the same winner does not land again (margin)", async () => {
  const report = await runGate("demo", { askers: { noul: fakeNoul }, jobs: 2 })
  assert.equal(report.landed, false)
  assert.match(report.why_not ?? "", /land bar/)
})

test("under min_cases, nothing lands even at perfect accuracy", async () => {
  writeGate(
    "sparse",
    { id: "sparse", kind: "noul", min_cases: 10, margin: 0.1, positive: "allow", negative: "deny-unneeded", state: "task", describes: "test gate", input_fields: { task: "task" } },
    demoCases.slice(0, 2),
    { "v1.txt": "always-yes" },
  )
  const report = await runGate("sparse", { askers: { noul: fakeNoul }, jobs: 1 })
  assert.equal(report.landed, false)
  assert.match(report.why_not ?? "", /min 10/)
})

test("choice gates score by picked option and land options with the prompt", async () => {
  writeGate(
    "demo-choice",
    { id: "demo-choice", kind: "choice", min_cases: 4, margin: 0.1, positive: "fan-out", negative: "direct", state: "task", describes: "test gate", input_fields: { task: "task" } },
    [
      { id: "c1", input: { task: "PAR fetch five prices" }, expected: "fan-out" },
      { id: "c2", input: { task: "PAR check eight links" }, expected: "fan-out" },
      { id: "c3", input: { task: "fix the failing test" }, expected: "direct" },
      { id: "c4", input: { task: "refactor the module" }, expected: "direct" },
    ],
    { "v1.json": JSON.stringify({ question: "parallel?", options: { "fan-out": "units apart", direct: "one thread" } }) },
  )
  const report = await runGate("demo-choice", {
    askers: {
      choice: async (_q, _o, state) => ({
        choice: state.includes("PAR") ? "fan-out" : "direct",
        p: 0.9,
        confidence: 0.9,
      }),
    },
    jobs: 2,
  })
  assert.equal(report.candidates[0].accuracy, 1)
  assert.equal(report.landed, true)
  const winner = readWinner("demo-choice")
  assert.deepEqual(winner?.options, { "fan-out": "units apart", direct: "one thread" })
})

test("appendCases dedups by id", () => {
  const added = appendCases("demo", [
    { id: "d1", input: { task: "dup" }, expected: "allow" },
    { id: "d5", input: { task: "NEEDED new case" }, expected: "allow" },
  ])
  assert.equal(added, 1)
  assert.equal(loadCases("demo").length, 5)
})

test("loadCases rejects a case outside the gate's labels", () => {
  writeGate(
    "bad",
    { id: "bad", kind: "noul", min_cases: 1, margin: 0.1, positive: "allow", negative: "deny-unneeded", state: "task", describes: "t", input_fields: { task: "t" } },
    [{ id: "b1", input: { task: "x" }, expected: "maybe" }],
    { "v1.txt": "q" },
  )
  assert.throws(() => loadCases("bad"), /expected must be allow\|deny-unneeded/)
})

test("parseSeedCases takes fenced JSON and drops malformed rows", () => {
  const cfg = { id: "demo", kind: "noul" as const, positive: "allow", negative: "deny-unneeded" }
  const parsed = parseSeedCases(
    '```json\n[{"input":{"task":"a"},"expected":"allow"},{"input":{"task":"b"},"expected":"maybe"},{"expected":"allow"}]\n```',
    cfg as never,
  )
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].expected, "allow")
  assert.match(parsed[0].id, /^demo-llm-/)
})

test("initCases posts to the chat endpoint and returns validated cases", async () => {
  const cfg = { id: "demo", kind: "noul" as const, positive: "allow", negative: "deny-unneeded", describes: "d", input_fields: { task: "t" } }
  let sawUrl = ""
  let sawAuth = ""
  const cases = await initCases(cfg as never, [], {
    n: 2,
    apiKey: "k",
    baseUrl: "http://seed.test",
    fetchImpl: (async (url: string | URL, init?: RequestInit) => {
      sawUrl = String(url)
      sawAuth = String(init?.headers && (init.headers as Record<string, string>)["Authorization"])
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '[{"input":{"task":"NEEDED x"},"expected":"allow"}]' } }] }),
      } as never
    }) as never,
  })
  assert.ok(sawUrl.startsWith("http://seed.test/chat/completions"))
  assert.equal(sawAuth, "Bearer k")
  assert.equal(cases.length, 1)
  assert.equal(cases[0].expected, "allow")
})

test("initCases without a key says so, never guesses", async () => {
  delete process.env.AIHUBMIX_API_KEY
  const before = { ...process.env }
  process.env.HOME = gatesTmp // no env files there
  try {
    await assert.rejects(
      initCases({ id: "demo", kind: "noul", positive: "allow", negative: "deny-unneeded" } as never, [], { n: 2 }),
      /AIHUBMIX_API_KEY/,
    )
  } finally {
    process.env.HOME = before.HOME
  }
})

test("the results report lands in the gate's results dir", async () => {
  const report = await runGate("demo", { askers: { noul: fakeNoul }, jobs: 1, now: () => "2026-10-08T00:00:00.000Z" })
  const written = readFileSync(join(gatesRoot(), "demo", "results", "2026-10-08T00-00-00-000Z.json"), "utf8")
  assert.equal(JSON.parse(written).gate, report.gate)
})
