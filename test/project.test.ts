import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-project-"))

const { contentHashOf, dagIdOf, ensureProject, labelsFor, registerDag } = await import("../src/project.ts")
const { createJob, findOrOpenSession, projectJob, readEvents } = await import("../src/store.ts")

function programFolder(name = "prog"): string {
  const dir = join(mkdtempSync(join(tmpdir(), "agentic-os-prog-")), name)
  mkdirSync(dir, { recursive: true })
  return dir
}

test("a project is minted once, and a moved folder keeps its identity (path is never identity)", () => {
  const dir = programFolder("my-window")
  const first = ensureProject(dir)
  assert.match(first.pid, /^p-/)
  assert.equal(first.minted, true)
  // same folder: idempotent
  const again = ensureProject(dir)
  assert.equal(again.pid, first.pid)
  assert.equal(again.minted, false)
  // move the folder: project.json travels, the pid survives
  const moved = join(mkdtempSync(join(tmpdir(), "agentic-os-moved-")), "renamed-elsewhere")
  cpSync(dir, moved, { recursive: true })
  const afterMove = ensureProject(moved)
  assert.equal(afterMove.pid, first.pid)
  // a different program with no file is a different project
  const other = ensureProject(programFolder("other"))
  assert.notEqual(other.pid, first.pid)
})

test("a worktree copies project.json — runs combine, no warning, labels differ", () => {
  const dir = programFolder("repo-copy")
  const first = ensureProject(dir)
  const worktree = join(mkdtempSync(join(tmpdir(), "agentic-os-wt-")), "lane-x")
  cpSync(dir, worktree, { recursive: true })
  const twin = ensureProject(worktree)
  assert.equal(twin.pid, first.pid) // same project — combined by design
  // labels: a .git FILE is a worktree; a .git dir carries the branch
  writeFileSync(join(worktree, ".git"), "gitdir: /somewhere/.bear/worktrees/lane-x\n")
  assert.deepEqual(labelsFor(worktree), { branch: "lane-x", worktree: "lane-x" })
  mkdirSync(join(dir, ".git"), { recursive: true })
  writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/feature/dark\n")
  assert.deepEqual(labelsFor(dir), { branch: "feature/dark" })
  assert.deepEqual(labelsFor(programFolder("no-git")), {})
})

test("dag_id: explicit wins, the name groups silently, the hash is loud and derived", () => {
  assert.deepEqual(dagIdOf({ dagId: "front-back", name: "ui", toml: "" }), { dagId: "front-back", derived: false })
  assert.deepEqual(dagIdOf({ name: "ui-window", toml: "" }), { dagId: "ui-window", derived: false })
  const hashed = dagIdOf({ toml: "[workflow]\n" })
  assert.match(hashed.dagId, /^dag-[0-9a-f]{8}$/)
  assert.equal(hashed.derived, true)
})

test("the content hash versions the program; a change is a new version", () => {
  const dir = programFolder("versioned")
  writeFileSync(join(dir, "workflow.toml"), "v1\n")
  const v1 = contentHashOf(dir)
  writeFileSync(join(dir, "hooks"), "changed\n")
  assert.notEqual(contentHashOf(dir), v1)
})

test("duplicate dag_id under one project with different content warns, never refuses", () => {
  const dir = programFolder("dupes")
  const { pid } = ensureProject(dir)
  const home = process.env.AGENTIC_OS_HOME ?? ""
  assert.equal(registerDag(pid, "ui", "h1", dir, { home }), null)
  assert.equal(registerDag(pid, "ui", "h2", dir, { home }), null) // same path, new version
  const warn = registerDag(pid, "ui", "h3", "/another/folder", { home })
  assert.match(warn ?? "", /already runs different content/)
})

test("job.born carries the dag identity and the projection restores it", () => {
  const { session } = findOrOpenSession({ cwd: "/tmp/dag-run" })
  const dir = programFolder("grouped")
  const { pid, name } = ensureProject(dir)
  const job = createJob({
    sid: session.id,
    stoodUpBy: "standalone",
    workflow: "coworker",
    task: "grouped",
    runDir: true,
    dag: {
      project: pid,
      project_name: name,
      dag_id: "ui-window",
      content_hash: "h1",
      source: dir,
      labels: { branch: "lane-x" },
    },
  })
  const born = readEvents(session.id).find((e) => e.kind === "job.born" && e.jid === job.id)!
  assert.equal((born.dag as { dag_id: string }).dag_id, "ui-window")
  const projected = projectJob(session.id, job.id)
  assert.equal(projected?.dag?.project, pid)
  assert.equal(projected?.dag?.labels?.branch, "lane-x")
})
