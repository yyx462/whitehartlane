import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { bindWorktree, findGwtRoot, liveWorktrees, parseGwtPath, slugFor } from "../src/bind.ts"
import { createJob, findOrOpenSession } from "../src/store.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-bind-"))

test("parseGwtPath reads the toon path field", () => {
  assert.equal(parseGwtPath("worktree: dry-run\n  path: /repo/dry-run\n"), "/repo/dry-run")
  assert.equal(parseGwtPath("no path here"), null)
})

test("slugFor keeps a gwt-safe stem", () => {
  assert.equal(slugFor("Add a --dry-run flag"), "add-a-dry-run-flag")
  assert.equal(slugFor("???"), "task")
})

test("bindWorktree reuses an existing folder and refuses a live one", () => {
  const home = process.env.AGENTIC_OS_HOME!
  const tree = mkdtempSync(join(tmpdir(), "agentic-os-wt-"))
  const { session } = findOrOpenSession({ cwd: "/tmp/bind" })
  session.worktree = tree
  const again = bindWorktree({
    session,
    task: "again",
    root: "/repo",
    spawn: () => { throw new Error("should not spawn") },
  })
  assert.equal("worktree" in again && again.worktree, tree)
  assert.equal("created" in again && again.created, false)

  const other = findOrOpenSession({ cwd: "/tmp/other" }).session
  other.worktree = tree
  const job = createJob({ sid: other.id, stoodUpBy: "first_mate", workflow: "fan-out", task: "t", dir: "/tmp/j" })
  const fresh = findOrOpenSession({ cwd: "/tmp/fresh" }).session
  const refused = bindWorktree({
    session: fresh,
    task: "dry run",
    root: "/repo",
    spawn: () => ({ path: tree }),
    liveWorktrees: liveWorktrees(
      [other, fresh],
      [job],
      fresh.id,
    ),
  })
  assert.equal("error" in refused, true)
  rmSync(tree, { recursive: true, force: true })
  assert.ok(home)
})

test("findGwtRoot honors AGENTIC_OS_GWT_ROOT and walks to .bear", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentic-os-bear-"))
  mkdirSync(join(dir, "nested"), { recursive: true })
  writeFileSync(join(dir, ".bear"), "")
  const prev = process.env.AGENTIC_OS_GWT_ROOT
  delete process.env.AGENTIC_OS_GWT_ROOT
  try {
    assert.equal(findGwtRoot(join(dir, "nested")), dir)
    process.env.AGENTIC_OS_GWT_ROOT = "/override"
    assert.equal(findGwtRoot(dir), "/override")
  } finally {
    if (prev === undefined) delete process.env.AGENTIC_OS_GWT_ROOT
    else process.env.AGENTIC_OS_GWT_ROOT = prev
    rmSync(dir, { recursive: true, force: true })
  }
})
