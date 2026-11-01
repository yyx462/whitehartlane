// principles-103 — "how many rounds has this fixer had?" is ONE decision.
//
// The change opens an overrule exit ("the fixer's right to reject a
// rejection") whose gate is a ROUND COUNT: the exit opens only after
// good faith (src/doors/ship.ts:110-124, minRounds = 2). The change's
// own law is explicit — "never on round 1 — good faith comes first; the
// exit opens after it" (src/doors/ship.ts:10) — and the diff's comment
// names the very bug it set out to fix:
//
//   // the repo's whole review history counted (other PRs included), so a
//   // brand-new PR's FIRST reject opened the override exit — the gate the
//   // exit exists to keep
//   (src/doors/ship.ts:55-61)
//
// The fix introduces a SECOND round counter — verdictsForBranch, "the
// owner's ROUNDS on THIS branch" (src/doors/ship.ts:62-79) — and the
// gate now takes the MAX of the two counters:
//
//   const rounds = Math.max(opts.rounds.length, opts.repoRounds ?? 0)
//
// But verdictsForBranch's membership test is `git merge-base --is-ancestor
// sha headSha` (src/doors/ship.ts:72) — "is this verdict's head an
// ancestor of my head?" A TRUNK PR's head IS an ancestor of the new
// branch's head (it was merged into the trunk). So the branch counter
// counts the trunk's earlier PR rejects as THIS PR's rounds, and the
// overrule exit opens on a brand-new PR's FIRST reject — the exact gate
// the exit exists to keep.
//
// The repro: a repo whose trunk carries two earlier reviewed-and-rejected
// PRs, and a brand-new PR whose own verdict is its FIRST reject. The exit
// must stay shut.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()

test("principles-103: a brand-new PR's FIRST reject must not open the overrule exit (the trunk's earlier rejects are not this PR's rounds)", async () => {
  const mod = (await import("../../src/doors/ship.ts").catch(() => null)) as
    | typeof import("../../src/doors/ship.ts")
    | null
  assert.ok(mod, "the ship seat must exist — the exit must have an owner")
  const { shipCheck, verdictsForHead, verdictsForBranch } = mod

  const tmp = mkdtempSync(join(tmpdir(), "aos-principles-103-"))
  try {
    const repo = join(tmp, "repo")
    const home = join(tmp, "home")
    mkdirSync(join(repo, "src"), { recursive: true })
    git(repo, "init", "-q", "-b", "main", ".")
    git(repo, "config", "user.email", "t@t.local")
    git(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")

    // two earlier TRUNK PRs, each reviewed and REJECTED (their verdicts
    // live on this machine, so the branch counter can see them)
    const trunkHeads: string[] = []
    for (const n of [1, 2]) {
      git(repo, "checkout", "-qb", `pr${n}`)
      writeFileSync(join(repo, "src", "a.ts"), `export const a = ${n + 1}\n`)
      git(repo, "add", "-A")
      git(repo, "commit", "-qm", `pr${n}`)
      trunkHeads.push(git(repo, "rev-parse", "HEAD"))
      git(repo, "checkout", "-q", "main")
      git(repo, "merge", "-q", "--no-ff", `pr${n}`, "-m", `merge pr${n}`)
    }

    // the brand-new PR: its OWN first reject
    git(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 99\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "feat")
    const head = git(repo, "rev-parse", "HEAD")
    const base = git(repo, "rev-parse", "main")

    const writeVerdict = (i: number, sha: string) => {
      const d = join(home, "sessions", `s${i}`, "jobs", "j1", "run", "data", "review")
      mkdirSync(d, { recursive: true })
      writeFileSync(
        join(d, "verdict.json"),
        JSON.stringify({ verdict: "reject", head: sha, blocked: [{ id: "m-1", severity: "P1", claim: "asserts the wrong requirement" }] }),
      )
    }
    trunkHeads.forEach((sha, i) => writeVerdict(i, sha))
    writeVerdict(trunkHeads.length, head)

    const sessions = join(home, "sessions")
    const rounds = verdictsForHead(head, sessions)
    const branch = verdictsForBranch(repo, head, { base, root: sessions })

    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "m-1": "the owner knows the intent" }))

    const check = shipCheck({ headSha: head, overruleFile: overrule, rounds, repoRounds: branch.length })
    const trunkList = trunkHeads.map((s) => s.slice(0, 7)).join(", ")
    assert.equal(
      check.ok,
      false,
      "the overrule exit must stay shut on round 1 of THIS PR — the trunk's earlier rejects (" +
        trunkList +
        ") are OTHER PRs' rounds, not this PR's. The gate counts the MAX of two counters " +
        "(this head's verdicts = " +
        rounds.length +
        ", branch-history verdicts = " +
        branch.length +
        "), and the branch counter's membership test is 'is this head an ancestor of mine?' — which every merged trunk PR satisfies. " +
        "The exit opened on a brand-new PR's first reject.",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
