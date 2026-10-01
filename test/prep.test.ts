import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { compactedPi, traceContext, writeRunContext } from "../src/prep.ts"

test("compacted view keeps the summary and drops what it replaced", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-prep-"))
  const file = join(dir, "session.jsonl")
  const lines = [
    { type: "session", id: "s", timestamp: "t" },
    { type: "message", id: "m1", message: { role: "user", content: "use --noop" } },
    {
      type: "compaction",
      id: "c1",
      summary: "The flag is --dry-run. Do not touch billing.",
      firstKeptEntryId: "m2",
    },
    { type: "message", id: "m2", message: { role: "user", content: "also print the SQL" } },
  ]
  writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n")
  const view = compactedPi(file)
  assert.match(view, /--dry-run/)
  assert.match(view, /print the SQL/)
  assert.doesNotMatch(view, /--noop/)
})

test("trace context keeps failed units and earlier jobs", () => {
  const text = traceContext([
    { ts: "t", actor: "first_mate", kind: "job.born", task: "add --dry-run" },
    { ts: "t", actor: "orchestrator", kind: "unit.settled", unit: "flag", pass: false, result: "wrote --noop" },
  ])
  assert.match(text, /add --dry-run/)
  assert.match(text, /wrote --noop/)
  writeRunContext(mkdtempSync(join(tmpdir(), "agentic-os-ctx-")), text)
})
