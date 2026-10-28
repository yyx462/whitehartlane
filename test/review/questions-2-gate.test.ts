import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// this repro points AGENTIC_OS_HOME at its own temp disk so no real
// session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-questions2-"))
process.env.AGENTIC_OS_NOTIFY = "0"

import { prepareReview } from "../../src/doors/review.ts"

// INV-3 (one decision, one place): "which lens units did the gate
// materialize" is read back from the materialized workflow.toml TEXT by
// templates/pr-review/hooks/intake.sh (this diff's own change — "the
// roster is the materialized units, never the hardcoded four … this
// reads the truth instead"), anchored on /^units = \[/ … /^\]/.
// The SAME diff moved the model pin to a parse→mutate→re-serialize
// (pinIntoWorkflowTable, src/doors/review.ts). smol-toml's stringify
// re-serializes the template's inline `units = [ … ]` array as
// [[stage.units]] sub-tables — so on EVERY pinned materialization the
// anchor intake.sh reads is GONE: the lens loop iterates over nothing
// and the per-lens shuffled hunk-order files (data/review/order-<lens>.txt,
// the decorrelation the intake contract promises) are never written.
// The normal path, every time: the template pins per-unit temperatures
// and declares no model, so --model — and therefore the pin — is
// mandatory for every real review (the door refuses without it).
//
// Path that breaks: whl review <repo> --base main --head feat --model p/m
// → materialization pins via stringify → intake.sh's sed finds no
// `units = [` line → zero order-<lens>.txt files → every lens silently
// loses its shuffled read order.
//
// On BASE the pin is a regex insert over the template's own bytes: the
// units block survives verbatim and the reader finds all four lenses —
// green there by design (this diff introduces the disagreement).
test("the materialized workflow.toml still yields the lens roster to intake.sh's reader after the model pin", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-q2-"))
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
      "INV-3: intake.sh's sed anchor (^units = [) survives materialization — the pin's stringify must not erase the block intake.sh reads; " +
        `after a pinned materialization the staged workflow.toml carries ${toml.includes("[[stage.units]]") ? "[[stage.units]] sub-tables" : "no units anchor at all"}, ` +
        "so the intake lens loop iterates over NOTHING and zero order-<lens>.txt files are written — the shuffle contract is silently dead on the normal path (--model is mandatory: the template pins temperatures and declares no model)",
    )
    let end = start
    while (end < lines.length && lines[end].trim() !== "]") end++
    const block = lines.slice(start, end + 1).join("\n")
    const ids = [...block.matchAll(/\{ id = "([a-z]+)"/g)].map((m) => m[1])
    assert.deepEqual(
      ids.sort(),
      ["momentum", "principles", "questions", "tests"],
      "INV-3: intake.sh's lens loop finds every materialized lens — one shuffled hunk-order file per lens gets written",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
