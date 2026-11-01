// questions-34 (questions lens, Q2/Q5/Q9) — THE SHIP DOOR IS A SECOND
// MERGE SITE THAT DROPS THE BASE-DRIFT GUARD.
//
// This change adds `whl ship` (bin/whitehartlane:707-837): the fixer's
// right to reject a rejection. After the owner's overrule passes, the
// door runs the merge command itself:
//
//   bin/whitehartlane:821-828
//     const mergeCmd = sVal("merge-cmd") ?? `gh pr merge ${pr} --merge …`
//     try {
//       execFileSync("sh", ["-c", mergeCmd], { cwd: repoAbs, … })
//     } catch (err) { … }
//
// `gh pr merge <n> --merge` merges the PR into its BASE branch — the
// same operation the rail's own merge stage performs, and the same
// operation merge.sh guards with FOUR checks before handing the merge
// over (templates/pr-review/hooks/merge.sh:44-116):
//
//   · the head branch's tip must still be the judged sha (merge.sh:56-66)
//   · no ref that pointed at the judged sha may have moved (merge.sh:74-85)
//   · the PR's REMOTE head must be the judged sha (merge.sh:86-96)
//   · THE BASE'S HALF (principles-108): the base branch must still be
//     at BASE_SHA — "a base that moved during the review lands
//     unreviewed commits inside the accepted merge" (merge.sh:97-116)
//
// The ship door keeps the HEAD half only:
//
//   bin/whitehartlane:783-799
//     // NEVER STALE BYTES AT THE MERGE BOUNDARY (momentum-500,
//     // principles-16, tests-10011): the verdict judged one sha;
//     // `gh pr merge <n>` merges the PR's CURRENT remote head. Verify
//     // the two are the same bytes at the last possible seat — and a
//     // query failure refuses (unverified is unmerged; the fail-safe
//     // direction)
//     let prHead = ""
//     try { prHead = execFileSync("gh", ["pr", "view", pr, …]) … } catch { prHead = "" }
//     const judgedSha = check.verdict.head ?? headSha
//     if (prHead !== judgedSha) { …refuse… }
//
// and the door has no idea what base the review judged: it computes
// `baseSha` from the CURRENT tip of the base branch (bin/whitehartlane:
// 750-757), so a base that moved during the review is invisible to it.
//
// THE HARM: the same PR, the same review, two answers to one question
// ("may these unreviewed bytes ride the merge?"). The rail's merge
// stage refuses a moved base; the override door merges it — and the
// merge lands the base's new (unreviewed) commits inside the accepted
// merge. The base's half was a PRIOR round's finding (principles-108);
// the new merge site is the twin that was left unguarded.
//
// The repro drives the REAL door (`whl ship`) over a fixture repo whose
// base branch MOVES after the review (the reachable path: a review
// takes tens of minutes, the trunk moves), with a gh stub that reports
// the PR's remote head as the judged sha (the head half passes) and a
// merge command that records the merge. It asserts the door refuses.
//
// BASE behaviour: `whl ship` does not exist on BASE (the whole override
// door is introduced by this diff) → the door refuses/does not exist →
// no merge happens → the assertion PASSES on BASE, so the prove gate
// classifies this as introduced.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const HEAD = join(import.meta.dirname, "..", "..")
const BIN = join(HEAD, "bin", "whitehartlane")

test("the ship door must not merge when the base moved since the review", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-q34-"))
  const home = join(tmp, "home")
  const repo = join(tmp, "repo")
  const merged = join(tmp, "merged.txt")
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" })
    g("init", "-q", "-b", "main", ".")
    g("config", "user.email", "t@t.local")
    g("config", "user.name", "t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    g("add", "-A")
    g("commit", "-qm", "base")
    g("checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    g("add", "-A")
    g("commit", "-qm", "feat")
    const headSha = g("rev-parse", "HEAD").trim()

    // two reject rounds on this head (good faith first — the exit opens
    // at round 2)
    for (const sid of ["s-r1", "s-r2"]) {
      const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, "verdict.json"),
        JSON.stringify({
          verdict: "reject",
          repo,
          head: headSha,
          blocked: [{ id: "m-1", severity: "P1", claim: "asserts the wrong requirement" }],
        }),
      )
    }

    // the gh stub: the PR's remote head IS the judged sha (the head
    // half passes — only the base half is missing)
    const bin = join(tmp, "bin")
    mkdirSync(bin, { recursive: true })
    const gh = join(bin, "gh")
    writeFileSync(gh, `#!/bin/sh\ncase "$1 $2" in "pr view") echo ${headSha} ;; esac\nexit 0\n`)
    chmodSync(gh, 0o755)

    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "m-1": "the repro asserts the wrong requirement" }))

    // THE BASE MOVES after the review: the trunk takes a commit while
    // the review is still running (the reachable path).
    g("checkout", "-q", "main")
    writeFileSync(join(repo, "src", "other.ts"), "export const other = 1\n")
    g("add", "-A")
    g("commit", "-qm", "trunk moved while the review ran")
    const movedBase = g("rev-parse", "main").trim()

    const env = {
      ...process.env,
      AGENTIC_OS_HOME: home,
      AGENTIC_OS_NOTIFY: "0",
      WHL_GATE_LEDGER: join(tmp, "gate.jsonl"),
      PATH: `${bin}:${process.env.PATH ?? ""}`,
    }
    const r = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        BIN,
        "ship",
        repo,
        "--pr",
        "42",
        "--overrule",
        overrule,
        "--head",
        "feat",
        "--base",
        "main",
        "--merge-cmd",
        `echo merged >> ${JSON.stringify(merged)}`,
      ],
      { env, encoding: "utf8", timeout: 60_000 },
    )

    assert.equal(
      existsSync(merged),
      false,
      `the ship door MERGED a PR whose base moved during the review (base ${movedBase.slice(0, 8)}) — unreviewed base commits rode the merge.\n` +
        `The rail's own merge stage refuses exactly this (templates/pr-review/hooks/merge.sh:97-116, "THE BASE'S HALF (principles-108)": "a base that moved during the review lands unreviewed commits inside the accepted merge … refuse rather than merge blind"), and the ship door keeps only the HEAD half (bin/whitehartlane:783-799).\n` +
        `door exit=${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
