import assert from "node:assert/strict"
import test from "node:test"
import { formatGate, promoteFindings } from "../src/doors/promote.ts"
import type { JobRecord } from "../src/adapters/store.ts"

function job(over: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "j-1",
    sid: "s-1",
    stoodUpBy: "first_mate",
    workflow: "fan-out",
    task: "add --dry-run",
    dir: "/tmp/run",
    state: "retired",
    created: "t",
    panes: [],
    worktree: "/repo/dry-run",
    receipt: {
      panesRemaining: 0,
      panesTotal: 2,
      unitsDone: 2,
      unitsFailed: 0,
      status: "done",
      finished: "t",
    },
    ...over,
  }
}

test("a clean retired job is a ship; a canary stop is a finding", () => {
  assert.deepEqual(promoteFindings({ job: job(), worktreeExists: true, hasWork: true }), [])
  const stopped = promoteFindings({
    job: job({ receipt: { ...job().receipt!, status: "canary-stopped" } }),
    worktreeExists: true,
    hasWork: true,
  })
  assert.match(stopped.map((f) => f.detail).join(" "), /not a ship/)
  const text = formatGate("j-1", stopped)
  assert.match(text, /nothing was pushed/)
  assert.match(formatGate("j-1", [], "https://example/pr/1"), /not a merge/)
})

test("a missing worktree or an empty diff stops the gate", () => {
  const gone = promoteFindings({ job: job(), worktreeExists: false, hasWork: false })
  assert.match(gone.map((f) => f.check).join(" "), /worktree/)
  const empty = promoteFindings({ job: job(), worktreeExists: true, hasWork: false })
  assert.match(empty.map((f) => f.detail).join(" "), /nothing ahead/)
})
