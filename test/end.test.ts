import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-end-"))

const { readEvents } = await import("../src/store.ts")
const { nameEnd, recordEnd } = await import("../src/end.ts")

const sid = "s-end"
const jid = "j-end"
const quiet = { grew: false, silentMs: 0, stallMs: 60_000, reprompted: false, alive: true }

test("a done line, a blocked line, and a dead pane each append one end", () => {
  assert.equal(nameEnd({ ...quiet, id: "france", log: "done france\n" }), "done")
  assert.equal(nameEnd({ ...quiet, id: "japan", log: "blocked japan: no page\n" }), "blocked")
  assert.equal(nameEnd({ ...quiet, id: "peru", log: "", alive: false }), "dead")

  recordEnd(sid, jid, "p-france", "done")
  recordEnd(sid, jid, "p-france", "done")
  recordEnd(sid, jid, "p-japan", "blocked")
  recordEnd(sid, jid, "p-peru", "dead")

  const ends = readEvents(sid).filter((event) => event.kind === "end")
  assert.deepEqual(ends.map((event) => event.end), ["done", "blocked", "dead"])
})

test("a growing log with no end line appends nothing", () => {
  const name = nameEnd({
    ...quiet,
    id: "france",
    log: "working: still reading\n",
    grew: true,
  })
  assert.equal(name, null)
  assert.equal(recordEnd(sid, jid, "p-heart", name), null)
  assert.equal(readEvents(sid).some((event) => event.pane === "p-heart"), false)
})

test("silence past the stall is one end, and only after one reprompt", () => {
  const waiting = nameEnd({
    ...quiet,
    id: "france",
    log: "",
    silentMs: 90_000,
    stallMs: 60_000,
    reprompted: false,
  })
  const silent = nameEnd({
    ...quiet,
    id: "france",
    log: "",
    silentMs: 90_000,
    stallMs: 60_000,
    reprompted: true,
  })
  assert.equal(waiting, null)
  assert.equal(silent, "silent")
})
