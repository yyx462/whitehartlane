// principles-109 — "is a seat OUTPUT or INPUT?" is ONE decision, asked at
// TWO roots.
//
// The change makes the verdict/merge seats output-only, so a seat can never
// move a program's identity (src/doors/project.ts:101-137,
// contentHashOf). The neutrality is implemented as a hardcoded skip set:
//
//   const skip = new Set(["data/review/verdict.json", "data/review/merge.json", ...exclude])
//
// Those paths are ROOT-RELATIVE to the directory passed in. But the repo has
// TWO hash sites with DIFFERENT roots:
//
//   A. src/doors/run.ts:461 (book)  — root = the PROGRAM dir
//        contentHashOf(dir, ["data/review/verdict.json"])
//        → the skip set's "data/review/merge.json" MATCHES → neutral.
//
//   B. src/doors/run.ts:220 (copyBeside) — root = source/DATA
//        contentHashOf(join(source, "data"), ["review/verdict.json"])
//        → the skip set's "data/review/merge.json" does NOT match
//          (the relative path there is "review/merge.json"); only
//          "review/verdict.json" is excluded, by the explicit arg.
//
// So the merge marker is neutral at site A and NOT neutral at site B. The
// marker lands in the staged program dir (templates/pr-review/hooks/merge.sh
// writes $STAGED_DIR/data/review/merge.json, and STAGED_DIR is that dir).
// A re-levy of the same program dir therefore computes a DIFFERENT
// identity.data than the prior run's marker — the fold's "same program?"
// judgment flips and the settled fold re-runs every lens (the exact harm
// the change's own comment at src/doors/project.ts:104-108 claims to
// prevent: "it must be just as neutral").
//
// The repro drives the REAL stageRun (the real copyBeside, the real
// contentHashOf) and asserts the identity marker does not move when the
// merge marker appears in the program dir.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { stageRun } from "../../src/doors/run.ts"

test("principles-109: the merge marker is output at EVERY hash site — the identity must not move", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-principles-109-"))
  try {
    const prog = join(tmp, "prog")
    mkdirSync(join(prog, "data", "review"), { recursive: true })
    mkdirSync(join(prog, "hooks"), { recursive: true })
    writeFileSync(join(prog, "workflow.toml"), '[workflow]\nname = "p"\nworker_kind = "opencode"\n')

    // run 1: the program dir as the door hands it over
    const store1 = join(tmp, "store1")
    stageRun(prog, store1)
    const before = JSON.parse(readFileSync(join(store1, ".whl-program"), "utf8"))

    // the merge stage lands its outcome marker in the staged program dir
    // (merge.sh: `local seat="${STAGED_DIR:-$prog}/data/review/merge.json"`)
    writeFileSync(join(prog, "data", "review", "merge.json"), '{"outcome":"accept","head":"abc"}\n')

    // run 2: the re-levy of the SAME program dir
    const store2 = join(tmp, "store2")
    stageRun(prog, store2)
    const after = JSON.parse(readFileSync(join(store2, ".whl-program"), "utf8"))

    assert.equal(
      before.data,
      after.data,
      "the merge marker is OUTPUT, never input — it must not move the program's identity " +
        "(the fold's 'same program?' judgment compares exactly this field; when it moves, the " +
        "settled fold re-runs every lens). The neutrality is a hardcoded skip set whose paths are " +
        "root-relative (src/doors/project.ts:109), but copyBeside hashes with root = source/DATA " +
        "(src/doors/run.ts:220), where the relative path is 'review/merge.json' — so the marker is " +
        "neutral at the book() site and NOT neutral here.",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
