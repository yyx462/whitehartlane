// tests-10011 — "never stale bytes" (ship.ts's own law, unenforced).
// src/doors/ship.ts header: "never stale bytes — the merged head IS
// the head the verdict names", and the bin's inline comment at the
// merge seat claims the guard: "the merged bytes ARE the judged bytes
// (the momentum-200 class, overrule arm): a verdict about old shas
// must not bless a moved head". No such check exists: ship resolves
// the LOCAL ref (`git rev-parse <headRef>`), finds verdicts for that
// sha, then runs `gh pr merge <pr>` — which merges the PR's CURRENT
// head, whatever it is now. A PR that moved past the judged sha (the
// owner pushed a "fix" commit and skipped the re-review) is merged
// under an override that blessed bytes nobody judged. The claim is
// false on a reachable path.
// (File named tests-10011: tests-1..10002 belong to prior review
// rounds and stay untouched.)
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const BIN = join(import.meta.dirname, "..", "..", "bin", "whitehartlane")

function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  g("add -A && git commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\n")
  g("add -A && git commit -qm judged")
  return where
}

test("ship: a PR whose head moved past the judged sha is NOT merged under the override", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-ship-stale-"))
  try {
    const home = join(tmp, "home")
    const repo = fixtureRepo(join(tmp, "repo"))
    const judgedSha = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim()
    // two reject rounds judged sha X
    for (const sid of ["s-r1", "s-r2"]) {
      const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "verdict.json"), JSON.stringify({
        verdict: "reject",
        head: judgedSha,
        blocked: [{ id: "f-1", severity: "P1", claim: "claim" }],
      }))
    }
    // the PR moves: a new commit lands on feat AFTER the last verdict
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\nexport const neverJudged = () => true\n")
    execSync("git add -A && git commit -qm moved", { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    const movedSha = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim()
    assert.notEqual(judgedSha, movedSha)
    // a gh stub: it knows the PR's current head (as gh does), records
    // every invocation, refuses nothing
    const gh = join(tmp, "gh")
    writeFileSync(
      gh,
      `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(join(tmp, "gh-calls.txt"))}
case " $* " in
  *" view "*|*" api "*|*"headRefOid"*) printf '{"headRefOid":"%s"}\\n' ${JSON.stringify(movedSha)} ;;
esac
exit 0
`,
    )
    chmodSync(gh, 0o755)
    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "f-1": "working as intended" }))
    // the owner overrules the verdict on sha X while the PR sits at Y
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "ship", repo, "--pr", "42", "--head", judgedSha, "--overrule", overrule],
      {
        cwd: tmp,
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          AGENTIC_OS_HOME: home,
          AGENTIC_OS_NOTIFY: "0",
          WHL_GATE_LEDGER: join(home, "gate.jsonl"),
          PATH: `${tmp}:${process.env.PATH}`,
        },
      },
    )
    const calls = existsSync(join(tmp, "gh-calls.txt")) ? readFileSync(join(tmp, "gh-calls.txt"), "utf8") : ""
    // the law: the merged head IS the head the verdict names. The PR's
    // head is the moved sha — a verdict about X must not merge Y
    assert.ok(!/pr merge/.test(calls), `a PR at ${movedSha.slice(0, 8)} (never judged) was merged under an override for ${judgedSha.slice(0, 8)} — gh saw: ${calls}`)
    assert.notEqual(r.status, 0, `ship must refuse (or fail loudly) when the PR head is not the judged sha — exit ${r.status}, stdout: ${r.stdout}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
