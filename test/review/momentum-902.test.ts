// momentum-902 — the accept merge must land EXACTLY the bytes the verdict
// judged.
//
// The repo's own law, stated twice in this codebase:
//   - templates/pr-review/hooks/merge.sh:17-25 (the local merge arm):
//     "a base BRANCH that moved since intake would land unreviewed commits
//      inside the accepted merge — re-observe the label and refuse on drift"
//   - bin/whitehartlane:730-746 (the overrule seat, the momentum-500
//     class): "the verdict judged one sha; `gh pr merge <n>` merges the PR's
//     CURRENT remote head. Verify the two are the same bytes at the last
//     possible seat — and a query failure refuses".
//
// The seat that is missing it: the MERGE_CMD arm (merge.sh:14-15). It runs
// the caller's command with no observation of what is being landed. This
// change makes that arm the DEFAULT for the auto ship flow
// (bin/whitehartlane:532: `gh pr merge <pr> --merge --subject ...`), so
// the accept of a parentless review lands the PR's CURRENT head — which a
// push during the (long) review can move away from the sha the verdict
// judged (the levy pins the gate's sha, bin:515-530).
//
// The repro drives the real hook with a gh stub that merges the PR's
// current head (the documented `gh pr merge` behaviour) and asserts the
// accept lands exactly HEAD_SHA (the judged bytes).
//
// BASE behaviour: there is no default merge command (the local merge arm
// runs, and it merges HEAD_SHA) — so on BASE this test passes.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const repoRoot = new URL("../../", import.meta.url)
const doorSource = readFileSync(new URL("bin/whitehartlane", repoRoot), "utf8")
const defaultMatch = doorSource.match(/const mergeCmd = val\("merge-cmd"\) \?\? `([^`]*)`/)
const defaultTemplate = defaultMatch?.[1] ?? ""

test("the accept merge must land the bytes the verdict judged", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom902-"))
  const repo = join(tmp, "repo")
  mkdirSync(repo, { recursive: true })
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init", "-q", "-b", "main", ".")
  g("config", "user.email", "t@t.local")
  g("config", "user.name", "t")
  writeFileSync(join(repo, "a.txt"), "a\n")
  g("add", "-A")
  g("commit", "-qm", "base")
  const baseSha = g("rev-parse", "main").trim()
  g("checkout", "-qb", "feat")
  writeFileSync(join(repo, "a.txt"), "b\n")
  g("add", "-A")
  g("commit", "-qm", "feat")
  const judgedSha = g("rev-parse", "HEAD").trim()
  // a push lands WHILE the review runs: the PR's branch now points at
  // bytes no verdict judged
  writeFileSync(join(repo, "a.txt"), "c\n")
  g("add", "-A")
  g("commit", "-qm", "pushed-during-review")
  const currentHead = g("rev-parse", "HEAD").trim()

  const mergeCmd = defaultTemplate.replaceAll("${pr}", "42")
  const prog = join(tmp, "prog")
  cpSync(new URL("templates/pr-review", repoRoot), prog, { recursive: true })
  mkdirSync(join(prog, "data", "review"), { recursive: true })
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
  writeFileSync(
    join(prog, "data", "review", "config.sh"),
    [
      `REPO=${q(repo)}`,
      `BASE_BRANCH=${q("main")}`,
      `BASE_SHA=${q(baseSha)}`,
      `HEAD_BRANCH=${q("feat")}`,
      `HEAD_SHA=${q(judgedSha)}`,
      `TITLE=${q("PR #42")}`,
      `AUTHOR=${q("")}`,
      `MERGE_CMD=${q(mergeCmd)}`,
    ].join("\n") + "\n",
  )
  writeFileSync(join(prog, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", head: judgedSha, blocked: [] }))

  // the gh stub: `gh pr merge <n>` merges the PR's CURRENT remote head —
  // the stub records the sha it would land (the branch's current tip)
  const bin = join(tmp, "bin")
  mkdirSync(bin, { recursive: true })
  const ghStub = join(bin, "gh")
  const landed = join(tmp, "landed.txt")
  writeFileSync(
    ghStub,
    `#!/bin/sh
echo ${currentHead} > ${JSON.stringify(landed)}
exit 0
`,
  )
  chmodSync(ghStub, 0o755)

  // the merge gate's real seat: the job's run dir (not a git work tree)
  const taskDir = join(tmp, "sessions", "s1", "jobs", "j1", "run")
  mkdirSync(taskDir, { recursive: true })

  const r = spawnSync("bash", [join(prog, "hooks", "merge.sh")], {
    cwd: taskDir,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
  })
  // what the merge landed: the gh stub's record, or (local merge arm)
  // the judged sha by construction
  const mergedSha = existsSync(landed) ? readFileSync(landed, "utf8").trim() : judgedSha
  assert.equal(
    mergedSha,
    judgedSha,
    `the accept must land exactly the judged bytes (HEAD_SHA ${judgedSha.slice(0, 12)}); it landed ${mergedSha.slice(0, 12)} — unreviewed bytes rode the accept.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  )
  rmSync(tmp, { recursive: true, force: true })
})
