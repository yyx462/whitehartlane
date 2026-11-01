// tests-10201 (tests lens) — THE MERGE STAGE'S OUTCOME SEAT IS SILENT ON
// THE ONE EXIT THAT CANNOT READ THE VERDICT.
//
// WHAT THE CHANGE CLAIMS (templates/pr-review/hooks/merge.sh:28-31):
//
//   # EVERY exit writes the seat (momentum-909): the nine refusal paths
//   # left the watcher's seat empty and the PR heard "unknown" — the
//   # commission's end is a FACT, whatever the end was.
//
// and the diff builds the seat with a trap (merge.sh:17-26, 37-38):
//
//   outcome() { … printf '%s\n' "$payload" >"$seat" … }
//   node -e '…read verdict.json…' "$prog/data/review/verdict.json" \
//     | { read -r verdict
//   MERGE_OUTCOME=refused
//   trap 'outcome "$MERGE_OUTCOME"' EXIT
//   case "$verdict" in … esac; }
//
// THE TRAP IS INSTALLED INSIDE the pipeline's right-hand subshell — and
// it is installed AFTER `read -r verdict` (merge.sh:33-38), which is the
// FIRST command of that subshell. The script runs under
// `set -euo pipefail` (merge.sh:7).
//
// So when the verdict cannot be READ (the file is absent, empty, or not
// JSON), the LEFT side of the pipe (`node -e`) exits non-zero, the
// right side's `read` hits EOF and returns 1, and `set -e` kills the
// subshell BEFORE the trap exists. The pipeline's status is non-zero,
// the script exits, and NO outcome is written — to the run dir's
// merge.json NOR to the STAGED_DIR seat the watcher polls.
//
// THE CONSEQUENCE (src/doors/ship-supervisor.ts:130-155, the watcher the
// diff adds): the watcher waits on `$OUT/data/review/merge.json` and,
// after 7200 one-second ticks, posts "ship-gate: the review timed out
// (2h) — no outcome landed" to the PR. The BACKSTOP's fallback reads the
// VERDICT seat — which is exactly the file that could not be read — so
// the outcome is fabricated as "unfinished". A commission that ended in
// milliseconds is reported to the PR as a two-hour timeout.
//
// The repro drives the REAL template hook at its REAL seat with a
// verdict.json that cannot be read. The control (a valid reject) must
// still write "reject" at the same seat.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const TEMPLATES = join(import.meta.dirname, "..", "..", "templates")
const MERGE_HOOK = join(TEMPLATES, "pr-review", "hooks", "merge.sh")

// A staged program dir with the hook at its real seat: the hook resolves
// `prog` as its own parent, so the program's data/ must sit beside it.
function stagedProgram(verdictBytes: string | null) {
  const tmp = mkdtempSync(join(tmpdir(), "aos-t10201-"))
  const prog = join(tmp, "prog")
  const staged = join(tmp, "staged")
  const repo = join(tmp, "repo")
  mkdirSync(join(prog, "hooks"), { recursive: true })
  mkdirSync(join(prog, "data", "review"), { recursive: true })
  mkdirSync(join(staged, "data", "review"), { recursive: true })
  mkdirSync(repo, { recursive: true })
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init", "-q", "-b", "main", ".")
  g("config", "user.email", "t@t.local")
  g("config", "user.name", "t")
  writeFileSync(join(repo, "base.txt"), "base\n")
  g("add", "-A")
  g("commit", "-qm", "base")
  const baseSha = g("rev-parse", "main").trim()
  g("checkout", "-qb", "feat")
  writeFileSync(join(repo, "feat.txt"), "feat\n")
  g("add", "-A")
  g("commit", "-qm", "feat")
  const headSha = g("rev-parse", "feat").trim()
  g("checkout", "-q", "main")
  writeFileSync(join(prog, "hooks", "merge.sh"), readFileSync(MERGE_HOOK, "utf8"))
  writeFileSync(
    join(prog, "data", "review", "config.sh"),
    [
      `REPO='${repo}'`,
      `BASE_BRANCH='main'`,
      `BASE_SHA='${baseSha}'`,
      `HEAD_BRANCH='feat'`,
      `HEAD_SHA='${headSha}'`,
      `TITLE='t'`,
      `AUTHOR=''`,
      `MERGE_CMD=''`,
      `PR_NUM=''`,
      `STAGED_DIR='${staged}'`,
      "",
    ].join("\n"),
  )
  if (verdictBytes !== null) writeFileSync(join(prog, "data", "review", "verdict.json"), verdictBytes)
  return { tmp, prog, staged }
}

const runHook = (prog: string) =>
  spawnSync("bash", [join(prog, "hooks", "merge.sh")], {
    cwd: prog,
    encoding: "utf8",
    env: { ...process.env, PATH: process.env.PATH ?? "" },
  })

const seat = (staged: string) => join(staged, "data", "review", "merge.json")

test("tests-10201: a merge stage that cannot read the verdict STILL writes its outcome at the watcher's seat", () => {
  const cases: Array<[string, string | null]> = [
    ["the verdict file is ABSENT", null],
    ["the verdict file is EMPTY", ""],
    ["the verdict file is not JSON", "not json {"],
  ]
  for (const [what, bytes] of cases) {
    const { tmp, prog, staged } = stagedProgram(bytes)
    try {
      const r = runHook(prog)
      assert.notEqual(r.status, 0, `${what}: the merge stage must not accept (stdout: ${r.stdout})`)
      assert.ok(
        existsSync(seat(staged)),
        `${what}: the merge stage ENDED (exit ${r.status}) but wrote NO outcome at the seat the watcher polls ` +
          `(STAGED_DIR/data/review/merge.json) — the diff's own claim is "EVERY exit writes the seat … the ` +
          `commission's end is a FACT, whatever the end was" (merge.sh:28-31).\n` +
          `The trap is installed INSIDE the pipeline's right-hand subshell and only AFTER \`read -r verdict\` ` +
          `(merge.sh:33-38); with \`set -euo pipefail\` (merge.sh:7) a failed verdict read kills the subshell ` +
          `before the trap exists, so the outcome is never written.\n` +
          `stderr: ${r.stderr.slice(-400)}`,
      )
      const marker = JSON.parse(readFileSync(seat(staged), "utf8").trim())
      assert.equal(marker.outcome, "refused", `${what}: the outcome must name the refusal`)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }
})

test("tests-10201 CONTROL: a valid reject still writes 'reject' at the same seat", () => {
  const { tmp, prog, staged } = stagedProgram(JSON.stringify({ verdict: "reject", blocked: [{ id: "a-1" }] }))
  try {
    const r = runHook(prog)
    assert.notEqual(r.status, 0, "a reject fails the chain honestly")
    assert.ok(existsSync(seat(staged)), "the reject arm writes the outcome at the seat")
    const marker = JSON.parse(readFileSync(seat(staged), "utf8").trim())
    assert.equal(marker.outcome, "reject")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
