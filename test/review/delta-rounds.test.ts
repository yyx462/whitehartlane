// delta-rounds — the owner's convergence ruling (2026-11-02): "I am
// sure I need to have some size shrinking mechanism, otherwise the
// review is never going to converge." The full-span re-read minted
// 2–4 novel buckets every round (eleven verdicts, the stop window
// never opened); a round now judges ONLY the commits since the last
// judged head, and the merge boundary proves the tiling. Two pins:
//
//   1. THE SPAN: a prior verdict at feat~1 narrows the levy's file
//      list to the delta and hands JUDGED_SPAN_FROM down (the verdict
//      stamps it as judgedFrom — merge.sh's chain data).
//   2. THE CHAIN: merge.sh folds JUDGED_SPANS forward from BASE_SHA —
//      a tiling merges; a GAP (bytes no verdict judged) refuses with
//      the frontier named. Overlap is re-reading: sound, not drift.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-delta-"))
process.env.AGENTIC_OS_NOTIFY = "0"
test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

const writeVerdict = (home: string, sid: string, v: Record<string, unknown>) => {
  const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "verdict.json"), JSON.stringify(v))
}

test("the delta span: a prior verdict narrows the levy to the commits since the judged head", () => {
  const home = process.env.AGENTIC_OS_HOME!
  const tmp = mkdtempSync(join(tmpdir(), "aos-delta-span-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init -q -b main .")
    g("config user.email t@t.local")
    g("config user.name t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    g("add -A && git commit -qm base")
    const baseSha = g("rev-parse main").trim()
    g("checkout -qb feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    g("add -A && git commit -qm one")
    const judged1 = g("rev-parse HEAD").trim()
    writeFileSync(join(repo, "src", "other.ts"), "export const other = 1\n")
    g("add -A && git commit -qm two")
    const headSha = g("rev-parse HEAD").trim()

    // round 1 already ACCEPTED base..judged1 — the delta law's narrow
    // case: an accept vouches for everything before it, so the next
    // round reads only judged1..head (the extension commits)
    writeVerdict(home, "s-r1", { verdict: "accept", repo, base: baseSha, head: judged1, blocked: [] })

    const ready = prepareReview({ repo, base: "main", head: "feat", title: "t", mergeCmd: "true", model: "minimax-cn/MiniMax-M3.1-Flash" }, join(ROOT, "templates"))
    assert.ok(ready.ok && !ready.skipped, `the levy must prepare (why: ${ready.ok ? "" : ready.why})`)
    // ReviewReady carries no file list on success — the narrowing is
    // pinned at its two real seats: the config hand-down (what intake
    // will diff from) and the verdict's judgedFrom stamp (prove.sh
    // reads JUDGED_SPAN_FROM from the same config)
    const cfg = readFileSync(join(ready.dir!, "data", "review", "config.sh"), "utf8")
    assert.match(cfg, new RegExp(`JUDGED_SPAN_FROM='${judged1}'`), "an ACCEPT vouches for its span — the next round reads only the delta since it")
    assert.match(cfg, new RegExp(`JUDGED_SPANS='[^']*${judged1}:${headSha}'`), "the chain carries the prior span plus this round's (merge.sh sweeps them)")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the unresolved-era law: a REJECTING prior resets the span to the last accept (or base)", () => {
  const home = process.env.AGENTIC_OS_HOME!
  const tmp = mkdtempSync(join(tmpdir(), "aos-delta-era-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init -q -b main .")
    g("config user.email t@t.local")
    g("config user.name t")
    writeFileSync(join(repo, "src", "bug.ts"), "export const bug = true\n")
    g("add -A && git commit -qm base")
    const baseSha = g("rev-parse main").trim()
    g("checkout -qb feat")
    writeFileSync(join(repo, "src", "bug.ts"), "export const bug = false\n")
    g("add -A && git commit -qm one")
    const judged1 = g("rev-parse HEAD").trim()
    writeFileSync(join(repo, "src", "other.ts"), "export const other = 1\n")
    g("add -A && git commit -qm two")
    const headSha = g("rev-parse HEAD").trim()

    // the prior verdict REJECTED at judged1 — its blocked bytes must
    // stay in the reading until some accept vouches for them
    // (principles-3003: no accept exists → the span resets to base)
    writeVerdict(home, "s-r1", { verdict: "reject", repo, base: baseSha, head: judged1, blocked: [{ id: "x-1", severity: "P1", claim: "c", location: { file: "src/bug.ts", line_start: 1 } }] })

    const ready = prepareReview({ repo, base: "main", head: "feat", title: "t", mergeCmd: "true", model: "minimax-cn/MiniMax-M3.1-Flash" }, join(ROOT, "templates"))
    assert.ok(ready.ok && !ready.skipped, `the levy must prepare (why: ${ready.ok ? "" : ready.why})`)
    const cfg = readFileSync(join(ready.dir!, "data", "review", "config.sh"), "utf8")
    assert.match(cfg, new RegExp(`JUDGED_SPAN_FROM='${baseSha}'`), "a rejecting prior with no accept after it → the span is the FULL unresolved era (base)")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("the chain check: a tiling merges, a GAP refuses with the frontier named", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-delta-chain-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    g("init -q -b main .")
    g("config user.email t@t.local")
    g("config user.name t")
    for (const [i, body] of ["base", "one", "gap", "two"].entries()) {
      writeFileSync(join(repo, "src", `f${i}.ts`), `export const v${i} = "${body}"\n`)
      g("add -A")
      g(`commit -qm ${body}`)
      if (i === 0) g("checkout -qb feat")
    }
    const baseSha = g("rev-parse main").trim()
    const judgedHead = g("rev-parse feat").trim()
    const mid = (n: number) => g(`rev-parse feat~${n}`).trim()
    const marker = join(tmp, "merged.txt")
    const dirFor = (name: string, spans: string) => {
      const dir = join(tmp, name)
      mkdirSync(join(dir, "hooks"), { recursive: true })
      mkdirSync(join(dir, "data", "review"), { recursive: true })
      writeFileSync(join(dir, "hooks", "merge.sh"), readFileSync(join(ROOT, "templates", "pr-review", "hooks", "merge.sh"), "utf8"))
      writeFileSync(
        join(dir, "data", "review", "config.sh"),
        [
          `REPO=${JSON.stringify(repo).replace(/"/g, "'")}`,
          `BASE_BRANCH='main'`,
          `BASE_SHA='${baseSha}'`,
          `HEAD_BRANCH='feat'`,
          `HEAD_SHA='${judgedHead}'`,
          `TITLE='t'`,
          `MERGE_CMD='touch ${marker}'`,
          `JUDGED_SPANS='${spans}'`,
          "",
        ].join("\n"),
      )
      writeFileSync(join(dir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", blocked: [] }))
      return dir
    }

    // A TILING (with overlap — re-reading, sound): base..feat~2, then
    // feat~3..feat — wait, overlap means one span starting BEFORE the
    // frontier: base:mid(2) then mid(3):head folds forward fine.
    const tiling = `${baseSha}:${mid(2)} ${mid(3)}:${judgedHead}`
    let r = spawnSync("bash", [join(dirFor("tile", tiling), "hooks", "merge.sh")], { cwd: tmp, encoding: "utf8", timeout: 60_000 })
    assert.equal(r.status, 0, `a tiling must reach the merge (stderr: ${r.stderr})`)
    assert.ok(existsSync(marker), "the merge command ran")

    // A GAP: base..feat~3 judged, then feat~1..feat — feat~3..feat~1
    // (one commit) was never inside any span
    rmSync(marker, { force: true })
    const gap = `${baseSha}:${mid(3)} ${mid(1)}:${judgedHead}`
    r = spawnSync("bash", [join(dirFor("gap", gap), "hooks", "merge.sh")], { cwd: tmp, encoding: "utf8", timeout: 60_000 })
    assert.notEqual(r.status, 0, "a GAP must refuse — bytes no verdict judged would ride the merge")
    assert.match(r.stderr, /GAP/, "the refusal names the gap")
    assert.ok(!existsSync(marker), "nothing merged over the gap")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
