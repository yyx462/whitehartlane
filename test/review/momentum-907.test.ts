// momentum-907 — the minted levy must run the DOOR THAT MINTED IT.
//
// What this change adds (bin/whitehartlane:536-552): the parentless
// --auto flow mints a supervisor and hands it a levy:
//
//   const levy = ["whl", "review", q(repoAbs), "--base", …, "--head", …,
//                 "--model", …, "--title", …, "--out", …, "--merge-cmd", …,
//                 "--roster", q(rosterCsv), "--pr", pr, "--unattended"].join(" ")
//   spawnSupervisor({ brief: supervisorBrief({ levyCmd: levy, … }), … })
//
// The levy is the door's OWN decision, handed down: the pinned shas
// ("the levy judges the EXACT bytes the gate decided on"), the roster
// ("one commission, one gate row; the minted levy must not re-ask a
// stochastic judge the same question"), --pr (so an inner skip still
// reaches the PR) — and the verdict SEAT the watcher polls
// ("verdict: will land at <out>/data/review/verdict.json",
// src/doors/ship-supervisor.ts:30 / the watcher script's OUT poll).
//
// All of that is understood ONLY by the door that minted it:
//   - `--roster`/`--pr` are new flags in THIS change (bin/whitehartlane:
//     363-374, 407-411); an older door ignores them → the gate runs a
//     SECOND time (a second stochastic draw + a second ledger row —
//     proven: the base door writes a ledger row where this door's roster
//     pin writes none) and no skip receipt reaches the PR.
//   - the verdict SEAT is created by THIS change's staging
//     (src/doors/run.ts:142 linkVerdictSeat, called from stageRun and
//     from bin/whitehartlane:653). An older door never creates it — it
//     prints the SAME promise ("verdict: will land at
//     <out>/data/review/verdict.json") over a path that never appears,
//     so the watcher burns its 7200s deadline and reports a FALSE
//     timeout on a PR whose review actually finished.
//
// The levy names the bare word "whl", so the PATH decides which door
// runs: on this machine /Users/sagebot/.local/bin/whl → the MASTER
// checkout, while the door under review is the feature checkout
// (data/review/config.sh: REPO=…/whitehartlane/auto-ship-gate). The
// mint knows its own path (import.meta.dirname) and does not use it.
//
// The repro drives the REAL door's --auto path (a stub supervisor bin
// captures the brief) and asserts that the levy it mints names THIS
// door by path.
//
// BASE behaviour: the base door has no --auto at all (no brief, no
// mint) → the first assertion fails on BASE too, and the diff DOES
// touch bin/whitehartlane → the prove gate classifies this as an
// incomplete-fix of the auto ship flow.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const repoRoot = new URL("../../", import.meta.url)
const doorPath = new URL("bin/whitehartlane", repoRoot).pathname

const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

test("the minted levy must run the door that minted it", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom907-"))
  const repo = join(tmp, "repo")
  mkdirSync(join(repo, "src"), { recursive: true })
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init", "-q", "-b", "main", ".")
  g("config", "user.email", "t@t.local")
  g("config", "user.name", "t")
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
  g("add", "-A")
  g("commit", "-qm", "base")
  g("checkout", "-qb", "feat")
  writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
  g("add", "-A")
  g("commit", "-qm", "feat")

  // a stub orchestrator: the sandbox must never book a REAL workflow
  // (the leaked-lens receipt, 2026-10-30)
  const orch = join(tmp, "orchestrator-stub.mjs")
  writeFileSync(orch, "process.exit(0)\n")
  // a dead jev: the gate's judgment fails fast → the fail-safe full rail
  const jevDead = join(tmp, "jev-dead")
  writeFileSync(jevDead, "#!/bin/sh\nexit 1\n")
  chmodSync(jevDead, 0o755)
  // a stub supervisor bin: the door mints the supervisor against it and
  // writes the brief beside the log
  const stubBin = join(tmp, "stub-opencode")
  writeFileSync(stubBin, "#!/bin/sh\nexit 0\n")
  chmodSync(stubBin, 0o755)

  const home = join(tmp, "home")
  const out = join(tmp, "out")
  const env = {
    ...process.env,
    AGENTIC_OS_HOME: home,
    AGENTIC_OS_ORCHESTRATOR: orch,
    AGENTIC_OS_NOTIFY: "0",
    WHL_GATE_LEDGER: join(tmp, "gate.jsonl"),
    WHL_JEV_BIN: jevDead,
    WHL_SUPERVISOR_BIN: stubBin,
    // no traceable parent: the mint's own path
    OPENCODE_SESSION_ID: "",
    HERDR_ENV: "",
    HERDR_PANE_ID: "",
    WHL_FROM: "",
  }
  delete (env as Record<string, string | undefined>).AGENTIC_OS_JID

  try {
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", doorPath, "review", repo, "--pr", "42", "--auto", "--model", "p/m", "--base", "main", "--head", "feat", "--out", out],
      { env, encoding: "utf8", timeout: 60_000, cwd: tmp },
    )
    const briefPath = `${out}.supervisor.log.brief`
    // NOTE: only the door's STDOUT rides in the message — the prove gate
    // reads a module-error pattern in the test output as a LOAD error
    // (never a verdict), and a raw stderr would smuggle one in.
    assert.ok(
      existsSync(briefPath),
      `the --auto path must mint a supervisor and write its brief (exit ${r.status}; stdout: ${r.stdout})`,
    )
    const brief = readFileSync(briefPath, "utf8")
    const levyLine = brief.split("\n").find((l) => /^\s+\S+\s+review\s/.test(l)) ?? ""
    const levy = levyLine.trim()
    assert.ok(levy.length > 0, `the brief must carry the levy command (brief: ${brief.slice(0, 400)})`)
    const token = levy.split(" ")[0]
    assert.ok(
      token.startsWith("/"),
      `the minted levy must name the door that minted it BY PATH, not a PATH word: it says '${token}', so the levy runs whatever install the PATH names — a door that knows neither --roster/--pr nor the verdict seat the watcher polls (one commission would then get a SECOND gate row, no PR receipt, and a false 2h timeout). Levy: ${levy}`,
    )
    assert.ok(
      existsSync(token),
      `the minted levy's door must exist: '${token}' does not (levy: ${levy})`,
    )
  } finally {
    // the minted watcher polls for 2h — leave nothing behind
    spawnSync("pkill", ["-f", `${out}.supervisor.log.watch`], { encoding: "utf8" })
    rmSync(tmp, { recursive: true, force: true })
  }
})
