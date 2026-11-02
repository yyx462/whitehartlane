// momentum-3004 — the verdict must RECORD the span its round read.
//
// The change's spine is the judgedFrom stamp: a delta round reads only
// the commits since the last judged head, and the verdict has to say
// so, because two readers depend on it.
//
// 1. the door's chain hand-down (src/doors/review.ts:1124-1127):
//
//      const judgedSpansHandDown = [
//        ...priorsOldestFirst.map((r) => `${r.verdict.judgedFrom ?? r.verdict.base}:${r.verdict.head}`),
//        `${spanFrom}:${headSha}`,
//      ].join(" ")
//
//    — with the stamp missing, every PRIOR verdict contributes its
//    FULL base..head span, whatever the round actually read. The
//    merge gate then folds a list of overclaimed ranges, so the GAP
//    check (merge.sh:141-165 — "a GAP is bytes no verdict ever judged
//    — refuse") is built on claims no round ever made.
//
// 2. the door's span resolution (src/doors/review.ts:769-778):
//    `spanFrom = priorOther?.verdict.head ?? priorSame?.verdict.judgedFrom ?? baseSha`
//    — the re-levy arm (priorSame) needs the stamp.
//
// The stamp is written by the prove stage:
//
//   templates/pr-review/hooks/prove.sh:19-20
//     . "$prog/data/review/config.sh"
//     export REPO BASE_SHA HEAD_SHA PROG="$prog"
//   templates/pr-review/hooks/prove.sh:180
//     judgedFrom: process.env.JUDGED_SPAN_FROM,
//
// JUDGED_SPAN_FROM is a plain shell variable in the generated config
// (src/doors/review.ts:1167 writes `JUDGED_SPAN_FROM=…`; the real
// config.sh of the live run shows it unexported) and the prove stage's
// node program is a HEREDOC (`node <<'EOF'`) — it sees the shell's
// ENVIRONMENT, not the shell's variables. prove.sh exports exactly
// four names (REPO, BASE_SHA, HEAD_SHA, PROG) and JUDGED_SPAN_FROM is
// not among them.
//
// So `process.env.JUDGED_SPAN_FROM` is undefined, the verdict's
// judgedFrom is undefined, and JSON.stringify drops the field: EVERY
// verdict this change writes says nothing about what it read, while
// still claiming base..head in `base`.
//
// The repro runs the REAL prove.sh on a fixture program dir whose
// config carries JUDGED_SPAN_FROM, then reads the verdict it wrote
// and applies the door's own hand-down formula to it.
//
// BASE behaviour: the base prove.sh has no judgedFrom at all → the
// assertion fails on BASE too, and the diff touches
// templates/pr-review/hooks/prove.sh → the prove gate classifies this
// as an incomplete-fix.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const PROVE_SH = join(ROOT, "templates", "pr-review", "hooks", "prove.sh")

const BASE_SHA = "ef3d35f91ef97d22ecdc73aa5ee83e267a43462e"
const HEAD_SHA = "c8a8e46280557d49cb0c95a6800cb24ed6ac6274"
const SPAN_FROM = "c1a8a19256f756dfa9eebe8a6470699cacaa11ba"

test("the verdict must record the span its round read (judgedFrom) — the stamp never lands", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom3004-"))
  try {
    const prog = join(tmp, "prog")
    mkdirSync(join(prog, "hooks"), { recursive: true })
    mkdirSync(join(prog, "data", "review", "head"), { recursive: true })
    mkdirSync(join(prog, "data", "review", "base"), { recursive: true })
    mkdirSync(join(prog, "units", "momentum"), { recursive: true })
    writeFileSync(join(prog, "units", "momentum", "findings.jsonl"), "")
    writeFileSync(join(prog, "data", "review", "files-all.txt"), "src/doors/review.ts\n")
    writeFileSync(join(prog, "hooks", "prove.sh"), readFileSync(PROVE_SH, "utf8"))
    // the generated config, exactly as the door writes it
    writeFileSync(
      join(prog, "data", "review", "config.sh"),
      [
        `REPO='${tmp}'`,
        `BASE_BRANCH='master'`,
        `BASE_SHA='${BASE_SHA}'`,
        `HEAD_BRANCH='auto-ship-gate'`,
        `HEAD_SHA='${HEAD_SHA}'`,
        `JUDGED_SPAN_FROM='${SPAN_FROM}'`,
        `JUDGED_SPANS='${BASE_SHA}:${SPAN_FROM} ${SPAN_FROM}:${HEAD_SHA}'`,
        "",
      ].join("\n"),
    )

    const r = spawnSync("bash", [join(prog, "hooks", "prove.sh")], { cwd: tmp, encoding: "utf8", timeout: 60_000 })
    assert.equal(r.status, 0, `prove must produce a verdict (stdout: ${r.stdout}; stderr: ${r.stderr})`)
    const seat = join(prog, "data", "review", "verdict.json")
    assert.ok(existsSync(seat), "prove wrote the verdict seat")
    const verdict = JSON.parse(readFileSync(seat, "utf8")) as { base?: string; head?: string; judgedFrom?: string }

    assert.equal(
      verdict.judgedFrom,
      SPAN_FROM,
      `INV-4: the verdict says NOTHING about the span it read — judgedFrom is ${JSON.stringify(verdict.judgedFrom)}, expected ${SPAN_FROM}. prove.sh:20 exports only REPO, BASE_SHA, HEAD_SHA, PROG; JUDGED_SPAN_FROM is a plain shell variable in the sourced config and the prove stage's node program is a heredoc, so process.env.JUDGED_SPAN_FROM (prove.sh:180) is undefined and JSON.stringify drops the field. The verdict still claims base..head, so the door's chain hand-down (src/doors/review.ts:1125 — \`\${r.verdict.judgedFrom ?? r.verdict.base}:\${r.verdict.head}\`) falls back to the FULL span for every prior and the merge gate's GAP proof is built on ranges no round read.`,
    )

    // the door's own reader, applied to the verdict that was written:
    // the hand-down span of this round must be its DELTA, not base..head
    const handDownSpan = `${verdict.judgedFrom ?? verdict.base}:${verdict.head}`
    assert.notEqual(
      handDownSpan,
      `${verdict.base}:${verdict.head}`,
      `the chain hand-down must be able to say "this round read only ${SPAN_FROM}..${HEAD_SHA}" — it says ${handDownSpan}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
