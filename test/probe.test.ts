// Issue #121 — the staging probe: a hook that cannot speak the
// protocol is refused at the door, before anything is booked or born.
// j-64e035: counts = "true" printed nothing, the fatal landed at
// report time, and 79 minutes of clean coworker work died with it.
import assert from "node:assert/strict"
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { loadManifest, probeHooks } from "../src/hooks.ts"

const EXAMPLE = join(import.meta.dirname, "..", "examples", "fan-out-spurs", "three-lookups")

function copyExample(): string {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-probe-"))
  cpSync(EXAMPLE, dir, { recursive: true })
  return dir
}

function retoml(dir: string, field: "units" | "grade" | "counts", value: string): void {
  const toml = join(dir, "workflow.toml")
  const raw = readFileSync(toml, "utf8")
  writeFileSync(toml, raw.replace(new RegExp(`${field} = "[^"]*"`), `${field} = "${value}"`))
}

test("a healthy manifest probes clean", () => {
  const dir = copyExample()
  const manifest = loadManifest(dir)
  assert.deepEqual(probeHooks(dir, manifest, "fan-out"), [])
})

test("a silent counts hook is refused with the fix named (j-64e035)", () => {
  const dir = copyExample()
  // a script that exits 0 printing nothing — the exact shape of
  // /bin/true, spelled as a file so the load-time noop refusal
  // (counts = "true") does not fire and the probe is what catches it
  writeFileSync(join(dir, "silentcounts.cjs"), "")
  retoml(dir, "counts", "node silentcounts.cjs")
  const refusals = probeHooks(dir, loadManifest(dir), "fan-out")
  assert.equal(refusals.length, 1)
  assert.match(refusals[0], /counts hook prints no JSON at probe \(empty stdout\)/)
  assert.match(refusals[0], /counts = "default"/)
})

test("a counts hook printing a non-number is refused", () => {
  const dir = copyExample()
  writeFileSync(join(dir, "badcounts.cjs"), "console.log(JSON.stringify({ units: 'x' }))")
  retoml(dir, "counts", "node badcounts.cjs")
  const refusals = probeHooks(dir, loadManifest(dir), "fan-out")
  assert.equal(refusals.length, 1)
  assert.match(refusals[0], /counts hook count units is not a number/)
})

test("a counts hook printing an empty object is refused", () => {
  const dir = copyExample()
  writeFileSync(join(dir, "badcounts.cjs"), "console.log(JSON.stringify({}))")
  retoml(dir, "counts", "node badcounts.cjs")
  const refusals = probeHooks(dir, loadManifest(dir), "fan-out")
  assert.equal(refusals.length, 1)
  assert.match(refusals[0], /printed an empty object at probe/)
})

test("a crashing counts hook is refused", () => {
  const dir = copyExample()
  writeFileSync(join(dir, "badcounts.cjs"), "process.exit(3)")
  retoml(dir, "counts", "node badcounts.cjs")
  assert.match(probeHooks(dir, loadManifest(dir), "fan-out")[0], /counts hook exited 3 at probe/)
})

test("omitted and default counts are not probed — the built-in cannot be malformed", () => {
  const dir = copyExample()
  retoml(dir, "counts", "default")
  assert.deepEqual(probeHooks(dir, loadManifest(dir), "fan-out"), [])
})

test("a silent units hook is refused for fan-out without steps", () => {
  const dir = copyExample()
  retoml(dir, "units", "true")
  const refusals = probeHooks(dir, loadManifest(dir), "fan-out")
  assert.equal(refusals.length, 1)
  assert.match(refusals[0], /units hook produced no units at probe/)
})

test("units is not probed for coworker — it is never called there", () => {
  const dir = copyExample()
  retoml(dir, "units", "true")
  assert.deepEqual(probeHooks(dir, loadManifest(dir), "coworker"), [])
})

test("AGENTIC_OS_PROBE=0 disarms the probe", () => {
  const dir = copyExample()
  writeFileSync(join(dir, "silentcounts.cjs"), "")
  retoml(dir, "counts", "node silentcounts.cjs")
  process.env.AGENTIC_OS_PROBE = "0"
  try {
    assert.deepEqual(probeHooks(dir, loadManifest(dir), "fan-out"), [])
  } finally {
    delete process.env.AGENTIC_OS_PROBE
  }
})

test("the door refuses a silent counts hook before booking anything (j-64e035 replay)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-probe-door-"))
  cpSync(EXAMPLE, dir, { recursive: true })
  writeFileSync(join(dir, "silentcounts.cjs"), "")
  const toml = join(dir, "workflow.toml")
  writeFileSync(
    toml,
    readFileSync(toml, "utf8").replace(/counts = "[^"]*"/, 'counts = "node silentcounts.cjs"'),
  )
  const { prepareRun } = await import("../src/run.ts")
  const { listJobs, abortJob } = await import("../src/store.ts")
  const refused = prepareRun(dir)
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.why, /hook probe refused: counts hook prints no JSON/)
  assert.equal(listJobs().filter((job) => job.dir.startsWith(dir)).length, 0)
  // no job booked — nothing to abort; the assert above is the contract
  void abortJob
})

test("a counts hook printing a bare number is refused as a non-object — not misread as an empty object", () => {
  const dir = copyExample()
  writeFileSync(join(dir, "badcounts.cjs"), "console.log('0')")
  retoml(dir, "counts", "node badcounts.cjs")
  const refusals = probeHooks(dir, loadManifest(dir), "fan-out")
  assert.equal(refusals.length, 1)
  assert.match(refusals[0], /must print a JSON object of numbers at probe \(got 0\)/)
})
