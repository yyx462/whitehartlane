import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// this repro points AGENTIC_OS_HOME at its own temp disk so no real
// session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-momentum13-"))
process.env.AGENTIC_OS_NOTIFY = "0"

import { prepareReview } from "../../src/doors/review.ts"

// INV-3 (one decision, one place): "which lens units did the gate
// materialize" is answered by TWO sites that must agree on the
// materialized bytes —
//   src/doors/review.ts        reads PARSED stage[].units[].id
//   templates/pr-review/hooks/intake.sh reads TEXT anchored on /^units = \[/
//     (its own comment: "the roster is the materialized units, never the
//      hardcoded four … this reads the truth instead")
// The same diff moved the model pin to parse→stringify
// (pinIntoWorkflowTable). smol-toml stringify re-serializes the
// template's inline `units = [ … ]` array as [[stage.units]] tables:
// after EVERY pinned materialization there is no `units = [` line, so
// intake.sh's lens loop iterates over NOTHING and per-lens hunk-order
// files (data/review/order-<lens>.txt, shuffle seed 7i+13) are never
// written — on the normal path, because the template pins temperatures
// and declares no model, so --model (and the pin) is mandatory for
// every real review.
//
// Path that breaks: whl review <repo> --base main --head feat --model p/m
// → materialization pins via stringify → intake.sh finds zero lenses →
// zero order-<lens>.txt files → every lens silently loses its shuffled
// read order (the decorrelation the order file exists for).
//
// On BASE the pin is a regex insert that preserves the template's bytes:
// the units block survives and the extraction finds all four lenses —
// green there by design (this diff introduces the disagreement).
test("the materialized workflow.toml still yields the lens roster to intake.sh's reader after the model pin", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-m13-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init -q -b main .")
    g("config user.email t@t.local")
    g("config user.name t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    g("add -A")
    g("commit -qm base")
    g("checkout -qb feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    g("add -A")
    g("commit -qm feat")

    const ready = prepareReview(
      { repo, base: "main", head: "feat", model: "p/m", out: join(tmp, "prog") },
      join(import.meta.dirname, "..", "..", "templates"),
    )
    assert.ok(ready.ok && !ready.skipped, `materialization refused: ${ready.ok ? "" : ready.why}`)
    const toml = readFileSync(join(ready.ok ? ready.dir! : "", "workflow.toml"), "utf8")

    // intake.sh's exact reader (templates/pr-review/hooks/intake.sh:93):
    //   sed -n '/^units = \[/,/^\]/p' "$prog/workflow.toml" \
    //     | grep -o '{ id = "[a-z]*"' | sed 's/.*id = "//;s/"//'
    const lines = toml.split("\n")
    const start = lines.findIndex((l) => /^units = \[/.test(l))
    assert.notEqual(
      start, -1,
      "intake.sh's sed anchor (^units = [) survives materialization — the pin's stringify must not erase the block intake.sh reads",
    )
    let end = start
    while (end < lines.length && lines[end].trim() !== "]") end++
    const block = lines.slice(start, end + 1).join("\n")
    const ids = [...block.matchAll(/\{ id = "([a-z]+)"/g)].map((m) => m[1])
    assert.deepEqual(
      ids.sort(),
      ["momentum", "principles", "questions", "tests"],
      "intake.sh's lens loop finds every materialized lens — one shuffle order file per lens gets written",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
