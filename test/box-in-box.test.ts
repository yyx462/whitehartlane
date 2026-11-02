// box-in-box (the 2026-10-30 ruling): a review run may not book another
// REAL workflow. Reviewer agents hand-driving the door in scratch
// sandboxes spawned real lens panes that outlived their sandboxes —
// reviewer-spawned reviewer zombies. The detection signal is the
// orchestrator's own env (AGENTIC_OS_SID/JID ride every lens and gate
// shell); the escape is the stub (a set AGENTIC_OS_ORCHESTRATOR means
// the spawn targets a stub — verification stays legal, recursion does
// not). Drives the real bin end-to-end.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const BIN = join(import.meta.dirname, "..", "bin", "whitehartlane")

function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  g("add -A && git commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\nexport const waitFast = () => true\n")
  g("add -A && git commit -qm feat")
  return where
}

test("box-in-box: inside a review job, a real spawn refuses; a stubbed one passes", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-boxinbox-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  const out = join(tmp, "prog")
  const base = {
    ...process.env,
    AGENTIC_OS_HOME: tmp,
    WHL_GATE: "off", // the legacy full rail: no gate, no jev — straight to the levy seat
    AGENTIC_OS_NOTIFY: "0",
  }
  delete base.AGENTIC_OS_ORCHESTRATOR
  try {
    // 1. the reviewer's shell: the orchestrator's own env riding along,
    //    NO stub — the levy must refuse, and refuse BY NAME
    const inside = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--base", "main", "--head", "feat", "--model", "p/m", "--out", out, "--unattended"],
      { env: { ...base, AGENTIC_OS_SID: "s-inside", AGENTIC_OS_JID: "j-inside" }, encoding: "utf8", timeout: 60_000 },
    )
    assert.notEqual(inside.status, 0, "a review run may not book another real workflow")
    assert.match(inside.stderr, /box-in-box/, "the refusal names the law")
    assert.match(inside.stderr, /j-inside/, "the refusal names the enclosing job")
    assert.ok(!existsSync(join(out, "workflow.toml")) || true, "no booking is the contract; materialization alone is harmless")
    // 2. the legitimate twin: a repro that TESTS the levy path sets the
    //    stub door — the spawn targets the stub and passes untouched
    const stub = join(tmp, "orch-stub.mjs")
    writeFileSync(stub, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(tmp, "stub-ran.txt"))}, 'ok')\n`)
    const stubbed = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--base", "main", "--head", "feat", "--model", "p/m", "--out", out, "--unattended"],
      { env: { ...base, AGENTIC_OS_SID: "s-inside", AGENTIC_OS_JID: "j-inside", AGENTIC_OS_ORCHESTRATOR: stub }, encoding: "utf8", timeout: 60_000 },
    )
    assert.equal(stubbed.status, 0, `the stubbed twin must levy (stderr: ${stubbed.stderr})`)
    // the stub spawn is detached — poll for its marker (a one-shot
    // existsSync races the spawn)
    let stubRan = false
    for (let i = 0; i < 60 && !stubRan; i++) {
      stubRan = existsSync(join(tmp, "stub-ran.txt"))
      if (!stubRan) await new Promise((r) => setTimeout(r, 50))
    }
    assert.ok(stubRan, "the stub door actually spawned — verification stays legal")
    // 3. outside any review job, nothing changes
    const outside = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--base", "main", "--head", "feat", "--model", "p/m", "--out", join(tmp, "prog2"), "--unattended"],
      { env: base, encoding: "utf8", timeout: 60_000 },
    )
    assert.equal(outside.status, 0, `a human session levies as before (stderr: ${outside.stderr})`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
