import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { loadManifest } from "../src/doors/hooks.ts"
import { workflowKind } from "../src/core/workflow-kind.ts"
import { test } from "node:test"

// ADR 0014 slice 3 — the museum conversion, pinned. Every workflow.toml
// under examples/ and test/e2e/ must parse as a manifest (the load-time
// refusals — [[step]] tables, hooks.units, [gates] — fire here), declare
// its workers as [[stage]] entries when it is fan-out-shaped (the door
// refuses a stage-less fan-out; the corpus must never hold one), and the
// trees must hold no spur.mjs/dag.mjs step file. A future museum donation
// cannot land without tripping this.
const TREES = [join(import.meta.dirname, "..", "examples"), join(import.meta.dirname, "e2e")]

function workflowDirs(root: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue
    const dir = join(root, entry.name)
    if (existsSync(join(dir, "workflow.toml"))) found.push(dir)
    found.push(...workflowDirs(dir))
  }
  return found
}

const dirs = TREES.flatMap(workflowDirs)
if (dirs.length < 10) throw new Error(`corpus walk found only ${dirs.length} programs — the trees moved?`)

test("every examples/e2e program parses and declares its workers as stages (ADR 0014)", () => {
  for (const dir of dirs) {
    const manifest = loadManifest(dir) // throws the door's own refusal on a retired spelling
    const kind = workflowKind(readFileSync(join(dir, "workflow.toml"), "utf8"))
    if (kind === "fan-out" && !manifest.stages?.length) {
      throw new Error(`${dir}: fan-out-shaped program with no [[stage]] entries — the door refuses this (docs/STAGES.md, ADR 0014)`)
    }
  }
})

test("no retired step file anywhere in the corpus trees (ADR 0014 slice 2)", () => {
  const stepFiles: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue
      const path = join(dir, entry.name)
      if (entry.isFile() && (entry.name === "spur.mjs" || entry.name === "dag.mjs")) stepFiles.push(path)
      else if (entry.isDirectory()) walk(path)
    }
  }
  for (const root of TREES) walk(root)
  if (stepFiles.length > 0) {
    throw new Error(`the step file is retired — the door refuses it: ${stepFiles.join(", ")}`)
  }
})
