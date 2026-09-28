import assert from "node:assert/strict"
import test from "node:test"
import { extractReportPath, parseWakeList } from "../src/wake-reader.ts"
import { nextRetryAction } from "../src/front-door.ts"

test("parseWakeList reads TSV rows and skips the header and summary", () => {
  const text = [
    "id\tlabel\tkind\tpayload",
    "2\tprobe\tdone\treport: /tmp/x/report.json (done) — pane-reap: 0 remaining",
    "3\tw-japan\tblocked\tgrade failed: missing",
    "wake: 2 queued",
  ].join("\n")
  assert.deepEqual(parseWakeList(text), [
    {
      id: 2,
      label: "probe",
      kind: "done",
      payload: "report: /tmp/x/report.json (done) — pane-reap: 0 remaining",
    },
    { id: 3, label: "w-japan", kind: "blocked", payload: "grade failed: missing" },
  ])
})

test("parseWakeList returns nothing for an empty queue", () => {
  assert.deepEqual(parseWakeList("wake: queue empty (the watch absorbed everything benign)"), [])
})

test("extractReportPath finds the report path in a wake payload", () => {
  assert.equal(
    extractReportPath("report: /tmp/agentic-os-live/three-lookups/report.json (done) — pane-reap: 0 remaining"),
    "/tmp/agentic-os-live/three-lookups/report.json",
  )
  assert.equal(extractReportPath("grade failed: missing"), null)
})

test("the retry cap allows three resubmits and then stops with the message", () => {
  assert.deepEqual(nextRetryAction(0), { action: "continue" })
  assert.deepEqual(nextRetryAction(1), { action: "continue" })
  assert.deepEqual(nextRetryAction(2), { action: "continue" })
  assert.deepEqual(nextRetryAction(3), {
    action: "stop",
    message: "Stopped after 3 retries.",
  })
})
