// momentum-3001 — THE TILING PROOF MUST EXIST ON BOTH MERGE ARMS.
//
// The change adds the CHAIN CHECK to the merge gate
// (templates/pr-review/hooks/merge.sh):
//
//   # THE CHAIN CHECK (the owner's convergence ruling, 2026-11-02):
//   # delta rounds judge only the commits since the last judged
//   # head; this sweep proves the TILING — folding the judged spans
//   # forward from BASE_SHA, the frontier must reach the judged
//   # head. Overlap is re-reading (sound); a GAP is bytes no verdict
//   # ever judged — refuse.
//   if [ -n "${JUDGED_SPANS:-}" ]; then
//     …
//     echo "merge: the judged spans leave a GAP — …" >&2
//     exit 1
//   fi
//
// It sits INSIDE the MERGE_CMD arm (merge.sh:141-165, the `if [ -n
// "${MERGE_CMD:-}" ]` block that starts at merge.sh:41). The gate has
// TWO merge arms:
//
//   arm A (MERGE_CMD set)   — merge.sh:41-191   → the chain check runs
//   arm B (MERGE_CMD empty) — merge.sh:192-209  → `git merge --no-ff
//                             HEAD_SHA` into the base branch, NO chain
//                             check at all
//
// arm B is not a rare path: the door writes `MERGE_CMD=${args.mergeCmd
// ?? ""}` (src/doors/review.ts:1180) and the plain levy passes
// `mergeCmd: val("merge-cmd")` (bin/whitehartlane:634) — undefined
// unless the operator typed --merge-cmd. So `whl review <repo>` (no
// --merge-cmd) runs arm B, and arm B lands base..head wholesale.
//
// The gap the chain check names — "bytes no verdict ever judged" — is
// EXACTLY what arm B lands: `git merge --no-ff HEAD_SHA` brings every
// commit between BASE_SHA and HEAD_SHA into the base branch, including
// the ones no verdict's span covered. The change's own claim ("a GAP is
// bytes no verdict ever judged — refuse") is false on that arm.
//
// The repro drives the REAL merge.sh twice on one fixture:
//   control — arm A (MERGE_CMD set): the GAP must be refused
//   subject — arm B (MERGE_CMD empty): the GAP must be refused too
//
// BASE behaviour: the base merge.sh has no chain check on either arm,
// so BOTH arms merge over the gap → the assertion fails on BASE and
// the diff touches templates/pr-review/hooks/merge.sh → the prove gate
// classifies this as an incomplete-fix (the new decision, half-landed).
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const MERGE_SH = join(ROOT, "templates", "pr-review", "hooks", "merge.sh")

test("the tiling proof (the GAP refusal) must guard BOTH merge arms — the local arm merges base..head", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom3001-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init -q -b main .")
    g("config user.email t@t.local")
    g("config user.name t")
    // base + three commits on the feature branch; the middle one
    // ("gap") is the commit no judged span covers
    for (const [i, body] of ["base", "one", "gap", "two"].entries()) {
      writeFileSync(join(repo, "src", `f${i}.ts`), `export const v${i} = "${body}"\n`)
      g("add -A")
      g(`commit -qm ${body}`)
      if (i === 0) g("checkout -qb feat")
    }
    const baseSha = g("rev-parse main").trim()
    const judgedHead = g("rev-parse feat").trim()
    const mid = (n: number) => g(`rev-parse feat~${n}`).trim()
    // base..base, then gap..head — the commit "one" AND the commit
    // "gap" sit outside every span: a GAP no verdict judged
    const gapSpans = `${baseSha}:${mid(3)} ${mid(1)}:${judgedHead}`

    const dirFor = (name: string, mergeCmd: string) => {
      const dir = join(tmp, name)
      mkdirSync(join(dir, "hooks"), { recursive: true })
      mkdirSync(join(dir, "data", "review"), { recursive: true })
      writeFileSync(join(dir, "hooks", "merge.sh"), readFileSync(MERGE_SH, "utf8"))
      writeFileSync(
        join(dir, "data", "review", "config.sh"),
        [
          `REPO='${repo}'`,
          `BASE_BRANCH='main'`,
          `BASE_SHA='${baseSha}'`,
          `HEAD_BRANCH='feat'`,
          `HEAD_SHA='${judgedHead}'`,
          `TITLE='t'`,
          `MERGE_CMD='${mergeCmd}'`,
          `JUDGED_SPANS='${gapSpans}'`,
          "",
        ].join("\n"),
      )
      writeFileSync(join(dir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", blocked: [] }))
      return dir
    }

    // ---- the CONTROL: arm A (MERGE_CMD set) — the arm that carries
    // the chain check. It must refuse the gap.
    const marker = join(tmp, "merged-a.txt")
    const control = spawnSync("bash", [join(dirFor("arm-a", `touch ${marker}`), "hooks", "merge.sh")], {
      cwd: tmp,
      encoding: "utf8",
      timeout: 60_000,
    })
    assert.notEqual(control.status, 0, `control (arm A): a GAP must refuse (stderr: ${control.stderr})`)
    assert.match(control.stderr, /GAP/, "control (arm A): the refusal names the gap")

    // ---- the SUBJECT: arm B (MERGE_CMD empty) — the local merge, the
    // arm `whl review` without --merge-cmd runs. It must refuse too.
    const subject = spawnSync("bash", [join(dirFor("arm-b", ""), "hooks", "merge.sh")], {
      cwd: tmp,
      encoding: "utf8",
      timeout: 60_000,
    })
    const trunkNow = execSync("git rev-parse main", { cwd: repo, encoding: "utf8" }).trim()
    assert.notEqual(
      subject.status,
      0,
      `INV-3: the local merge arm (MERGE_CMD empty — the plain \`whl review\` path, bin/whitehartlane:634 passes no merge-cmd) has NO chain check: it merged base..head wholesale (main is now ${trunkNow}, the trunk was ${baseSha}) over a GAP no verdict judged. The chain check lives only in the MERGE_CMD arm (merge.sh:141-165); the local arm (merge.sh:192-209) lands the unjudged commits. stderr: ${subject.stderr}`,
    )
    assert.match(subject.stderr, /GAP/, "the refusal names the gap")
    assert.equal(trunkNow, baseSha, "nothing merged over the gap")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
