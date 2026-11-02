// momentum-2101 — the ship watcher must not ANNOUNCE an outcome before the
// commission ended.
//
// The change's own law (src/doors/ship-supervisor.ts, the watcher script and
// the brief it writes):
//
//   "THE SEAT (principles-4004): the commission ends with the MERGE stage —
//    the merge stage writes the outcome marker into the staged program dir,
//    and the watcher waits on exactly that. The verdict (prove) lands two
//    stages earlier; waiting on it would speak before the feedback map
//    exists."
//
// and (the brief's step 2, same file):
//
//   "Wait on NOTHING EARLIER: the verdict is written three stages before the
//    end, and a supervisor that wakes on it posts a receipt before the
//    feedback map exists and announces a merge that has not run (the
//    2026-10-30 twin-seat lesson: the brief and the watcher are two answers
//    to ONE question — this is the seat they share)."
//
// The BRIEF was fixed to wait on the MERGE seat. The WATCHER was not: its
// early-exit arm still keys on the VERDICT seat —
//
//   if [ -f "$OUT/data/review/verdict.json" ] && ! kill -0 "$AGENT"; then break; fi
//
// The agent's death says NOTHING about the CHAIN's state: the levy books the
// job and returns, the chain (intake → lenses → prove → divide → merge)
// keeps running under the orchestrator, and the divide stage — a SOLO MIND
// that writes the feedback map — sits BETWEEN the verdict and the merge.
//
// So on the reachable arc "the supervisor agent dies while the chain is still
// in divide", the watcher breaks out of the merge-seat wait the moment the
// verdict lands, the backstop posts the VERDICT's outcome to the PR, and the
// PR hears "ship-gate: accept — the supervisor did not post" for a merge
// that has NOT run — exactly the harm the twin-seat lesson names.
//
// BASE behaviour: the base door has no --auto path and no watcher at all →
// the gh stub records nothing → the assertion (the PR must NOT hear) PASSES
// on BASE, and the diff DOES touch bin/whitehartlane → the prove gate
// classifies this as introduced.
//
// The repro drives the REAL door's --auto path (the door writes and spawns
// the real watcher script) with a stub supervisor bin that exits at once (a
// dead agent), a landed verdict and NO merge marker, and asserts the PR was
// NOT told an outcome.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const repoRoot = new URL("../../", import.meta.url)
const doorPath = new URL("bin/whitehartlane", repoRoot).pathname

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("the watcher must not speak before the MERGE seat resolves — the verdict is two stages early", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom2101-"))
  const repo = join(tmp, "repo")
  mkdirSync(join(repo, "src"), { recursive: true })
  const g = (...a: string[]) => spawnSync("git", a, { cwd: repo, encoding: "utf8" })
  for (const c of [
    ["init", "-q", "-b", "main", "."],
    ["config", "user.email", "t@t.local"],
    ["config", "user.name", "t"],
  ]) g(...c)
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
  g("add", "-A")
  g("commit", "-qm", "base")
  g("checkout", "-qb", "feat")
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
  g("add", "-A")
  g("commit", "-qm", "feat")

  const orch = join(tmp, "orchestrator-stub.mjs")
  writeFileSync(orch, "process.exit(0)\n")
  const jevDead = join(tmp, "jev-dead")
  writeFileSync(jevDead, "#!/bin/sh\nexit 1\n")
  chmodSync(jevDead, 0o755)
  // a DEAD supervisor agent (the documented arc: no auth, no model)
  const stubBin = join(tmp, "stub-opencode")
  writeFileSync(stubBin, "#!/bin/sh\nexit 0\n")
  chmodSync(stubBin, 0o755)
  // the gh stub: every comment the flow posts is recorded
  const bin = join(tmp, "bin")
  mkdirSync(bin, { recursive: true })
  const comments = join(tmp, "gh-comments.txt")
  const ghStub = join(bin, "gh")
  writeFileSync(ghStub, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(comments)}\nexit 0\n`)
  chmodSync(ghStub, 0o755)

  const out = join(tmp, "out")
  // the VERDICT landed (the prove stage) — and the chain has NOT reached
  // the merge stage: no merge marker exists. The commission has not ended.
  mkdirSync(join(out, "data", "review"), { recursive: true })
  writeFileSync(
    join(out, "data", "review", "verdict.json"),
    JSON.stringify({ verdict: "accept", head: "a".repeat(40), blocked: [] }),
  )
  assert.ok(!existsSync(join(out, "data", "review", "merge.json")), "the merge seat is absent — the commission has not ended")

  const env = {
    ...process.env,
    AGENTIC_OS_HOME: join(tmp, "home"),
    AGENTIC_OS_ORCHESTRATOR: orch,
    AGENTIC_OS_NOTIFY: "0",
    WHL_GATE_LEDGER: join(tmp, "gate.jsonl"),
    WHL_JEV_BIN: jevDead,
    WHL_SUPERVISOR_BIN: stubBin,
    OPENCODE_SESSION_ID: "",
    HERDR_ENV: "",
    HERDR_PANE_ID: "",
    WHL_FROM: "",
    PATH: `${bin}:${process.env.PATH ?? ""}`,
  }
  delete (env as Record<string, string | undefined>).AGENTIC_OS_JID

  try {
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", doorPath, "review", repo, "--pr", "42", "--auto", "--model", "p/m", "--base", "main", "--head", "feat", "--out", out],
      { env, encoding: "utf8", timeout: 60_000, cwd: tmp },
    )
    assert.ok(
      existsSync(`${out}.supervisor.log.watch`),
      `the --auto path must mint the watcher (exit ${r.status}; stdout: ${r.stdout}; stderr: ${r.stderr})`,
    )
    // give the watcher several beats (its own poll is 1s)
    for (let i = 0; i < 60 && !existsSync(comments); i++) await sleep(100)

    assert.ok(
      !existsSync(comments),
      `the PR must not hear an outcome before the MERGE seat resolves — the watcher announced the verdict's outcome (${existsSync(comments) ? readFileSync(comments, "utf8").trim() : ""}) while the chain had not reached the merge stage; the verdict lands TWO stages early (prove → divide → merge) and a receipt there announces a merge that has not run`,
    )
  } finally {
    spawnSync("pkill", ["-f", `${out}.supervisor.log.watch`], { encoding: "utf8" })
    rmSync(tmp, { recursive: true, force: true })
  }
})
