// momentum-15 — INV-6 (one wake per commission; a Job nobody hears
// finishing is an information gap — AGENTS.md whl-driving law): the
// --auto flow MINTS a hearer for a parentless commission, but the
// commission it hands that hearer can finish WITHOUT a verdict — and
// on that finish the PR is never reached. The caller's gate said
// "review" and spawned the supervisor; the supervisor's levy is a
// BARE `whl review ... --unattended` (no --pr, nothing binding the
// caller's decision), so the inner process re-runs the gate (jev is
// per-call: it can now say skip) and returns at bin/whitehartlane's
// skip block — no data/review/verdict.json is ever written, and the
// skip receipt cannot post to the PR because the levy dropped --pr.
// The brief's ONLY PR-reaching step (ship-supervisor.ts step 2/3)
// assumes the verdict file exists. Same silence when the inner door
// REFUSES before the rail (base drift, admission). The change's own
// claim — "posts the verdict to the PR" (help text, module header) —
// is false on that path. Drives the REAL bin with a stubbed jev
// (0.9 → the caller's gate decides review deterministically) and a
// recording supervisor stub.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const ROOT = join(import.meta.dirname, "..", "..")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (args: string) => execFileSync("git", args.split(" "), { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  writeFileSync(join(where, "README.md"), "# demo\n")
  g("add -A")
  g("commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\nexport const waitFast = () => true\n")
  g("add -A")
  g("commit -qm feat")
  return where
}

// the jev stub of the gate's own tests: all four lenses at 0.9 — the
// caller's gate keeps the full roster and decides REVIEW (roster
// non-empty ⇒ no audit roll ⇒ deterministic)
function jevStub(dir: string): string {
  const answers: Record<string, { type: string; noul: number }> = {}
  for (const l of ["principles", "tests", "momentum", "questions"]) answers[`l_${l}`] = { type: "noul", noul: 0.9 }
  const p = join(dir, "jev-stub.sh")
  writeFileSync(p, `#!/bin/sh\necho '${JSON.stringify({ answers })}'\n`)
  chmodSync(p, 0o755)
  return p
}

test("momentum-15: --auto's commission must still reach the PR when the levy ends WITHOUT a verdict", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom15-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const home = join(tmp, "home")
    mkdirSync(home)
    const capture = join(tmp, "supervisor-argv.txt")
    const sup = join(tmp, "sup-stub.sh")
    writeFileSync(sup, `#!/bin/sh\nprintf '%s\\n' "$@" > ${capture}\n`)
    chmodSync(sup, 0o755)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AGENTIC_OS_HOME: home,
      AGENTIC_OS_NOTIFY: "0",
      WHL_GATE_LEDGER: join(home, "gate.jsonl"),
      WHL_JEV_BIN: jevStub(tmp),
      WHL_SUPERVISOR_BIN: sup,
    }
    delete env.WHL_FROM
    delete env.HERDR_ENV
    delete env.HERDR_PANE_ID
    delete env.OPENCODE_SESSION_ID
    delete env.WHL_GATE
    const out = join(tmp, "autorun")
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", join(ROOT, "bin", "whitehartlane"), "review", repo, "--auto", "--pr", "42", "--model", "acme/strong", "--out", out, "--base", "main", "--head", "feat"],
      { env, encoding: "utf8" },
    )
    // the door minted the supervisor; the stub recorded the commission
    let brief = ""
    for (let i = 0; i < 100 && !brief; i++) {
      await sleep(50)
      if (existsSync(capture)) brief = readFileSync(capture, "utf8")
    }
    assert.ok(brief, "the supervisor was minted and its commission captured (the caller's gate said review)")
    const b = brief.trim().split("\n").slice(2).join("\n") // drop `run` / `--standalone`
    const levy = b.match(/^\s*(\S+ review .+)$/m)?.[1] ?? ""
    assert.ok(levy, "the brief carries the levy command verbatim")
    // THE LAW (INV-6 — one wake per commission): a verdict-LESS finish
    // of the levy (the inner gate re-decides skip; the inner door
    // refuses at intake) must still reach PR #42. Either the levy
    // carries --pr so the inner skip posts its receipt to the PR, or
    // the brief tells the hearer what to do when verdict.json is
    // absent. Today BOTH are false: the PR never hears.
    assert.ok(
      /(^|\s)--pr(\s|$)/.test(levy) || /absent|missing|does not exist|no verdict|without a verdict/i.test(b),
      "INV-6 (one wake per commission): the --auto commission can finish verdict-less (the inner `whl review` re-runs the gate and may skip — the levy carries no --pr, and an inner skip posts nothing to the PR) " +
        `yet the supervisor's only PR-reaching step assumes verdict.json exists. levy=${JSON.stringify(levy)}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
