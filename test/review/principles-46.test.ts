// principles-46 — "HOW MANY ROUNDS OF GOOD FAITH BEFORE THE OWNER MAY
// ACT" LIVES IN TWO PLACES; THE OWNER'S CONTRACT REACHES ONLY ONE.
//
// This change adds the owner's per-project contract (review-gate.toml)
// with a [stop] block:
//
//   review-gate.toml:26-28
//     [stop]
//     min_rounds = 2   # good faith first — never round 1
//     rounds = 2       # K: consecutive quiet rounds the criterion demands
//     novel_max = 1    # N: novel root-cause buckets allowed per round
//
// "min_rounds — good faith first" is the SAME LAW as the overrule exit's
// own good-faith gate in src/doors/ship.ts:
//
//   src/doors/ship.ts:126-137
//     const minRounds = opts.minRounds ?? 2
//     ...
//     if (rounds < minRounds) {
//       return { ok: false, code: 2, why: `round 1 of ${rounds}: the
//         overrule opens after good faith — fix what you accept and
//         re-review first (the exit unlocks at ${minRounds} rounds)` }
//     }
//
// The contract's [stop].min_rounds DOES reach the stop rule — it is
// parsed by stopConfigOf (src/doors/stop-rule.ts:98-110) and used by
// stopEligibility (stop-rule.ts:81) and by its cold twin
// (templates/pr-review/hooks/stop-rule.mjs:55).
//
// It NEVER REACHES THE OVERRULE GATE. shipCheck's minRounds is an
// optional parameter that NO CALLER EVER PASSES:
//
//   bin/whitehartlane:759
//     const check = shipCheck({ headSha, overruleFile: sVal("overrule"),
//       rounds, repoRounds: verdictsForBranch(...).length })
//                                              ^ no minRounds
//
// so the gate always uses the hard-coded 2.
//
// THE HARM: the owner tightens the good-faith floor in their own
// contract — min_rounds = 3, "never overrule before the third round".
// The stop rule HONORS it (the door's own receipt says "not eligible —
// round 2 of min 3: good faith comes first", and that sentence is
// recorded in the override ledger row as the honesty trail) — and the
// merge happens anyway, two rounds early. The owner set the floor on
// the TRUSTED side (the base commit, momentum-910) and the door that
// actually merges does not read it.
//
// ONE DECISION, TWO ANSWERS (INV-3): "how many rounds of good faith
// before the owner may overrule" is answered by
//   - src/doors/ship.ts (the gate that merges) → the constant 2, and
//   - src/doors/stop-rule.ts + its twin (the criterion that advises)
//     → the owner's contract.
//
// Repro: a repo whose BASE commit declares min_rounds = 3; two reject
// rounds on the head; drive the REAL `whl ship`; assert the door
// REFUSES (the owner's floor is 3 rounds and only 2 have happened).
//
// BASE behaviour: `whl ship` does not exist on BASE → the door refuses
// → the assertion PASSES on BASE → the prove gate classifies this as
// introduced.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const HEAD = join(import.meta.dirname, "..", "..")
const BIN = join(HEAD, "bin", "whitehartlane")

test("the overrule gate must honor the owner's [stop].min_rounds floor", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-p3-"))
  const home = join(tmp, "home")
  const repo = join(tmp, "repo")
  const merged = join(tmp, "merged.txt")
  try {
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" })
    g("init", "-q", "-b", "main", ".")
    g("config", "user.email", "t@t.local")
    g("config", "user.name", "t")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => true\n")
    // THE OWNER'S CONTRACT on the TRUSTED side (the base commit): the
    // good-faith floor is 3 rounds, not the built-in 2.
    writeFileSync(
      join(repo, "review-gate.toml"),
      'auto = true\nmodel = "acme/strong"\nstrictness = "strict"\n\n[stop]\nmin_rounds = 3\nrounds = 2\nnovel_max = 1\n',
    )
    g("add", "-A")
    g("commit", "-qm", "base with the owner's contract")
    g("checkout", "-qb", "feat")
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\n")
    g("add", "-A")
    g("commit", "-qm", "feat")
    const headSha = g("rev-parse", "HEAD").trim()

    // two reject rounds on this head — one short of the owner's floor
    for (const sid of ["s-r1", "s-r2"]) {
      const dir = join(home, "sessions", sid, "jobs", "j1", "run", "data", "review")
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, "verdict.json"),
        JSON.stringify({
          verdict: "reject",
          repo,
          head: headSha,
          blocked: [{ id: "m-1", severity: "P1", claim: "asserts the wrong requirement" }],
        }),
      )
    }

    const bin = join(tmp, "bin")
    mkdirSync(bin, { recursive: true })
    const gh = join(bin, "gh")
    writeFileSync(gh, `#!/bin/sh\ncase "$1 $2" in "pr view") echo ${headSha} ;; esac\nexit 0\n`)
    chmodSync(gh, 0o755)

    const overrule = join(tmp, "o.json")
    writeFileSync(overrule, JSON.stringify({ "m-1": "the repro asserts the wrong requirement" }))

    const env = {
      ...process.env,
      AGENTIC_OS_HOME: home,
      AGENTIC_OS_NOTIFY: "0",
      WHL_GATE_LEDGER: join(tmp, "gate.jsonl"),
      PATH: `${bin}:${process.env.PATH ?? ""}`,
    }
    const r = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        BIN,
        "ship",
        repo,
        "--pr",
        "42",
        "--overrule",
        overrule,
        "--head",
        "feat",
        "--base",
        "main",
        "--merge-cmd",
        `echo merged >> ${JSON.stringify(merged)}`,
      ],
      { env, encoding: "utf8", timeout: 60_000 },
    )

    // The door's OWN receipt must agree with what it did. (On BASE the
    // `ship` verb does not exist at all — the door prints usage and
    // refuses; there is no receipt to read, and the merge never
    // happens, which is what this test asserts.)
    if (/ship: the gate's stop rule/.test(r.stdout)) {
      assert.match(
        r.stdout,
        /round 2 of min 3/,
        `the door's stop rule must read the owner's contract — it printed:\n${r.stdout}\nstderr: ${r.stderr}`,
      )
    }
    assert.equal(
      existsSync(merged),
      false,
      `the ship door MERGED under override at round 2 while the owner's contract (review-gate.toml [stop] min_rounds = 3, on the BASE commit) demands 3 rounds of good faith — the door's own receipt says "not eligible — round 2 of min 3: good faith comes first" and it merged anyway.\n` +
        `shipCheck's minRounds (src/doors/ship.ts:127) is never passed by its only caller (bin/whitehartlane:759), so the overrule gate always uses the hard-coded 2 while the stop rule honors the contract.\n` +
        `door exit=${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
