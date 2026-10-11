import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "agentic-os-project-"))

const { contentHashOf, ensureProject, labelsFor, registerSpur, spurIdOf } = await import("../src/project.ts")
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

test("a minted pid collides with the registry, the mint loops until unique", () => {
  const home = process.env.AGENTIC_OS_HOME ?? ""
  writeFileSync(join(home, "projects", "p-taken.json"), "{}\n")
  let calls = 0
  const mint = () => (calls++ === 0 ? "p-taken" : "p-fresh1")
  const dir = programFolder("collide")
  const got = ensureProject(dir, { mint })
  assert.equal(got.pid, "p-fresh1")
  assert.equal(calls, 2)
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
  // a program nested inside a repo walks up and labels by its checkout
  const nestedRoot = join(mkdtempSync(join(tmpdir(), "agentic-os-nest-")), "repo")
  const nested = join(nestedRoot, "programs", "deep", "spur")
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(nestedRoot, ".git"), "gitdir: /somewhere/.bear/worktrees/nested-lane\n")
  assert.deepEqual(labelsFor(nested), { branch: "nested-lane", worktree: "nested-lane" })
})

test("spur_id: explicit wins, the name groups silently, the hash is loud and derived", () => {
  assert.deepEqual(spurIdOf({ spurId: "front-back", name: "ui", toml: "" }), { spurId: "front-back", derived: false })
  assert.deepEqual(spurIdOf({ name: "ui-window", toml: "" }), { spurId: "ui-window", derived: false })
  const hashed = spurIdOf({ toml: "[workflow]\n" })
  assert.match(hashed.spurId, /^spur-[0-9a-f]{8}$/)
  assert.equal(hashed.derived, true)
})

test("the content hash versions the program; a change is a new version", () => {
  const dir = programFolder("versioned")
  writeFileSync(join(dir, "workflow.toml"), "v1\n")
  const v1 = contentHashOf(dir)
  writeFileSync(join(dir, "hooks"), "changed\n")
  assert.notEqual(contentHashOf(dir), v1)
})

test("duplicate spur_id under one project with different content warns, never refuses", () => {
  const dir = programFolder("dupes")
  const { pid } = ensureProject(dir)
  const home = process.env.AGENTIC_OS_HOME ?? ""
  assert.equal(registerSpur(pid, "ui", "h1", dir, { home }), null)
  assert.equal(registerSpur(pid, "ui", "h2", dir, { home }), null) // same path, new version
  const warn = registerSpur(pid, "ui", "h3", "/another/folder", { home })
  assert.match(warn ?? "", /already runs different content/)
})

test("job.born carries the spur identity and the projection restores it", () => {
  const { session } = findOrOpenSession({ cwd: "/tmp/spur-run" })
  const dir = programFolder("grouped")
  const { pid, name } = ensureProject(dir)
  const job = createJob({
    sid: session.id,
    stoodUpBy: "standalone",
    workflow: "coworker",
    task: "grouped",
    runDir: true,
    spur: {
      project: pid,
      project_name: name,
      spur_id: "ui-window",
      content_hash: "h1",
      source: dir,
      labels: { branch: "lane-x" },
    },
  })
  const born = readEvents(session.id).find((e) => e.kind === "job.born" && e.jid === job.id)!
  assert.equal((born.spur as { spur_id: string }).spur_id, "ui-window")
  const projected = projectJob(session.id, job.id)
  assert.equal(projected?.spur?.project, pid)
  assert.equal(projected?.spur?.labels?.branch, "lane-x")
})
