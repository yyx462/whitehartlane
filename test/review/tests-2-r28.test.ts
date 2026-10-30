// tests-2 — the ship door's success receipt claims the overrule receipt
// reached the PR even when the post FAILED.
//
// What the diff claims (src/doors/ship.ts:14-15, bin/whitehartlane):
//   "never stealth       the overrule is ledgered and posted to the PR"
//   and the door's own success line:
//   "ship: PR #<n> merged under override — <k> finding(s) overruled
//    (round <r>), receipt on the PR, ledger row written"
//
// The code (bin/whitehartlane, the ship verb):
//   const c = ghPrComment(pr, repoAbs, overruleComment({...}))
//   if (!c.ok) console.error(`ship: merged, but the overrule receipt did
//     not reach PR #${pr} (${c.out...}) — the ledger row stands`)
//   console.log(`ship: PR #${pr} merged under override — ... receipt on
//     the PR, ledger row written`)
//
// ghPrComment returns {ok:false} whenever `gh pr comment` fails — a
// reachable path (an expired gh auth, a network blip, a repo the token
// cannot comment on). The door then prints the failure on STDERR and
// exits 0 with a stdout line that asserts the OPPOSITE: "receipt on the
// PR". A caller that reads stdout (a script, the owner skimming the
// terminal) believes the PR was told; the PR itself carries no overrule
// receipt at all — the reviewers' blocked findings were overruled with
// NO PUBLIC RECORD, which is the one thing the feature exists to
// prevent.
//
// The repro drives the real `whl ship` door end-to-end: a real repo, two
// reject rounds for its head, a real overrule file answering every
// blocked finding, and a gh stub whose `pr comment` FAILS.
//
// BASE behaviour: no `ship` verb at all — on BASE this test fails to
// load the door (the command is unknown), which the prove gate reads as
// "fails on BASE"; the diff touches the door, so the finding classifies
// as incomplete-fix.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const REPO_ROOT = resolve(import.meta.dirname, "..", "..")
const BIN = join(REPO_ROOT, "bin", "whitehartlane")

test("tests-2: the ship door must not claim the receipt reached the PR when it did not", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-tests2-"))
  const home = join(tmp, "home")
  const repo = join(tmp, "repo")
  mkdirSync(join(repo, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
  g("add -A && git commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
  g("add -A && git commit -qm feat")
  const headSha = g("rev-parse HEAD").trim()
  // two reject rounds on this head
  for (const sid of ["s-r1", "s-r2"]) {
    const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "verdict.json"),
      JSON.stringify({ verdict: "reject", head: headSha, blocked: [{ id: "m-1", severity: "P1", claim: "asserts the wrong requirement" }] }),
    )
  }
  // the gh stub: `pr view` answers the boundary probe with the judged
  // head; `pr comment` FAILS (expired auth / no comment permission)
  const gh = join(tmp, "gh")
  writeFileSync(
    gh,
    [
      "#!/bin/sh",
      `case "$1 $2" in`,
      `  "pr view") echo ${JSON.stringify(headSha)} ;;`,
      `  "pr comment") echo "gh: could not create comment: no permission" >&2; exit 1 ;;`,
      `  *) echo "gh: not authorised" >&2; exit 1 ;;`,
      `esac`,
      "exit 0",
      "",
    ].join("\n"),
  )
  chmodSync(gh, 0o755)
  const overrule = join(tmp, "o.json")
  writeFileSync(overrule, JSON.stringify({ "m-1": "the repro asserts the wrong requirement — the owner knows the intent" }))
  const env = {
    ...process.env,
    AGENTIC_OS_HOME: home,
    WHL_GATE_LEDGER: join(home, "gate.jsonl"),
    PATH: `${tmp}:${process.env.PATH ?? ""}`,
  }
  const mergeCmd = `echo merged >> ${JSON.stringify(join(tmp, "merge-happened.txt"))}`
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", BIN, "ship", repo, "--pr", "42", "--overrule", overrule, "--head", "feat", "--base", "main", "--merge-cmd", mergeCmd],
    { env, encoding: "utf8", timeout: 120_000 },
  )
  // the merge itself is not the subject; the RECEIPT is
  assert.ok(existsSync(join(tmp, "merge-happened.txt")), `the merge ran (stdout: ${r.stdout}\nstderr: ${r.stderr})`)
  assert.match(r.stderr, /did not reach PR #42/, "the door knows the receipt failed")
  assert.doesNotMatch(
    r.stdout,
    /receipt on the PR/,
    `the door's success line claims the overrule receipt is on the PR while the post FAILED — the PR carries no record of the override (the whole point of the feature).\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
  )
  rmSync(tmp, { recursive: true, force: true })
})
