// principles-3003 (finding principles-3) — A DELTA ROUND MUST NOT
// NARROW THE READING PAST A VERDICT THAT REJECTED.
//
// The change makes each round judge only the commits since the LAST
// JUDGED HEAD (src/doors/review.ts:769-778):
//
//   const priors = verdictsForBranch(repo, headSha, { base: baseSha })
//   const priorOther = priors.find((r) => r.verdict.head !== headSha)
//   const priorSame = priors.find((r) => r.verdict.head === headSha)
//   spanFrom = priorOther?.verdict.head ?? priorSame?.verdict.judgedFrom ?? baseSha
//
// The span is the last judged head — WHATEVER that verdict SAID. A
// verdict that REJECTED (the P0 the rail proved, with a repro that
// fails on HEAD) narrows the next round exactly as much as an ACCEPT
// does, so the bytes that verdict blocked are never read again.
//
// Nothing downstream notices:
//   - merge.sh reads ONE verdict (the current round's) and merges
//     base..head — the whole branch, not the span;
//   - merge.sh's chain check (the new JUDGED_SPANS sweep) folds the
//     SPAN BOUNDARIES only — it never looks at a span's verdict, so a
//     rejected span counts as judged-and-tiled and passes the sweep;
//   - the stop rule's hand-down (STOP_HISTORY) carries the prior rounds'
//     buckets and P0 flags, but the merge stage reads it only in its
//     REJECT arm (merge.sh:228) — the accept arm ignores them.
//
// So the branch merges with the rejected bytes in it: the P0 the rail
// proved lands because the round that could have re-read it never saw
// it.
//
// INV-4 (verdicts are honest): the accept verdict the merge boundary
// acts on does not cover the bytes it lands.
//
// The repro drives the REAL door (prepareReview) over a repo whose
// previous round REJECTED head H1 with a P0 on src/bug.ts, and asserts
// that the round the door materializes still READS the bytes that
// verdict blocked (the diff the lenses get must contain src/bug.ts).
//
// BASE behaviour: the trunk base has no delta rounds at all — the
// review judges exactly base..head (the door's own message: "the
// review judges exactly base..head") — so the blocked file IS in the
// reading and the assertion PASSES on BASE.
import assert from "node:assert/strict"
import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// the verdict history lives under the harness home — point it at a
// scratch dir (never the real disk)
const HOME = mkdtempSync(join(tmpdir(), "aos-p3003-home-"))
process.env.AGENTIC_OS_HOME = HOME
test.after(() => rmSync(HOME, { recursive: true, force: true }))

const writeVerdict = (sid: string, v: Record<string, unknown>) => {
  const dir = join(HOME, "sessions", sid, "jobs", "j1", "run", "data", "review")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "verdict.json"), JSON.stringify(v))
}

test("principles-3003: a round after a REJECTING verdict must still read the bytes that verdict blocked", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-p3003-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init -q -b main .")
    g("config user.email t@t.local")
    g("config user.name t")
    writeFileSync(join(repo, "src", "keep.ts"), "export const keep = 1\n")
    g("add -A && git commit -qm base")
    const baseSha = g("rev-parse main").trim()
    g("checkout -qb feat")
    // round 1's commit — the one that carries the P0
    writeFileSync(join(repo, "src", "bug.ts"), "export const bug = 1\n")
    g("add -A && git commit -qm one")
    const judged1 = g("rev-parse HEAD").trim()
    // round 2's commit — an UNRELATED change; the P0's file is untouched
    writeFileSync(join(repo, "src", "other.ts"), "export const other = 1\n")
    g("add -A && git commit -qm two")
    const headSha = g("rev-parse HEAD").trim()

    // round 1 REJECTED with a P0 on src/bug.ts
    writeVerdict("s-prior", {
      verdict: "reject",
      repo,
      base: baseSha,
      head: judged1,
      blocked: [{ id: "p-1", severity: "P0", claim: "the P0 in src/bug.ts", location: { file: "src/bug.ts", line_start: 1 } }],
    })

    const ready = prepareReview({ repo, base: "main", head: "feat", title: "t", mergeCmd: "true", model: "p/m", out: join(tmp, "prog") }, join(ROOT, "templates"))
    assert.ok(ready.ok && !ready.skipped, `the levy must prepare (why: ${ready.ok ? "" : ready.why})`)

    const cfg = readFileSync(join(ready.dir!, "data", "review", "config.sh"), "utf8")
    const spanFrom = /JUDGED_SPAN_FROM='([^']*)'/.exec(cfg)?.[1] ?? baseSha
    const read = g(`diff --name-only ${spanFrom} ${headSha}`).split("\n").filter(Boolean)

    assert.ok(
      read.includes("src/bug.ts"),
      `INV-4: the round that follows a REJECTING verdict must still read the bytes that verdict blocked — ` +
        `the prior verdict rejected src/bug.ts at ${judged1.slice(0, 8)}, the round's span starts at ${spanFrom.slice(0, 8)}, ` +
        `and the reading is ${JSON.stringify(read)}: the merge stage merges base..head and the chain sweep ` +
        `(merge.sh) folds only the span boundaries, never a span's verdict, so the P0's bytes ride the merge.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
