// momentum-910 — the gate's BAND must be pinned to the REVIEWED
// revision, not to whatever the checkout happens to carry.
//
// The change makes the review band a per-repo CONTRACT (review-gate.toml):
//
//   // src/doors/review-gate.ts:416-425
//   export function runGate(repo, base, head, opts = {}) {
//     const strictness = opts.strictness ?? shipConfigOf(repo).strictness
//     const band = BANDS[strictness]
//     const features = gateFeatures(repo, base, head)
//     ...
//
//   // src/doors/review-gate.ts:356-367
//   export function shipConfigOf(repo: string): ShipConfig {
//     const p = join(repo, "review-gate.toml")
//     if (!existsSync(p)) return { auto: false, strictness: "medium" }
//     ...parse...
//   }
//
// Two properties of that seat are wrong:
//
// (1) IT IS THE WORKING TREE, NOT THE REVIEWED REVISION. `shipConfigOf(repo)`
//     reads <repo>/review-gate.toml — the file as it sits on disk right
//     now. But `gateFeatures(repo, base, head)` reads the DIFF base..head
//     out of git. So the band that governs the review of a diff comes
//     from a revision that need not be part of that diff at all: check
//     out a different branch (or a different repo state) and the SAME
//     base..head diff is gated by a different band.
//
//     In the --auto flow the gate runs on the CALLER'S checkout
//     (bin/whitehartlane:394 `runGate(resolve(positional), baseRef,
//     headRef)`) — so the band is whatever the operator's working tree
//     says, not what the PR under review says.
//
// (2) THE REVIEWED ARTIFACT CAN LOWER ITS OWN BAR. A PR that ADDS
//     review-gate.toml with `strictness = "loose"` is gated by the loose
//     band the moment that PR's branch is checked out — the review of a
//     diff is decided by a file that diff introduces. The strict band
//     exists precisely to make "a file with prior proven findings reviews
//     in full whatever jev thinks of the diff" (review-gate.ts:396-399)
//     — and a PR can switch that off with four lines of TOML.
//
// The invariant this breaks is the same one the diff itself establishes
// for the OTHER gate inputs: the reviewed diff's own bytes must not
// decide how strictly the diff is reviewed (bin/whitehartlane: "the
// gate's OWN resolution is the one 'which bytes' site", momentum-200),
// and a reviewed artifact must not be able to change the rules that
// judge it.
//
// The repro drives the REAL gate (runGate) on a real repo with a real
// jev stub and asserts that the gate's decision for one base..head pair
// is the SAME whatever the checkout carries.
//
// BASE behaviour: BASE has no review-gate.toml, no bands and no
// shipConfigOf at all → the import fails → the assertion is skipped and
// the test passes on BASE (the diff introduces the whole mechanism).
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const g = (repo: string, ...a: string[]) =>
  execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" })

function jevStub(dir: string, noul: Record<string, number>): string {
  const answers: Record<string, { type: string; noul: number }> = {}
  for (const [k, v] of Object.entries(noul)) answers[`l_${k}`] = { type: "noul", noul: v }
  const p = join(dir, "jev-stub.sh")
  writeFileSync(p, `#!/bin/sh\necho '${JSON.stringify({ answers })}'\n`)
  chmodSync(p, 0o755)
  return p
}

test("the gate's decision for one base..head pair does not depend on the checkout", async () => {
  const mod = await import("../../src/doors/review-gate.ts").catch(() => null)
  if (!mod) return // BASE shape: no bands, no contract, no gate band at all

  const tmp = mkdtempSync(join(tmpdir(), "aos-mom910-"))
  const repo = join(tmp, "repo")
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    g(repo, "init", "-q", "-b", "main", ".")
    g(repo, "config", "user.email", "t@t.local")
    g(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "base")
    g(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 2\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "feat")
    // THE PR UNDER REVIEW adds a LOOSE contract — the reviewed artifact
    // trying to lower the bar that reviews it.
    writeFileSync(join(repo, "review-gate.toml"), 'strictness = "loose"\n')
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "feat adds a loose contract")

    // jev says 0.45 for every lens: medium KEEPS them (>= 0.35),
    // loose DROPS them (< 0.60) → the band decides review vs skip.
    const prevJev = process.env.WHL_JEV_BIN
    const prevLedger = process.env.WHL_GATE_LEDGER
    process.env.WHL_JEV_BIN = jevStub(tmp, {
      principles: 0.45,
      tests: 0.45,
      momentum: 0.45,
      questions: 0.45,
    })
    process.env.WHL_GATE_LEDGER = join(tmp, "ledger.jsonl")
    try {
      g(repo, "checkout", "-q", "feat")
      const atHead = mod.runGate(repo, "main", "feat")
      g(repo, "checkout", "-q", "main")
      const atBase = mod.runGate(repo, "main", "feat")
      assert.deepEqual(
        { action: atHead.decision.action, roster: atHead.decision.roster },
        { action: atBase.decision.action, roster: atBase.decision.roster },
        `the SAME base..head diff was gated differently by the checkout: ` +
          `at the PR head (the PR's own "loose" contract) action=${atHead.decision.action} ` +
          `roster=[${atHead.decision.roster}]; at the base (no contract) action=${atBase.decision.action} ` +
          `roster=[${atBase.decision.roster}] — the band must come from the reviewed revision, not the checkout ` +
          `(and a PR must not be able to lower the bar that reviews it)`,
      )
    } finally {
      if (prevJev === undefined) delete process.env.WHL_JEV_BIN
      else process.env.WHL_JEV_BIN = prevJev
      if (prevLedger === undefined) delete process.env.WHL_GATE_LEDGER
      else process.env.WHL_GATE_LEDGER = prevLedger
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("a PR that adds review-gate.toml cannot lower the band that gates it", async () => {
  const mod = await import("../../src/doors/review-gate.ts").catch(() => null)
  if (!mod) return
  // BASE shape: BASE has no band table and no per-repo contract at all —
  // there is no bar for a PR to lower, so this arc is vacuous there and
  // the repro must PASS on BASE (the diff introduces the whole mechanism).
  if (typeof mod.shipConfigOf !== "function") return

  const tmp = mkdtempSync(join(tmpdir(), "aos-mom910b-"))
  const repo = join(tmp, "repo")
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    g(repo, "init", "-q", "-b", "main", ".")
    g(repo, "config", "user.email", "t@t.local")
    g(repo, "config", "user.name", "t")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1\n")
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "base")
    g(repo, "checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 2\n")
    writeFileSync(join(repo, "review-gate.toml"), 'strictness = "loose"\n')
    g(repo, "add", "-A")
    g(repo, "commit", "-qm", "feat adds a loose contract")

    // the reviewed BASE declares no contract → the band for this diff is
    // the default, whatever the PR's own file says.
    const baseHasContract = (() => {
      try {
        execFileSync("git", ["-C", repo, "cat-file", "-e", "main:review-gate.toml"], { stdio: "ignore" })
        return true
      } catch {
        return false
      }
    })()
    assert.equal(baseHasContract, false, "the reviewed base declares no contract")
    assert.equal(
      mod.shipConfigOf(repo).strictness,
      "medium",
      `the gate read the band from the CHECKOUT (the PR's own "loose" contract) — a PR must not choose the bar that gates it`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
