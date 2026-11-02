// principles-5203 — the head branch the reviewer named is discarded
// too, and the head-drift guard the change ADDED then reads the WRONG
// ref and cannot fire: unreviewed bytes ride the merge.
//
// THE CHANGE'S OWN CLAIM, at src/doors/review.ts:1112-1119 (the diff
// adds these lines):
//
//   // the HEAD's branch NAME, the caller's first (tests-10101): the
//   // branch the review is ABOUT is the name the operator handed over;
//   // for-each-ref --points-at sorts alphabetically and would name a
//   // SIBLING branch that happens to sit at the judged sha — the drift
//   // guard then reads the wrong ref and can never fire
//   // (tests-10102).
//
// The claim is FALSE on the plain door path, because the SAME diff
// hands the door the gate's SHA instead of the caller's ref
// (bin/whitehartlane:614-615, also added by this change):
//
//   base: gateBaseSha ?? val("base"),
//   head: gateHeadSha ?? val("head"),
//
// `head` therefore arrives at prepareReview as a SHA, so the sha-like
// arm of the ternary at review.ts:1120 is always taken:
//
//   `HEAD_BRANCH=${shellQuote(args.headBranch ?? (/^[0-9a-f]{7,40}$/.test(head)
//      ? branchOf(headSha) ?? headSha : head))}`
//
// `args.headBranch` HAS a producer (the `--head-branch` flag,
// bin/whitehartlane:347,621) — but the plain `whl review <repo> --head
// feat` invocation never passes it, so the caller's `feat` is gone and
// `branchOf(headSha)` guesses alphabetically. (The `--auto` mint DOES
// pass `--head-branch` — bin/whitehartlane:565 — so the SAME door
// answers the head-branch question two different ways depending on the
// arm. That asymmetry is the twin path.)
//
// THE HARM — the drift guard the diff added (templates/pr-review/hooks/
// merge.sh:56-67) compares HEAD_BRANCH's CURRENT tip against the
// judged sha:
//
//   branch_head="$(git -C "$REPO" rev-parse --verify "$HEAD_BRANCH^{commit}" ...)"
//   if [ -n "$branch_head" ] && [ "$branch_head" != "$judged_head" ]; then
//     echo "merge: $HEAD_BRANCH moved ... unreviewed bytes would ride
//       the merge; re-run the review on the new head" >&2
//     exit 1
//
// With HEAD_BRANCH naming the leftover SIBLING (which sits at the
// judged sha by construction), `branch_head` EQUALS the judged sha and
// the guard passes. The sibling arm of the same guard (merge.sh:75-85,
// the for-each-ref sweep) cannot see the move either — the diff's own
// comment says so: "the earlier ref-sweep arm was vacuous:
// for-each-ref --points-at lists only refs that STILL point at the
// judged sha, so it could never observe a move". So when the PR's
// branch moves during the review, the merge lands bytes no verdict
// judged — the exact harm the guard was added to prevent.
//
// BASE behaviour: BASE wrote `HEAD_BRANCH=${shellQuote(head)}` — the
// reviewer's own ref verbatim — so the name reached the seat, and BASE
// had no drift guard at all. The name assertion below PASSES on BASE.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const HEAD = join(import.meta.dirname, "..", "..")
const BIN = join(HEAD, "bin", "whitehartlane")

test("principles-5203: the head-drift guard must read the branch the reviewer named", () => {
  const tmp = mkdtempSync(join(tmpdir(), "p5203-drift-"))
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
    g("checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 2\n")
    g("add", "-A")
    g("commit", "-qm", "feat")
    const judgedSha = g("rev-parse", "feat").trim()
    // the rename-era leftover: a SIBLING branch sitting at the judged
    // sha, sorting BEFORE the real one
    g("branch", "aaa-sibling")

    // a no-op orchestrator stub — a scratch drive must never book a real
    // workflow (the leaked-lens receipt, 2026-10-30)
    const stub = join(tmp, "orch-stub.mjs")
    writeFileSync(stub, "process.exit(0)\n")
    const jevDead = join(tmp, "jev-dead")
    writeFileSync(jevDead, "#!/bin/sh\nexit 1\n")
    chmodSync(jevDead, 0o755)

    const out = join(tmp, "prog")
    const home = join(tmp, "home")
    mkdirSync(home, { recursive: true })
    const env = {
      ...process.env,
      AGENTIC_OS_HOME: home,
      AGENTIC_OS_ORCHESTRATOR: stub,
      WHL_GATE_LEDGER: join(tmp, "ledger.jsonl"),
      WHL_JEV_BIN: jevDead,
      AGENTIC_OS_NOTIFY: "0",
    }
    delete (env as Record<string, string | undefined>).AGENTIC_OS_JID

    // THE REAL DOOR — the reviewer names the head branch: "feat"
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--base", "master", "--head", "feat", "--model", "acme/m", "--out", out, "--unattended"],
      { env, encoding: "utf8", timeout: 120_000 },
    )
    assert.equal(r.status, 0, `the door must materialize the program (stdout: ${r.stdout}\nstderr: ${r.stderr})`)

    const cfg = readFileSync(join(out, "data", "review", "config.sh"), "utf8")
    const headBranch = cfg.match(/^HEAD_BRANCH='(.*)'$/m)?.[1]
    assert.equal(
      headBranch,
      "feat",
      `the config must name the head branch the reviewer named ("feat"), got '${headBranch}'.\n` +
        `src/doors/review.ts:1120 derives HEAD_BRANCH with branchOf(headSha) — the FIRST branch "for-each-ref --points-at" lists at the judged sha (an alphabetical guess) — because the door hands the gate's SHA down (bin/whitehartlane:615 "head: gateHeadSha ?? val('head')"), so the sha-like arm of the ternary is always taken; args.headBranch (the --head-branch flag) has no producer on this path.\n` +
        `The change's own comment above that line says "the branch the review is ABOUT is the name the operator handed over ... the drift guard then reads the wrong ref and can never fire" — on this path the name never reaches the seat.`,
    )

    // the guard the change ADDED — only assert it where it exists
    const mergeSh = readFileSync(join(out, "hooks", "merge.sh"), "utf8")
    if (!/HEAD_BRANCH moved/.test(mergeSh)) return // BASE has no drift guard — the naming assertion above is the verdict

    // the PR's branch MOVES during the review (unreviewed bytes)
    g("checkout", "-q", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 999\n")
    g("add", "-A")
    g("commit", "-qm", "unreviewed-push")
    const movedSha = g("rev-parse", "feat").trim()
    assert.notEqual(movedSha, judgedSha, "sanity: the branch moved")

    // the merge stage, with a merge command that merges the PR's CURRENT
    // tip (what `gh pr merge` does)
    const seat = join(out, "data", "review", "verdict.json")
    writeFileSync(seat, JSON.stringify({ verdict: "accept", head: judgedSha, blocked: [] }))
    const mc = join(tmp, "merge.sh")
    writeFileSync(mc, `#!/bin/sh\ngit -C ${JSON.stringify(repo)} merge --no-ff -m "pr-review: accept" refs/heads/feat\n`)
    chmodSync(mc, 0o755)
    writeFileSync(
      join(out, "data", "review", "config.sh"),
      readFileSync(join(out, "data", "review", "config.sh"), "utf8").replace(/^MERGE_CMD=.*$/m, `MERGE_CMD='${mc}'`),
    )
    const m = spawnSync("bash", [join(out, "hooks", "merge.sh")], { cwd: tmp, encoding: "utf8" })

    assert.notEqual(
      m.status,
      0,
      `the drift guard must refuse: the PR's branch moved (${judgedSha.slice(0, 8)} -> ${movedSha.slice(0, 8)}) since the review, so the merge would carry bytes no verdict judged.\n` +
        `templates/pr-review/hooks/merge.sh:56-67 compares HEAD_BRANCH's tip against the judged sha; with HEAD_BRANCH='${headBranch}' (the alphabetical guess, not the reviewer's "feat"), branch_head EQUALS the judged sha and the guard passes — the sibling arm (the for-each-ref sweep, merge.sh:75-85) cannot see the move either, by the diff's own admission ("it could never observe a move").\n` +
        `merge.sh exited ${m.status} and said: ${(m.stderr || "").trim()}`,
    )
    // CORRECTED ADOPTED-WITH-THE-FIX: the original assert demanded feat
    // ≠ movedSha — a state change nothing in this fixture can produce
    // (the guard REFUSED before MERGE_CMD ran, and the fixture's merge
    // command merges refs/heads/feat INTO feat, itself a no-op). The
    // header's law is the refusal; a refusal leaves everything alone:
    // the branch sits exactly where the unreviewed push left it, and
    // no verdict-blessed merge happened anywhere.
    assert.equal(
      g("rev-parse", "feat").trim(),
      movedSha,
      "sanity: the refusal leaves the branch where the unreviewed push left it (the merge command never ran)",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
