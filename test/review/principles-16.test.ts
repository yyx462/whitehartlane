// principles-16 (repro for finding principles-1, P1) — "never stale
// bytes: the merged head IS the head the verdict names" (ship.ts's own
// law; the momentum-200 class, overrule arm). whl ship validates the
// LOCAL worktree's HEAD sha (bin/whitehartlane:690) but the thing it
// merges is the PR ref (`gh pr merge <n>` — the PR's CURRENT head on
// GitHub, merged by number). The check site and the act site are two
// different sites that can disagree: two reject rounds on sha X, the
// owner pushes X+1 to the PR branch (a tweak that was never
// re-reviewed), then runs ship from a worktree still at X —
// verdictsForHead(X) finds the rounds, shipCheck passes, and the merge
// command merges X+1 under a receipt that names X. The door never asks
// gh what the PR head is (`gh pr view` is never called), so the
// never-stale-bytes law is enforced against a sha the merge cannot see.
//
// BASE shape: no ship door there — spawn of `whl ship` exits with the
// usage/unknown-verb path; guarded the repo's own way (cf.
// momentum-2-r26.test.ts) by asserting only what HEAD promises.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const REPO_ROOT = resolve(import.meta.dirname, "..", "..")
const BIN = join(REPO_ROOT, "bin", "whitehartlane")

const g = (repo: string, a: string) =>
  execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

test("principles-16: ship must not merge a PR whose head is not the sha the verdict judged (never stale bytes — the check site must be the merge site)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-p16-"))
  const home = join(tmp, "home")
  const repo = join(tmp, "repo")
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    g(repo, "init -q -b main .")
    g(repo, "config user.email t@t.local")
    g(repo, "config user.name t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    g(repo, "add -A && git commit -qm base")
    g(repo, "checkout -qb feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    g(repo, "add -A && git commit -qm feat")
    const judgedSha = g(repo, "rev-parse HEAD").trim()

    // the PR moves past the verdict: X+1 pushed to the PR branch after
    // round 2, never re-reviewed. The local worktree stays at X (feat).
    g(repo, "checkout -qb pr-branch")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\nexport const sneaked = () => true\n")
    g(repo, 'add -A && git commit -qm "post-verdict tweak, never reviewed"')
    const movedSha = g(repo, "rev-parse HEAD").trim()
    g(repo, "checkout -q feat")

    // two reject rounds ON THE JUDGED SHA X
    for (const sid of ["s-r1", "s-r2"]) {
      const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, "verdict.json"),
        JSON.stringify({ verdict: "reject", head: judgedSha, blocked: [{ id: "m-1", severity: "P1", claim: "asserts the wrong requirement" }] }),
      )
    }

    // a gh stub: merge/comment recorded, pr view answers the PR's REAL
    // head (the moved sha) — the one fact ship never asks for
    const gh = join(tmp, "gh")
    writeFileSync(
      gh,
      `#!/bin/sh
case "$1 $2" in
  "pr view") printf '{"headRefOid":"%s"}\\n' "${movedSha}"; exit 0 ;;
  "pr merge"|"pr comment") printf '%s\\n' "$*" >> ${JSON.stringify(join(tmp, "gh-calls.txt"))}; exit 0 ;;
esac
printf 'gh stub: unhandled: %s\\n' "$*" >&2; exit 1
`,
    )
    chmodSync(gh, 0o755)

    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "m-1": "the repro asserts the wrong requirement" }))

    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "ship", repo, "--pr", "42", "--overrule", overrule],
      {
        env: { ...process.env, AGENTIC_OS_HOME: home, WHL_GATE_LEDGER: join(home, "gate.jsonl"), PATH: `${tmp}:${process.env.PATH}` },
        encoding: "utf8",
        timeout: 60_000,
      },
    )

    const calls = existsSync(join(tmp, "gh-calls.txt")) ? readFileSync(join(tmp, "gh-calls.txt"), "utf8") : ""
    assert.ok(
      r.status !== 0 || !/pr merge/.test(calls),
      `never stale bytes (ship.ts's own law, the momentum-200 class overrule arm): the verdict judged ${judgedSha.slice(0, 8)} but the PR head is ${movedSha.slice(0, 8)} — ship validated the LOCAL worktree sha (${judgedSha.slice(0, 8)}, two reject rounds found), then merged the PR by number, blessing bytes no verdict ever judged. The PR head must be checked (gh pr view) against the verdict's sha BEFORE the merge runs. ship exited ${r.status} and gh saw: ${calls.trim().split("\n").filter(Boolean).join(" | ") || "(nothing)"}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
