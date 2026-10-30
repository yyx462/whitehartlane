// tests-10010 — the ship door's --pr grammar (INV-3 twin of the --auto
// mint). The decision "is this a PR number" is made ONCE in the --auto
// flow — `!/^\d+$/.test(pr)` refuses at the door (bin/whitehartlane,
// "review: --auto wants --pr <number>") — and made AGAIN, wrongly, in
// the ship verb: `if (!sRepo || !sVal("pr") || !sVal("overrule"))`
// accepts ANY non-empty string. The default merge command then
// interpolates that string VERBATIM into a `sh -c` line:
//   `gh pr merge ${pr} --merge --subject "pr-review: override-merge (#${pr})"`
// so `--pr '77; touch <marker>; #'` runs the payload as a shell
// statement mid-merge. The grammar was fixed in one seat and left
// wrong in its twin — the exact class this repo's review hunts.
// (File named tests-10010: tests-1..10002 belong to prior review
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
  g("add -A && git commit -qm feat")
  return where
}

test("ship: --pr is a NUMBER at the door (the --auto twin's grammar) — a non-numeric --pr never reaches a shell", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-ship-pr-"))
  try {
    const home = join(tmp, "home")
    const repo = fixtureRepo(join(tmp, "repo"))
    const headSha = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim()
    // two reject rounds on this head — the overrule gate is genuinely open
    for (const sid of ["s-r1", "s-r2"]) {
      const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "verdict.json"), JSON.stringify({
        verdict: "reject",
        head: headSha,
        blocked: [{ id: "f-1", severity: "P1", claim: "claim" }],
      }))
    }
    // a gh stub: records every invocation, exit 0
    const gh = join(tmp, "gh")
    writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(join(tmp, "gh-calls.txt"))}\n`)
    chmodSync(gh, 0o755)
    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "f-1": "working as intended" }))
    const marker = join(tmp, "injected-payload-ran")
    const payload = `77; touch ${marker}; #`
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "ship", repo, "--pr", payload, "--head", "feat", "--overrule", overrule],
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
    // the one grammar, both seats: --auto refuses 'review: --auto wants
    // --pr <number>'; ship must refuse the same shape BEFORE any merge
    assert.equal(r.status, 2, `a non-numeric --pr must be refused at the door — got exit ${r.status}, stdout: ${r.stdout}\nstderr: ${r.stderr}`)
    assert.ok(!existsSync(marker), "the --pr value must never run as shell statements — the payload touched a file via the default merge command's sh -c line")
    const calls = existsSync(join(tmp, "gh-calls.txt")) ? readFileSync(join(tmp, "gh-calls.txt"), "utf8") : ""
    assert.ok(!/pr merge/.test(calls), `no merge may run for a refused --pr — gh saw: ${calls}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
