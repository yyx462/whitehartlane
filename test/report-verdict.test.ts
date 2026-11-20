import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { writeReport } from "../src/core/report.ts"
import { createJob, failedWakeWhy, openSession } from "../src/adapters/store.ts"
import { prepareRun } from "../src/doors/run.ts"

// #296's disk is the test's own — the booking below writes a real
// session; keep it off the operator's OS disk
process.env.AGENTIC_OS_HOME ??= mkdtempSync(join(tmpdir(), "whl-296-"))

// #197 — a verdict hook's red is a ROW, not a crash: the report always
// lands, the why rides the table, and the wake names a real file.
test("a throwing counts hook still produces an honest failed report", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-red-"))
  const rows = [{ unit: "worker-1", result: "did the work", pass: true }]
  const report = writeReport(
    dir,
    dir,
    rows,
    () => {
      throw new Error("counts hook exited 1: bash hooks/audit.sh")
    },
  )
  assert.equal(report.status, "failed", "the red verdict fails the report, not the run's plumbing")
  assert.ok(readFileSync(join(dir, "report.json"), "utf8").includes("verdict hook failed"))
  const countsRow = report.table.find((r) => r.unit === "counts")
  assert.ok(countsRow, "the why is a row in the table")
  assert.match(countsRow!.result, /counts hook exited 1/)
  assert.equal(report.counts.failed, 1)
})

// the repair-ticket hint (#197, reshaped by #296): a failed wake names
// the cheapest next command when it can PROVE the program was edited —
// the proof is the staged-pages photo (.whl-program, booked at staging),
// never the whole-folder pile hash. #296's receipt (j-dd28ac): the run
// itself dropped report.md into the program folder 2 minutes before the
// gate failed, the pile hash moved, and the wake prescribed `whl
// continue` — a verb that refuses every retired job — 0.1s after the
// red, before any human could have fixed anything.
test("failedWakeWhy proves the edit against the booked pages, and prescribes a verb that works", () => {
  const sess = openSession({ cwd: process.env.AGENTIC_OS_HOME! })
  const prog = mkdtempSync(join(tmpdir(), "whl-296-prog-"))
  mkdirSync(join(prog, "hooks"), { recursive: true })
  writeFileSync(join(prog, "workflow.toml"), "[workflow]\nname='t'\nworker_kind='pi'\n[[stage]]\nid=\"s1\"\ntopology=\"gate\"\nrun=\"bash hooks/x.sh\"\n")
  writeFileSync(join(prog, "contract.toml"), "[[contract.deliverables]]\nname=\"out\"\npath=\"out.md\"\nkind=\"file\"\n")
  writeFileSync(join(prog, "hooks", "x.sh"), "#!/bin/sh\nexit 0\n")
  const ready = prepareRun(prog)
  assert.ok(ready.ok, `the program must book: ${ready.ok ? "" : ready.why}`)
  const job = ready.job

  // #296's exact shape: a NEW file lands in the program folder during
  // the run — a dropping, not an edit. The photo has no page for it, so
  // it must NOT fire the hint
  writeFileSync(join(prog, "report.md"), "# match report\n")
  assert.equal(failedWakeWhy(job, "failed"), "failed", "a file the booking never saw is not a program edit")

  // a real edit — a booked page's bytes changed — fires the hint, and
  // the prescription names verbs that accept a finished job
  writeFileSync(join(prog, "hooks", "x.sh"), "#!/bin/sh\nexit 1\n")
  const hinted = failedWakeWhy(job, "failed")
  assert.match(hinted, /program changed since booking/, "a real edit is still named (principles-5201)")
  assert.match(hinted, /re-levy/, "the prescription names the re-levy, not a verb that refuses retired jobs")
  assert.match(hinted, /regrade/, "the grade-hook fix is named too")
  assert.doesNotMatch(hinted, /whl continue/, "`whl continue` refuses retired jobs — it must not be prescribed here (#296)")

  // the photo is content, not mtime: reverting the edit restores quiet
  writeFileSync(join(prog, "hooks", "x.sh"), "#!/bin/sh\nexit 0\n")
  assert.equal(failedWakeWhy(job, "failed"), "failed")

  // a vanished source (reaped worktree) is honest without the hint
  rmSync(prog, { recursive: true, force: true })
  assert.equal(failedWakeWhy(job, "failed"), "failed")

  // a legacy job with no staged photo can prove nothing — no claim
  const legacySrc = mkdtempSync(join(tmpdir(), "whl-296-legacy-"))
  mkdirSync(join(legacySrc, "hooks"), { recursive: true })
  writeFileSync(join(legacySrc, "workflow.toml"), "name = \"x\"\n")
  writeFileSync(join(legacySrc, "hooks", "x.sh"), "#!/bin/sh\nexit 1\n")
  const legacy = createJob({ sid: sess.id, stoodUpBy: "standalone", workflow: "fan-out", task: "legacy", runDir: true })
  legacy.spur = { project: "p-test", project_name: "legacy", spur_id: "legacy", content_hash: "stale", source: legacySrc }
  assert.equal(failedWakeWhy(legacy, "failed"), "failed", "no photo → no claim (refusal beats silence)")
  rmSync(legacySrc, { recursive: true, force: true })
})
