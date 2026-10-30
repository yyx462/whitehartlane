// momentum-903 — the path the door PROMISES (and the supervisor's bounded
// wait polls) must be a path the rail actually writes.
//
// The change adds two claims about one path:
//   - bin/whitehartlane:559: "verdict: will land at
//     <out>/data/review/verdict.json and as a comment on the PR"
//   - src/doors/ship-supervisor.ts:30 (the supervisor's step-2 wait, the
//     deterministic deadline mechanism): "V=<the staged
//     <runDir>/data/review/verdict.json path from step 3>; i=0; until
//     [ -f \"$V\" ]; do sleep 15; …"
//
// Where the rail writes the verdict: the verdict hook writes it at
// $prog/data/review/verdict.json (templates/pr-review/hooks/prove.sh:190)
// and $prog is the RUN dir — the staged COPY of the program under
// $AGENTIC_OS_HOME/sessions/<sid>/jobs/<jid>/run (src/doors/run.ts:123
// copyBeside: source → store, one way; the hooks execute in the store).
// Nothing copies it back into the staged --out program dir: the only
// copies in src/ are run.ts:123 (source→store), store.ts:1389-1392
// (manifest + hooks into the run dir) and review.ts:1027/1035-1037
// (the door's own materialization).
//
// So the door's promise is false and the supervisor's pinned wait polls a
// file that never appears: the wait burns its full 7200s deadline and
// then reports "verdict.json is ABSENT" on a PR whose verdict exists —
// the no-verdict comment (ship-supervisor.ts:32) replaces the verdict.
//
// The repro materializes a review program with the door's own
// prepareReview, stages it with the rail's own stageRun, writes the
// verdict where the rail writes it, and asserts the door's promised path
// carries it.
//
// BASE behaviour: the ship supervisor does not exist there (no module, no
// minted waiter, no such promise) — so on BASE this test passes.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"
import { stageRun } from "../../src/doors/run.ts"

const repoRoot = new URL("../../", import.meta.url)

test("the door's promised verdict path is a path the rail writes", async () => {
  // the supervisor is what waits on that path — BASE has no supervisor
  const supervisor = await import("../../src/doors/ship-supervisor.ts").catch(() => null)
  if (!supervisor) return // BASE shape: nothing waits on the verdict path

  const tmp = mkdtempSync(join(tmpdir(), "aos-mom903-"))
  const repo = join(tmp, "repo")
  mkdirSync(repo, { recursive: true })
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init", "-q", "-b", "main", ".")
  g("config", "user.email", "t@t.local")
  g("config", "user.name", "t")
  writeFileSync(join(repo, "code.ts"), "export const a = 1\n")
  g("add", "-A")
  g("commit", "-qm", "base")
  g("checkout", "-qb", "feat")
  writeFileSync(join(repo, "code.ts"), "export const a = 2\n")
  g("add", "-A")
  g("commit", "-qm", "feat")
  const headSha = g("rev-parse", "HEAD").trim()

  // the door's staged program dir (the --out the --auto mint uses)
  const out = join(tmp, "auto-reviews", "pr42-2026-10-30T00-00-00.000Z")
  const ready = prepareReview(
    { repo, base: "main", head: "feat", model: "acme/strong", out, title: "PR #42" },
    join(repoRoot.pathname, "templates"),
  )
  assert.ok(ready.ok, `the door must materialize the program: ${JSON.stringify(ready)}`)
  assert.equal(ready.skipped, false, `the door must NOT skip this diff: ${JSON.stringify(ready)}`)

  // the rail's own staging: the program is COPIED into the job's run dir
  const runDir = join(tmp, "sessions", "s1", "jobs", "j1", "run")
  stageRun(out, runDir)

  // the verdict hook's landing seat (templates/pr-review/hooks/prove.sh:190
  // — $prog is the RUN dir, where the hooks execute)
  mkdirSync(join(runDir, "data", "review"), { recursive: true })
  writeFileSync(join(runDir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", head: headSha, blocked: [] }))

  assert.ok(
    existsSync(join(runDir, "data", "review", "verdict.json")),
    "the rail writes the verdict at the job's run dir (prove.sh:190)",
  )

  // the supervisor's bounded wait watches the door's promised path
  const brief = supervisor.supervisorBrief({ levyCmd: "whl review '/repo' --unattended", runDir: out, pr: "42", repo })
  assert.ok(
    brief.includes(join(out, "data", "review", "verdict.json")),
    "the supervisor's bounded wait must watch the path the door promises",
  )

  assert.ok(
    existsSync(join(out, "data", "review", "verdict.json")),
    `the door promised the verdict at ${join(out, "data", "review", "verdict.json")} (bin/whitehartlane:559) and the supervisor's wait polls exactly that path (ship-supervisor.ts:30) — the rail must write it there`,
  )
  rmSync(tmp, { recursive: true, force: true })
})
