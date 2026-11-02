// momentum-500 — the stale-bytes window the ship verb's own comment
// claims closed (INV-4, verdicts are honest; the momentum-200 class,
// "a decision fixed in one place and left wrong in its twin").
// ship.ts's header law: "never stale bytes — the merged head IS the
// head the verdict names". The implementation resolves headSha ONCE
// at entry (bin/whitehartlane:690 `git rev-parse ${headRef}^{commit}`)
// and matches verdicts against it — then walks the whole sessions
// disk (verdictsForHead), re-features the repo (gateFeatures: 3 more
// git calls + a second verdict walk), writes a ledger row, and ONLY
// THEN runs the merge command. A push that lands on the branch inside
// that window — the racing-collaborator shape momentum-200 pinned at
// the mint ("a ref that moves during the gate's own jev call") —
// merges bytes NO verdict ever judged, while the override receipt,
// the ledger row, and the PR comment all name the old sha. The same
// class, unfixed, at the one arm that MERGES. The window is
// user-reachable with no race at all, too: `--head <any-ref>` is
// never tied to the PR — a stale or wrong ref silently blesses a PR
// whose bytes were never judged.
//
// Repro: deterministic, no race — the gh stub IS the merge executor;
// sequenced strictly between ship's entry rev-parse and the merge by
// the bin's own call order, it lands a commit on the branch (the
// collaborator's push) and records the sha it actually merged, the
// momentum-200 jev-stub trick on the overrule arm. The law: an
// override may merge ONLY the bytes the verdict judged — the drifted
// merge must be refused (or at least detected and reported as not
// merged), never blessed.
//
// BASE shape: no src/doors/ship.ts there — guarded dynamic import,
// vacuous green on BASE (the repo's own repro convention).
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const ROOT = join(import.meta.dirname, "..", "..")
const MOD_URL = new URL("../../src/doors/ship.ts", import.meta.url)
const mod = existsSync(MOD_URL) ? await import(MOD_URL) : undefined

function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (args: string) => execFileSync("git", args.split(" "), { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  g("add -A")
  g("commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\n")
  g("add -A")
  g("commit -qm feat")
  return where
}

test("momentum-500: the override may merge ONLY the bytes the verdict judged — a head that drifts between ship's rev-parse and the merge must refuse, never bless", () => {
  if (!mod) return // BASE: no ship door — nothing to judge
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom500-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const home = join(tmp, "home")
    mkdirSync(home)
    const g = (args: string) => execFileSync("git", args.split(" "), { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    const judgedSha = g("rev-parse feat").trim()
    // two reject rounds on the judged head — the override's good faith
    for (const sid of ["s-r1", "s-r2"]) {
      const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "verdict.json"), JSON.stringify({ verdict: "reject", head: judgedSha, blocked: [{ id: "f-1", severity: "P1", claim: "claim 1" }] }))
    }
    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "f-1": "the repro asserts the wrong requirement" }))
    // the gh stub: the merge executor. On `pr merge` it FIRST lands the
    // collaborator's push on the branch (strictly after ship's entry
    // rev-parse, before the merge takes effect), records the sha it
    // actually merged, and succeeds — the drifted merge is invisible to
    // the caller's terminal unless the door checks.
    const ghLog = join(tmp, "gh-calls.txt")
    const gh = join(tmp, "gh")
    writeFileSync(
      gh,
      [
        "#!/bin/sh",
        `case "$1 $2" in "pr merge")`,
        `  echo "// drifted push" >> ${join(repo, "src", "wait.ts")}`,
        `  git -C ${JSON.stringify(repo)} add -A >/dev/null 2>&1`,
        `  git -C ${JSON.stringify(repo)} commit -qm "collaborator push (races the override)" >/dev/null 2>&1`,
        `  echo "MERGED $(git -C ${JSON.stringify(repo)} rev-parse feat)" >> ${ghLog}`,
        `  ;;`,
        `  *) printf '%s\\n' "$*" >> ${ghLog} ;;`,
        "esac",
        "exit 0",
      ].join("\n"),
    )
    chmodSync(gh, 0o755)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AGENTIC_OS_HOME: home,
      AGENTIC_OS_NOTIFY: "0",
      WHL_GATE_LEDGER: join(home, "gate.jsonl"),
      PATH: `${tmp}:${process.env.PATH}`,
    }
    delete env.OPENCODE_SESSION_ID
    delete env.WHL_GATE
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", join(ROOT, "bin", "whitehartlane"), "ship", repo, "--pr", "42", "--overrule", overrule, "--head", "feat", "--base", "main"],
      { env, encoding: "utf8", timeout: 60_000 },
    )
    // a refused drift never reaches the merge executor — no log is a
    // pass, not an ENOENT crash
    const merged = existsSync(ghLog) ? (readFileSync(ghLog, "utf8").match(/^MERGED ([0-9a-f]+)$/m) ?? [])[1] ?? "" : ""
    // blessed = the door exited 0 CLAIMING the override-merge happened;
    // a fixed door refuses the drift (any non-zero exit, or a refusal
    // message) and this test must stay green for that refusal
    const blessed = r.status === 0 && /merged under override/.test(r.stdout)
    const drifted = merged !== "" && merged !== judgedSha
    assert.ok(
      !(blessed && drifted),
      "INV-4 (verdicts are honest) + ship.ts's own 'never stale bytes' law: the verdict judged " +
        `${judgedSha.slice(0, 8)} but the merge executed at ${merged.slice(0, 8)} (a push landed on the branch inside ` +
        "ship's own window — the momentum-200 class on the arm that MERGES) and the door blessed it anyway: " +
        `"${(r.stdout + r.stderr).trim().split("\n").at(-1)}". The override must re-verify the head at the merge boundary and refuse the drift.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
