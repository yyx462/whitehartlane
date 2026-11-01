// momentum-111 — the accept lands on a branch NOBODY named: the door
// throws away the reviewer's base branch and substitutes an alphabetical
// guess, so the merge stage merges the judged head into a leftover branch
// while the trunk never advances — and the receipt says "merged".
//
// WHERE THE NAME IS LOST (the production path, not the door's unit test):
//
//   bin/whitehartlane (the review door):
//     base: gateBaseSha ?? val("base")        <- momentum-300's hand-down
//
//   src/doors/review.ts (prepareReview):
//     `BASE_BRANCH=${shellQuote(args.baseBranch ?? (/^[0-9a-f]{7,40}$/.test(base)
//        ? branchOf(baseSha) ?? "" : base))}`
//
// The gate runs FIRST (the default: WHL_GATE is not "off"), so `base`
// arrives at prepareReview as the gate's BASE COMMIT SHA — the sha-like
// branch of the ternary. `branchOf(baseSha)` answers "which LOCAL branch
// points at this sha NOW", read in `for-each-ref` order (ALPHABETICAL) —
// not "which branch the reviewer named". `args.baseBranch` HAS NO
// PRODUCER: the door passes only `headBranch: val("head-branch")` and
// there is no `--base-branch` flag, so the "caller's name first" arm of
// the ternary is dead code.
//
// The rename-era repo is the common shape: `main` and `master` sit at the
// SAME base commit (the trunk is one of them; the other is a leftover).
// `for-each-ref` lists them alphabetically, so "main" wins over "master"
// every time and the reviewer's name is discarded.
//
// THE HARM (templates/pr-review/hooks/merge.sh:137-139, the local arm):
//
//   git -C "$REPO" checkout -q "$BASE_BRANCH"
//   git -C "$REPO" merge --no-ff --no-edit -m "pr-review: accept $TITLE" "$HEAD_SHA"
//
// The base-drift guard above it (merge.sh:128-136) CANNOT catch this: the
// wrong branch points at BASE_SHA by construction (branchOf chose it FOR
// that reason), so `now_base == BASE_SHA` and the guard passes.
//
// THE CHANGE'S OWN CLAIM is the opposite of what it does
// (src/doors/review.ts:1102-1109):
//
//   "the BASE rides as the BRANCH NAME — the CALLER'S name first
//    (principles-5103 / questions-31) ... The operator's ref IS the
//    honest name"
//
// and the HEAD commit says "BASE/HEAD name the caller's branch first".
// For BASE the caller's name is never used.
//
// The repro drives the REAL DOOR (bin/whitehartlane — the way every
// review is levied: `whl review <repo> --base master --head feat`) over a
// rename-era fixture, then the REAL merge stage (the materialized
// merge.sh) with an accept verdict, and asserts the only thing that
// matters: THE TRUNK THE REVIEWER NAMED CARRIES THE ACCEPTED HEAD.
//
// BASE behaviour: BASE wrote `BASE_BRANCH=${shellQuote(base)}` — the
// reviewer's own ref verbatim — so the accept advances "master" and the
// assertion PASSES there.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"

const REPO_ROOT = join(import.meta.dirname, "..", "..")
const BIN = join(REPO_ROOT, "bin", "whitehartlane")

test("momentum-111: the accept must advance the base branch the reviewer named", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "m111-base-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" })
    g("init", "-q", "-b", "master", ".")
    g("config", "user.email", "t@t.local")
    g("config", "user.name", "t")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
    g("add", "-A")
    g("commit", "-qm", "base")
    // the rename-era shape: main AND master at the SAME base commit —
    // "master" is the trunk, "main" is a leftover that sorts FIRST
    g("branch", "main")
    g("checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 2\n")
    g("add", "-A")
    g("commit", "-qm", "feat")
    const headSha = g("rev-parse", "feat").trim()

    // a no-op orchestrator stub — a scratch drive must never book a real
    // workflow (the leaked-lens receipt, 2026-10-30)
    const stub = join(tmp, "orch-stub.mjs")
    writeFileSync(
      stub,
      `import { writeFileSync } from "node:fs"\nwriteFileSync(${JSON.stringify(join(tmp, "stub-ran.txt"))}, "ok")\n`,
    )

    // THE REAL DOOR — the reviewer names the base branch: "master"
    const out = join(tmp, "prog")
    const home = join(tmp, "home")
    mkdirSync(home, { recursive: true })
    const env = {
      ...process.env,
      AGENTIC_OS_HOME: home,
      AGENTIC_OS_ORCHESTRATOR: stub,
      WHL_GATE_LEDGER: join(tmp, "ledger.jsonl"),
      AGENTIC_OS_NOTIFY: "0",
    }
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--base", "master", "--head", "feat", "--model", "acme/m", "--out", out, "--unattended"],
      { env, encoding: "utf8", timeout: 120_000 },
    )
    assert.equal(r.status, 0, `the door must materialize the program (stdout: ${r.stdout}\nstderr: ${r.stderr})`)
    assert.ok(existsSync(join(out, "data", "review", "config.sh")), "the door must write the program config")

    const cfg = readFileSync(join(out, "data", "review", "config.sh"), "utf8")
    const named = cfg.match(/^BASE_BRANCH='(.*)'$/m)?.[1]
    assert.equal(
      named,
      "master",
      `the config must name the base branch the reviewer named ("master"), got '${named}'.\n` +
        `src/doors/review.ts:1110 derives BASE_BRANCH with branchOf(baseSha) — the FIRST branch "for-each-ref --points-at" lists at the base sha (an alphabetical guess); args.baseBranch has no producer.\n` +
        `bin/whitehartlane hands the door the gate's base SHA ("base: gateBaseSha ?? val("base")"), so the sha-like arm of the ternary is always taken and the reviewer's --base name is discarded.`,
    )

    // the verdict the prove stage writes, then the REAL merge stage
    const seat = join(out, "data", "review", "verdict.json")
    let verdictPath = seat
    try {
      if (lstatSync(seat).isSymbolicLink()) verdictPath = resolve(dirname(seat), readlinkSync(seat))
    } catch {
      /* no seat yet — write the plain path */
    }
    mkdirSync(dirname(verdictPath), { recursive: true })
    writeFileSync(verdictPath, JSON.stringify({ verdict: "accept", head: headSha, blocked: [] }))
    const receipt = execFileSync("bash", [join(out, "hooks", "merge.sh")], {
      cwd: tmp,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })

    const carries = (branch: string): boolean => {
      try {
        execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", headSha, branch], { stdio: "ignore" })
        return true
      } catch {
        return false
      }
    }

    assert.ok(
      carries("master"),
      `the accept must advance the base branch the reviewer named ("master") — it did not.\n` +
        `The config named BASE_BRANCH='${named}' (the alphabetical guess, not the reviewer's name; args.baseBranch has no producer).\n` +
        `The merge stage checks out BASE_BRANCH and merges the judged head into it (templates/pr-review/hooks/merge.sh:137-139), and its base-drift guard (merge.sh:128-136) cannot catch it — the wrong branch points at BASE_SHA by construction. So the accept landed on '${named}' while the trunk never advanced, and the receipt still said:\n${receipt}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
