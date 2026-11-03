// sweep-retro — #143's law, pinned (the decision; the sweep wires it
// to the fleet): dead surface from dead jobs closes, and NOTHING else
// does. Every close path was forward-looking (retireAll, courier
// reapers, abort); nothing ever looked BACK, so a pane whose job
// already ended stayed open forever (2026-10-17's hand-sweep: an idle
// levy tab and a dead courier pane, both days old).
//
// The conservative boundaries are the law's other half — pinned here
// so the retro pass can never kill a park's restart material:
//   terminal-not-continuable (retired/failed) owners close;
//   paused/aborted/orphaned owners KEEP their panes (continue
//   rebirths them);
//   owner-less panes close only when the label is whl's own chrome
//   (fan-out-*/w-*/whl-fork-*/levy-*) — a foreign pane is never
//   touched, even unclaimed.
import assert from "node:assert/strict"
import test from "node:test"
import { retroClosure } from "../../src/adapters/teardown.ts"

const jobs = [
  { id: "j-done", state: "retired", panes: [{ label: "w-tests-a1" }] },
  { id: "j-fail", state: "failed", panes: [{ label: "w-momentum-a2" }] },
  { id: "j-park", state: "paused", panes: [{ label: "w-principles-a3" }] },
  { id: "j-abort", state: "aborted", panes: [{ label: "w-questions-a4" }] },
  { id: "j-orphan", state: "orphaned", panes: [{ label: "w-tests-a5" }] },
  { id: "j-live", state: "running", panes: [{ label: "w-tests-a6" }] },
]

test("dead owners close; parked and live owners never do", () => {
  const out = retroClosure(
    jobs.flatMap((j) => j.panes.map((p) => p.label)).map((label) => ({ label })),
    jobs,
  )
  const closing = new Map(out.filter((d) => d.close).map((d) => [d.label, d.why]))
  assert.deepEqual([...closing.keys()].sort(), ["w-momentum-a2", "w-tests-a1"])
  assert.match(closing.get("w-tests-a1")!, /j-done is retired/)
  assert.match(closing.get("w-momentum-a2")!, /j-fail is failed/)
  // parked/aborted/orphaned/live: no decision row at all — not ours
  for (const spared of ["w-principles-a3", "w-questions-a4", "w-tests-a5", "w-tests-a6"]) {
    assert.ok(!out.some((d) => d.label === spared), `${spared} must not even be considered`)
  }
})

test("owner-less whl chrome closes; a foreign pane is never touched", () => {
  const live = [
    { label: "fan-out-j-gone" }, // the fleet tab pane of a deleted job
    { label: "whl-fork-j-dead" }, // a courier whose wake never landed
    { label: "levy-j-erased" }, // a levy pane with no record left
    { label: "someone-elses-tool" }, // foreign — close would be a kill
    { label: "negotiator-ndiaye-mv89uaq6" }, // broad coworker name, no owner — spared (too broad to claim)
  ]
  const out = retroClosure(live, [])
  const closing = out.filter((d) => d.close).map((d) => d.label).sort()
  assert.deepEqual(closing, ["fan-out-j-gone", "levy-j-erased", "whl-fork-j-dead"])
  // the foreign pane and the broad unclaimed name produce NO row
  assert.ok(!out.some((d) => d.label === "someone-elses-tool"))
  assert.ok(!out.some((d) => d.label === "negotiator-ndiaye-mv89uaq6"))
})

test("an owned pane outranks the chrome pattern (the map is the first word)", () => {
  // a LIVE job owns a pane whose label happens to match chrome —
  // ownership decides, never the pattern
  const out = retroClosure([{ label: "fan-out-j-live" }], [{ id: "j-live", state: "running", panes: [{ label: "fan-out-j-live" }] }])
  assert.deepEqual(out, [])
})
