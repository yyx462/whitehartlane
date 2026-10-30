// momentum-901 — the --auto flow's OWN default merge command must work at
// the seat where it runs.
//
// What the change adds (bin/whitehartlane:532): a parentless review
// (no traceable parent → the ship supervisor is minted) gets a DEFAULT
// merge command: `gh pr merge <pr> --merge --subject "..."`.
//
// Where that command runs: the merge gate executes merge.sh, whose accept
// arm runs it with `sh -c "$MERGE_CMD"`
// (templates/pr-review/hooks/merge.sh:14-15) — inheriting the hook's cwd,
// which is the JOB'S RUN DIR (every hook runs with cwd = taskDir:
// src/engines/orchestrator.ts:1620 execCheck → input.taskDir →
// src/adapters/rail.ts:254). The run dir lives under
// $AGENTIC_OS_HOME/sessions/<sid>/jobs/<jid>/run — it is NOT a git work
// tree, and `gh` resolves the repository from the cwd unless -R is given.
//
// So the flagship parentless accept path dies at "merge: MERGE_CMD
// failed" (exit 1) — while verdict.json (written by prove.sh BEFORE the
// merge stage) already says accept, and the supervisor is told the rail's
// merge command "already merged the PR — do NOT merge again"
// (src/doors/ship-supervisor.ts:34). The PR never merges; the failure is
// reported as success.
//
// The repro drives the REAL hook at its REAL seat with a gh stub that
// behaves like gh (resolve the repository from the cwd; refuse outside a
// work tree) and asserts the accept actually merges.
//
// BASE behaviour: there is no --auto default merge command at all
// (args.mergeCmd ?? "" → the local `git -C "$REPO"` merge arm, which is
// cwd-independent) — so on BASE this test passes.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const repoRoot = new URL("../../", import.meta.url)
const doorSource = readFileSync(new URL("bin/whitehartlane", repoRoot), "utf8")

// the door's own default, if this change introduced one
const defaultMatch = doorSource.match(/const mergeCmd = val\("merge-cmd"\) \?\? `([^`]*)`/)
const defaultTemplate = defaultMatch?.[1] ?? ""

const fixtureRepo = (root: string): { repo: string; headSha: string; baseSha: string } => {
  const repo = join(root, "repo")
  mkdirSync(repo, { recursive: true })
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init", "-q", "-b", "main", ".")
  g("config", "user.email", "t@t.local")
  g("config", "user.name", "t")
  writeFileSync(join(repo, "a.txt"), "a\n")
  g("add", "-A")
  g("commit", "-qm", "base")
  g("checkout", "-qb", "feat")
  writeFileSync(join(repo, "a.txt"), "b\n")
  g("add", "-A")
  g("commit", "-qm", "feat")
  return { repo, headSha: g("rev-parse", "HEAD").trim(), baseSha: g("rev-parse", "main").trim() }
}

// the materialized review program: the template's hooks + the staged
// data/review/config.sh the door writes (src/doors/review.ts:1040-1056)
const stageProgram = (root: string, opts: { repo: string; headSha: string; baseSha: string; mergeCmd: string }): string => {
  const prog = join(root, "prog")
  cpSync(new URL("templates/pr-review", repoRoot), prog, { recursive: true })
  mkdirSync(join(prog, "data", "review"), { recursive: true })
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
  writeFileSync(
    join(prog, "data", "review", "config.sh"),
    [
      `REPO=${q(opts.repo)}`,
      `BASE_BRANCH=${q("main")}`,
      `BASE_SHA=${q(opts.baseSha)}`,
      `HEAD_BRANCH=${q("feat")}`,
      `HEAD_SHA=${q(opts.headSha)}`,
      `TITLE=${q("PR #42")}`,
      `AUTHOR=${q("")}`,
      `MERGE_CMD=${q(opts.mergeCmd)}`,
    ].join("\n") + "\n",
  )
  writeFileSync(join(prog, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", head: opts.headSha, blocked: [] }))
  return prog
}

test("the auto flow's default merge command must merge at the merge gate's seat", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom901-"))
  const { repo, headSha, baseSha } = fixtureRepo(tmp)
  const mergeCmd = defaultTemplate.replaceAll("${pr}", "42")
  const prog = stageProgram(tmp, { repo, headSha, baseSha, mergeCmd })

  // a gh stub with gh's documented behaviour: the repository comes from
  // the cwd unless -R is given; outside a work tree gh exits 1 with
  // "failed to run git: fatal: not a git repository"
  const bin = join(tmp, "bin")
  mkdirSync(bin, { recursive: true })
  const ghStub = join(bin, "gh")
  const mergedMarker = join(tmp, "gh-merged.txt")
  writeFileSync(
    ghStub,
    `#!/bin/sh
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "failed to run git: fatal: not a git repository (or any of the parent directories): .git" >&2
  exit 1
fi
echo merged > ${JSON.stringify(mergedMarker)}
exit 0
`,
  )
  chmodSync(ghStub, 0o755)

  // the merge gate's real seat: the job's run dir (a staged copy of the
  // program under $AGENTIC_OS_HOME/sessions/<sid>/jobs/<jid>/run)
  const taskDir = join(tmp, "sessions", "s1", "jobs", "j1", "run")
  mkdirSync(taskDir, { recursive: true })

  const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], {
    cwd: taskDir,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
  })
  assert.equal(
    r.status,
    0,
    `the accept must merge at the gate's seat: the merge command must be able to resolve the repository from where it runs.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  )
  if (mergeCmd !== "") {
    assert.ok(existsSync(mergedMarker), "the merge command ran and merged")
  }
  rmSync(tmp, { recursive: true, force: true })
})
