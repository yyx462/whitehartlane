import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { gradeSmoke, loadManifest, runGrade } from "../src/hooks.ts"

// #144 — the grade contract: an empty-verdict failure is an infra fault,
// never an answer fault. One immediate retry, then a label no report can
// confuse for a verdict. The arm-e night: 41/41 hooks exit-127'd in ~13ms
// with zero artifacts and the rail wrote "failed".

function fixture(hookBody: string): string {
  const dir = mkdtempSync(join(tmpdir(), "whl-grade-contract-"))
  mkdirSync(join(dir, "hooks"), { recursive: true })
  writeFileSync(join(dir, "hooks", "grade.sh"), `#!/usr/bin/env bash\n${hookBody}\n`)
  writeFileSync(
    join(dir, "workflow.toml"),
    ['[workflow]', 'name = "t"', 'worker_kind = "opencode"', "", "[hooks]", 'grade = "bash hooks/grade.sh"', ""].join(
      "\n",
    ),
  )
  return dir
}

const UNIT = { id: "u1", brief: "do" }

test("a silent non-zero grade is a grade-fault with one retry (not an answer fail)", () => {
  const dir = fixture(`
echo "run $1" >> calls.txt
exit 7`)
  const manifest = loadManifest(dir)
  const g = runGrade(dir, manifest, UNIT)
  assert.equal(g.pass, false)
  assert.match(g.row, /^grade-fault: exit 7/)
  assert.equal(g.fault, "grade-fault")
  // exactly one retry, never more
  assert.equal(readFileSync(join(dir, "calls.txt"), "utf8").trim().split("\n").length, 2)
})

test("a silent fault that clears on retry passes, marked honestly", () => {
  const dir = fixture(`
count=$(cat calls.txt 2>/dev/null | wc -l | tr -d ' ')
echo run >> calls.txt
[ "$count" -ge 1 ] && echo "verifier pass" && exit 0
exit 3`)
  const g = runGrade(dir, loadManifest(dir), UNIT)
  assert.equal(g.pass, true)
  assert.match(g.row, /verifier pass \(after grade-fault retry\)/)
  assert.equal(g.fault, undefined)
})

test("a loud failure (verdict row on stdout) is an answer fail — no fault, no retry", () => {
  const dir = fixture(`
echo run >> calls.txt
echo "FAIL"
exit 1`)
  const g = runGrade(dir, loadManifest(dir), UNIT)
  assert.equal(g.pass, false)
  assert.equal(g.row, "FAIL")
  assert.equal(g.fault, undefined)
  // single invocation — the retry is for silence only
  assert.equal(readFileSync(join(dir, "calls.txt"), "utf8").trim().split("\n").length, 1)
})

test("stderr names the fault when stdout stays empty", () => {
  const dir = fixture(`
echo "verify.sh: not found" >&2
exit 127`)
  const g = runGrade(dir, loadManifest(dir), UNIT)
  assert.equal(g.fault, "grade-fault")
  assert.match(g.row, /verify\.sh: not found/)
})

// admission smoke: a hook that declares --check runs it at booking time

test("gradeSmoke: refuse carries the check's own output", () => {
  const dir = fixture(`
if [ "$2" = "--check" ] || [ "$1" = "--check" ]; then
  echo "verify.sh = /bad/path/verify.sh   MISSING"
  exit 1
fi
exit 0`)
  // the hook must mention --check in source for the smoke to fire
  writeFileSync(join(dir, "hooks", "grade.sh"), `#!/usr/bin/env bash
# supports --check
if [ "$1" = "--check" ]; then
  echo "verify.sh = /bad/path/verify.sh   MISSING"
  exit 1
fi
exit 0\n`)
  const smoke = gradeSmoke(dir, loadManifest(dir))
  assert.equal(smoke.kind, "refuse")
  if (smoke.kind === "refuse") assert.match(smoke.output, /MISSING/)
})

test("gradeSmoke: a passing --check admits", () => {
  const dir = fixture(`exit 0`)
  writeFileSync(
    join(dir, "hooks", "grade.sh"),
    `#!/usr/bin/env bash
if [ "$1" = "--check" ]; then echo ok; exit 0; fi
exit 0\n`,
  )
  const smoke = gradeSmoke(dir, loadManifest(dir))
  assert.equal(smoke.kind, "pass")
})

test("gradeSmoke: hooks without --check (or omitted grade) are skipped, old programs unaffected", () => {
  const plain = fixture(`echo "FAIL"; exit 1`)
  assert.equal(gradeSmoke(plain, loadManifest(plain)).kind, "skip")
  const noGrade = mkdtempSync(join(tmpdir(), "whl-grade-contract-"))
  writeFileSync(
    join(noGrade, "workflow.toml"),
    ['[workflow]', 'name = "t"', 'worker_kind = "opencode"', ""].join("\n"),
  )
  assert.equal(gradeSmoke(noGrade, loadManifest(noGrade)).kind, "skip")
})
