// principles-14 — the intake lens derivation must read the BYTES THE
// DOOR WRITES. The diff replaces intake.sh's hardcoded lens loop with
// a derivation from the materialized workflow.toml ("this reads the
// truth instead"). But the door materializes through smol-toml
// parse → pin → stringify (review.ts pinIntoWorkflowTable) — and the
// stringify re-serializes `units = [ … ]` into [[stage.units]] tables.
// The sed range `/^units = \[/,/^\]/` matches nothing on those bytes,
// so the loop derives ZERO lenses and writes NO order files — every
// lens then reads diff.patch in the identical order, the correlated
// first-attention the shuffle exists to kill (this very review run
// shipped without order-*.txt). The test pins: a real `whl review`
// staging (--model is mandatory here — the lens units pin
// temperatures) yields a workflow.toml whose lens derivation is the
// full roster.
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

// prepareReview joins the template ROOT with the template's own name
const TPL = join(import.meta.dirname, "..", "..", "templates")

function fixtureRepo(root: string): string {
  const repo = join(root, "repo")
  mkdirSync(join(repo, "src"), { recursive: true })
  const g = (args: string) => execSync(`git ${args}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(repo, "src", "wait.ts"), "a\n")
  g("add -A")
  g("commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(repo, "src", "wait.ts"), "a\nb\n")
  g("add -A")
  g("commit -qm feat")
  return repo
}

test("intake's lens loop derives every lens from the MATERIALIZED workflow.toml", () => {
  const tmp = mkdtempSync(join(tmpdir(), "principles-14-"))
  try {
    const repo = fixtureRepo(join(tmp, "r"))
    const out = join(tmp, "prog")
    const ready = prepareReview(
      { repo, base: "main", head: "feat", model: "acme/strong", title: "t", out },
      TPL,
    )
    assert.ok(ready.ok && !ready.skipped, `door materialization refused: ${JSON.stringify(ready).slice(0, 200)}`)
    const dir = ready.dir as string
    // intake.sh's own pipeline on $prog/workflow.toml (verbatim)
    const wf = join(dir, "workflow.toml")
    const derived = execSync(
      `sed -n '/^units = \\[/,/^\\]/p' '${wf}' | grep -o '{ id = "[a-z]*"' | sed 's/.*id = "//;s/"//'`,
      { shell: "/bin/bash", encoding: "utf8" },
    ).trim().split("\n").filter(Boolean)
    assert.deepEqual(
      [...derived].sort(),
      ["momentum", "principles", "questions", "tests"],
      `intake derived [${derived.join(", ")}] from the materialized bytes — zero order files means every lens reads the diff in the SAME order`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
