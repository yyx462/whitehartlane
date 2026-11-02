// momentum-1004 (momentum lens — the long trace / lifecycle ordering).
//
// THE --auto MINT RE-RESOLVES THE BASE INSIDE THE INNER DOOR: the
// reviewed range is not the range the gate classified.
//
// The change's own law (bin/whitehartlane, the mint's comment):
//
//   // the levy judges the EXACT bytes the gate decided on (momentum-2
//   // + momentum-200): ONE "which bytes" site — the gate's own
//   // resolution, handed down verbatim.
//
// and the fall-through arm of the SAME door honours it:
//
//   base: gateBaseSha ?? val("base"),     ← the gate's resolved sha
//   baseBranch: val("base"),              ← the name beside it
//
// The MINT arm does not:
//
//   "--base", q(baseRef),                 ← a REF, re-resolved inside
//                                          prepareReview, at levy time
//   "--head", q(headPinned),              ← the head IS pinned
//
// so the base is the second "which bytes" site the change claims to
// have eliminated: the gate classifies base@T0..head, the levy judges
// base@T1..head, and base@T1 is whatever the trunk's tip is when the
// levy materializes.
//
// THE REACHABLE HARM: a trunk that moves in the window between the
// gate's decision and the levy's materialization — the window the
// change's own jev comment names ("across the gate's own jev window").
// The inner door's direction check then REFUSES ("head is not ahead of
// base") and the commission ends with NO verdict and NO review, while
// the gate's ledger row says action=review.
//
// The root cause is the missing twin of `--head-branch`: the grammar
// gained `--head-branch` (so the head's NAME rides beside the head's
// pinned sha) but never gained `--base-branch` — so the mint could
// carry the base's sha OR its name, never both, and it chose the
// name. The fall-through arm carries both because it has both fields.
//
// BASE behaviour: `--auto` does not exist on BASE (the whole mint is
// introduced by this diff) → no levy is ever minted → the conditional
// assertion passes → the prove gate classifies this as introduced.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const ROOT = join(import.meta.dirname, "..", "..")
const BIN = join(ROOT, "bin", "whitehartlane")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// the mint spawns a DETACHED watcher that polls for the seat for two
// hours — a scratch drive must not leave it behind (the leaked-lens
// receipt)
const killWatchers = (out: string) => {
  const wrapper = `${out}.supervisor.log.watch`
  try {
    const ps = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" })
    for (const line of ps.split("\n")) {
      if (!line.includes(wrapper)) continue
      const pid = Number(line.trim().split(/\s+/)[0])
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGKILL")
        } catch {
          /* already gone */
        }
      }
    }
  } catch {
    /* ps unavailable — the repo's own sweeper has the last word */
  }
}

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

// the jev stub the gate's own tests use: every lens at 0.9 → the
// caller's gate keeps the full roster and decides REVIEW (a non-empty
// roster ⇒ no audit roll ⇒ deterministic)
function jevStub(dir: string): string {
  const answers: Record<string, { type: string; noul: number }> = {}
  for (const l of ["principles", "tests", "momentum", "questions"]) answers[`l_${l}`] = { type: "noul", noul: 0.9 }
  const p = join(dir, "jev-stub.sh")
  writeFileSync(p, `#!/bin/sh\necho '${JSON.stringify({ answers })}'\n`)
  chmodSync(p, 0o755)
  return p
}

// a supervisor stub: record the levy command it was handed, then exit
const supervisorStub = (dir: string): string => {
  const p = join(dir, "supervisor-stub.sh")
  writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' "$@" > ${join(dir, "levy-argv.txt")}\nexit 0\n`)
  chmodSync(p, 0o755)
  return p
}

// a no-op orchestrator door: the inner levy books a job and spawns
// this instead of a real worker (the repo's own stub does the same)
const orchestratorStub = (dir: string): string => {
  const p = join(dir, "orchestrator-stub.mjs")
  writeFileSync(p, "process.exit(0)\n")
  return p
}

test("momentum-1004: the minted levy must judge the range the GATE classified — the base is pinned beside its branch name, not re-resolved", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom1004-"))
  const out = join(tmp, "out")
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const home = join(tmp, "home")
    mkdirSync(home, { recursive: true })
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AGENTIC_OS_HOME: home,
      AGENTIC_OS_NOTIFY: "0",
      WHL_GATE_LEDGER: join(tmp, "gate.jsonl"),
      WHL_JEV_BIN: jevStub(tmp),
      WHL_SUPERVISOR_BIN: supervisorStub(tmp),
      AGENTIC_OS_ORCHESTRATOR: orchestratorStub(tmp),
    }
    delete env.WHL_FROM
    delete env.HERDR_ENV
    delete env.HERDR_PANE_ID
    delete env.OPENCODE_SESSION_ID
    delete env.WHL_GATE
    delete env.AGENTIC_OS_JID

    // the outer door: the gate decides REVIEW, then the mint runs.
    // The gate's OWN resolution is the trunk tip NOW, BEFORE the door
    // runs (CORRECTED ADOPTED-WITH-THE-FIX: the original fixture
    // computed this AFTER the trunk moved — asserting the exact
    // re-resolution the finding condemns; no pinned base could ever
    // have matched it).
    const gateBaseSha = execFileSync("git", ["-C", repo, "rev-parse", "main^{commit}"], { encoding: "utf8" }).trim()
    const outer = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--auto", "--pr", "42", "--model", "p/m", "--out", out],
      { env, encoding: "utf8", timeout: 120_000 },
    )
    assert.equal(outer.status, 0, `the outer door failed: ${outer.stdout}\n${outer.stderr}`)

    // the supervisor stub records the brief it was handed — wait for it
    // (the watcher spawns it asynchronously; a read that races the
    // spawn would make this repro FLAKY, not green)
    const argvFile = join(tmp, "levy-argv.txt")
    for (let i = 0; i < 50 && !existsSync(argvFile); i++) await sleep(100)
    if (!existsSync(argvFile)) return // BASE: no mint, no levy — nothing to assert

    // the supervisor is handed the BRIEF, which carries the levy command
    const brief = readFileSync(argvFile, "utf8")
    const levyLine = brief.split("\n").find((l) => l.includes("review") && l.includes("--base"))
    assert.ok(levyLine, `the brief must carry the levy command: ${brief}`)
    const levy = levyLine.split(" ").filter(Boolean)

    // ---- the reachable harm: the trunk moves between the gate's
    // decision and the levy's materialization
    execFileSync("git", ["-C", repo, "checkout", "-q", "main"], { encoding: "utf8" })
    writeFileSync(join(repo, "src", "trunk.ts"), "export const trunk = () => true\n")
    execFileSync("git", ["-C", repo, "add", "-A"], { encoding: "utf8" })
    execFileSync("git", ["-C", repo, "commit", "-qm", "trunk moves"], { encoding: "utf8" })
    execFileSync("git", ["-C", repo, "checkout", "-q", "feat"], { encoding: "utf8" })

    const inner = spawnSync("/bin/sh", ["-c", levy.join(" ")], { env, encoding: "utf8", timeout: 120_000 })
    const innerOut = `${inner.stdout ?? ""}\n${inner.stderr ?? ""}`
    assert.ok(
      !/not ahead of base/.test(innerOut),
      `the levy refused the review because the base moved after the gate decided: ${innerOut.trim()}\n— the gate classified one range (base@T0..head) and the levy judged (or refused) another (base@T1..head); the commission ends with NO verdict while the gate's ledger row says action=review`,
    )

    // ---- the invariant's crisp form: the minted levy must carry the
    // base the GATE resolved (captured BEFORE the door ran — the
    // original computed it after the trunk moved, asserting the exact
    // re-resolution the finding condemns)
    const baseIdx = levy.indexOf("--base")
    assert.ok(baseIdx !== -1, "the minted levy must name its base")
    const mintedBase = levy[baseIdx + 1]
    assert.equal(
      mintedBase,
      gateBaseSha,
      `the minted levy re-resolves the base (${mintedBase}) instead of riding the gate's own resolution (${gateBaseSha}) — a second "which bytes" site, and a trunk move between the gate and the levy changes the judged range`,
    )
  } finally {
    killWatchers(out)
    rmSync(tmp, { recursive: true, force: true })
  }
})
