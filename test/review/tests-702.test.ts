import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// the gate's ledger + label scan ride the OS-disk trace — pin both at
// temp disks before anything reads them (the repo's own repro convention)
const STORE = mkdtempSync(join(tmpdir(), "whl-t702-store-"))
process.env.AGENTIC_OS_HOME = STORE
process.env.WHL_GATE_LEDGER = join(STORE, "gate.jsonl")
process.env.AGENTIC_OS_NOTIFY = "0"

// BASE shape: no gate module exists there — nothing to judge (the
// momentum-14 device: guarded dynamic import, vacuous green on BASE)
const GATE_URL = new URL("../../src/doors/review-gate.ts", import.meta.url)
const gate = existsSync(GATE_URL) ? await import(GATE_URL) : undefined

// INV-4 (the fail-safe claim, inverted on its own edge): review-gate.ts:14-16 —
//   "Fail-safe: jev unreachable/unparsable → every lens runs —
//    uncertainty ALWAYS defaults to reviewing."
// jevLenses already treats ONE shape of garbage as unparsable: a
// missing answer or a non-finite number returns null → full rail
// (review-gate.ts:254-255: `typeof n !== "number" ||
// !Number.isFinite(n)` → null). A FINITE number OUTSIDE the noul
// domain [0,1] is the same garbage one shape later — and it is
// TRUSTED: decideGate (:299) reads `(ps[l] ?? 1) >= LENS_KEEP_THRESHOLD`
// with no range check, so a judge answering noul:-1 (or any < 0.35)
// for all four lenses produces roster=[] and — on a decayed class, with
// the audit roll landing above the rate — the decision is a PLAIN skip:
//
//   action:"skip", audit:false — the bin returns, NOTHING levies.
//
// The rail is silently off, decided by a broken judge, in the exact
// direction the fail-safe law exists to forbid (vanish, not review).
// WHL_JEV_BIN makes this reachable with any misbehaving binary — the
// override exists precisely so the judge is swappable, and the
// script's half of the division of labor is "the script ENFORCES"
// (review-gate.ts:11): domain-validating the judgment is enforcement,
// not judgment.
//
// Scripted, no timing: three green audited skips seed the class to
// rate 0.25 (verdict.json files label the rows), the roll is pinned
// above the rate so the audit does not mask the trust decision, and
// the stub jev answers noul:-1 ×4.
test("an out-of-domain noul must fail safe to the full rail, never to a silent skip", () => {
  if (!gate) return // BASE: no gate — nothing to judge
  const { appendLedgerRow, runGate } = gate as typeof import("../../src/doors/review-gate.ts")

  const tmp = mkdtempSync(join(tmpdir(), "whl-t702-"))
  const realRandom = Math.random
  try {
    // ── seed the class to a decayed rate: 3 audited skips, each labeled
    // green by a verdict.json for its headSha
    for (let i = 0; i < 3; i++) {
      appendLedgerRow({
        repo: "seed", head: "h", headSha: `green-${i}`, klass: "code_small",
        files: 1, churn: 1, hot: [], ps: null, roster: [], action: "skip", audit: true,
      })
      const vdir = join(STORE, "sessions", `s-g${i}`, "jobs", `j-g${i}`, "run", "data", "review")
      mkdirSync(vdir, { recursive: true })
      writeFileSync(join(vdir, "verdict.json"), JSON.stringify({ verdict: "accept", head: `green-${i}`, blocked: [] }))
    }

    // ── the broken judge: finite numbers, outside [0,1]
    const stub = join(tmp, "jev-neg.sh")
    const answers = ["principles", "tests", "momentum", "questions"]
      .map((l) => `"l_${l}":{"type":"noul","noul":-1}`)
      .join(",")
    writeFileSync(stub, `#!/bin/sh\necho '{"answers":{${answers}}}'\n`)
    chmodSync(stub, 0o755)
    process.env.WHL_JEV_BIN = stub

    // ── the diff under decision: a real code change
    const repo = join(tmp, "repo")
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" })
    g("init", "-q", "-b", "main")
    g("config", "user.email", "t@t.local")
    g("config", "user.name", "t")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
    g("add", "-A")
    g("commit", "-q", "-m", "base")
    g("checkout", "-q", "-b", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 2\n")
    g("add", "-A")
    g("commit", "-q", "-m", "feat")

    Math.random = () => 0.9 // above the decayed rate: no audit masks the decision
    let decision: { action: string; audit: boolean; roster: string[]; auditRate: number; greens: number }
    try {
      decision = runGate(repo, "main", "feat").decision
    } finally {
      Math.random = realRandom
      delete process.env.WHL_JEV_BIN
    }

    // premise checks: the seeded labels registered and the roll is out
    // of the audit's way — the fault below is the TRUST decision alone
    assert.equal(decision.greens, 3, "premise: the seeded greens registered")
    assert.equal(decision.auditRate, 0.25, "premise: the class is decayed (greens >= 3)")
    assert.notEqual(decision.audit, true, "premise: the roll sat above the rate — no audit ran")

    assert.equal(
      decision.action,
      "review",
      `INV-4 (fail-safe inverted): review-gate.ts:14-16 promises "jev unreachable/unparsable → every lens ` +
        `runs — uncertainty ALWAYS defaults to reviewing", and :254-255 already treats non-finite answers as ` +
        `unparsable (null → full rail). A finite noul OUTSIDE [0,1] is the same broken-judge garbage one shape ` +
        `later, but decideGate (:299) trusts it raw: four noul:-1 answers yielded action=${decision.action}, ` +
        `audit=${decision.audit}, roster=${JSON.stringify(decision.roster)} — on a decayed class with the roll ` +
        `above the rate this is a PLAIN skip: the bin returns and nothing levies. The rail is silently OFF, ` +
        `decided by a judge that violated its own domain — the exact vanish-not-review direction the fail-safe ` +
        `law exists to forbid, reachable through WHL_JEV_BIN (the swap seam the gate itself ships). Validate ` +
        `the judgment's domain where the script enforces (0 <= noul <= 1, else the null path), or the law is ` +
        `only true for the garbage shapes someone happened to enumerate.`,
    )
    assert.deepEqual(
      decision.roster,
      ["principles", "tests", "momentum", "questions"],
      "the fail-safe roster is ALL FOUR lenses — a garbage judgment must not pick a roster",
    )
  } finally {
    Math.random = realRandom
    delete process.env.WHL_JEV_BIN
    rmSync(tmp, { recursive: true, force: true })
    rmSync(STORE, { recursive: true, force: true })
  }
})
