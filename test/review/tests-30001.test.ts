// tests-30001 — the watcher must still CARRY THE OUTCOME when the chain
// dies BEFORE the merge stage.
//
// WHAT THE DIFF CLAIMS (src/doors/ship-supervisor.ts, the watcher's own
// words, this commit):
//
//   // ONE SEAT (momentum-2101, 2026-11-02): there is NO verdict-seat
//   // break — the verdict lands three stages before the merge stage,
//   // and a watcher that wakes on it posts the outcome before the
//   // commission has ended (the twin-seat harm this file's own
//   // comments name). The loop waits for the MERGE seat alone; a
//   // dead agent's receipt lands either at the merge seat (the
//   // backstop below, reading the merge payload) or at the 2h
//   // deadline arm above (dead → it posts).
//
// The diff DELETED the only arm that ended the wait when the chain died
// early:
//
//   -  if [ -f "$OUT/data/review/verdict.json" ] && ! kill -0 "$AGENT" 2>/dev/null; then break; fi
//
// and the comment that sat DIRECTLY ABOVE it — still in the file, still
// the law — says why that arm existed:
//
//   // a chain that died BEFORE the merge stage (the divide stage
//   // failed, the rail refused) leaves a verdict and no marker — the
//   // PR must still hear (momentum-908), so the verdict's presence
//   // ends the wait too (a POSITIVE test, not a poll: the law is
//   // about the seat the wait resolves on)
//
// So the file keeps the PROMISE ("the PR must still hear") and deletes
// the ARM that kept it. What is left is a TIMER: the loop spins until
// i >= 7200 (7200 x 1s = TWO HOURS) and then posts
//
//   ship-gate: the review timed out (2h) — no outcome landed at <dir>
//
// which is a FALSE outcome: the review did NOT time out — it finished,
// it judged, and its verdict is sitting at the verdict seat. The PR
// hears a lie about a review that already happened, two hours late.
//
// REACHABLE PATH: the levy is DETACHED (the supervisor agent dies at
// once — no auth, no model: the arc momentum-905 names) while the
// chain runs on; the chain dies at the divide stage (the rail refused
// / the divide stage failed) — the verdict landed, the merge seat never
// did. Nothing else in the watcher ends the wait: the gone-world arm
// needs the seat dir to VANISH, the 2h arm needs two hours.
//
// BASE behaviour: the base door has no --auto path and no watcher at
// all, so the gh stub records nothing and this assertion FAILS on BASE
// too; the diff DOES touch bin/whitehartlane and src/doors/ship-
// supervisor.ts → the prove gate classifies it as an incomplete-fix.
//
// The repro drives the REAL door's --auto path (the door writes and
// spawns the real watcher script) with a stub supervisor bin that dies
// at once, a LANDED verdict and NO merge seat.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const repoRoot = new URL("../../", import.meta.url)
const doorPath = new URL("bin/whitehartlane", repoRoot).pathname

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("tests-30001: a chain that died before the merge stage must still be heard — the watcher waits on a state, not a 2h timer", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-t30001-"))
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

  // a no-op orchestrator stub — a scratch drive must never book a real workflow
  const orch = join(tmp, "orchestrator-stub.mjs")
  writeFileSync(orch, "process.exit(0)\n")
  const jevDead = join(tmp, "jev-dead")
  writeFileSync(jevDead, "#!/bin/sh\nexit 1\n")
  chmodSync(jevDead, 0o755)
  // a DEAD supervisor agent (no auth, no model)
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
  // THE VERDICT LANDED (the prove stage) — and the chain NEVER reached
  // the merge stage: no merge seat. The commission is over; the PR
  // must hear WHY.
  mkdirSync(join(out, "data", "review"), { recursive: true })
  writeFileSync(
    join(out, "data", "review", "verdict.json"),
    JSON.stringify({ verdict: "reject", head: "a".repeat(40), blocked: [{ id: "m-1", severity: "P1", claim: "c" }] }),
  )
  assert.ok(!existsSync(join(out, "data", "review", "merge.json")), "the merge seat is absent — the chain died before the merge stage")

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
    // the watcher's own poll is 1s; the deleted arm fired on its FIRST
    // beat (t≈1s). 12s is a 6x margin over that and keeps the whole
    // repro inside prove.sh's 20s per-run cap.
    for (let i = 0; i < 120 && !existsSync(comments); i++) await sleep(100)

    assert.ok(
      existsSync(comments),
      `INV-1/INV-4: the PR must hear the outcome when the chain dies BEFORE the merge stage — ` +
        `the watcher now waits for the merge seat ALONE (the verdict-seat break was deleted), so the ` +
        `only remaining ends are the gone-world arm (needs the seat dir to vanish) and the 2h deadline ` +
        `arm: the PR sits silent for TWO HOURS and then is told "the review timed out (2h) — no outcome ` +
        `landed at <dir>", which is FALSE — the review finished and its verdict is sitting at the verdict ` +
        `seat. The file's own comment above the deleted arm still says "the PR must still hear ` +
        `(momentum-908), so the verdict's presence ends the wait too".`,
    )
    assert.match(
      readFileSync(comments, "utf8"),
      /pr comment 42/,
      "the receipt must reach the PR",
    )
  } finally {
    spawnSync("pkill", ["-f", `${out}.supervisor.log.watch`], { encoding: "utf8" })
    rmSync(tmp, { recursive: true, force: true })
  }
})
