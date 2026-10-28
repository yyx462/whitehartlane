import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-4 (claims are honest) / the gate's own law — "a skip STANDS only
// when unaudited … the ESCALATION still levies" (bin/whitehartlane:358)
// and decideGate's own receipt "dropout audit of docs_only — full rail"
// (src/doors/review-gate.ts:268).
//
// The dropout's whole point (review-gate.ts header): "The skip region
// is never unmeasured" — an audited skip must LEVY the rail so a
// verdict lands for that headSha and classStats can count it. For the
// docs_only class that escalation is DEAD: decideGate skips docs_only
// without jev (ps=null), the bin does not return on an audited skip —
// but the next line of defense is prepareReview's own pre-flight
// docs-only skip (src/doors/review.ts:197), which unconditionally
// prints "nothing levied" and exits 0. Nothing is levied, no verdict
// can ever exist for the headSha, so verdictRedsByHeadSha never finds
// a label for a docs_only row: greens can never accrue, the rate is
// pinned at 1.0 (classStats: greens < 3 → 1.0), and EVERY docs-only
// review forever prints "DROPOUT AUDIT … the skip region stays
// measured" + "full rail" while measuring nothing. The gate-r1
// momentum-2 fix ("the ledger now tells the truth; the levy (bin)
// reads action + audit") built the escalation and the door forbids it
// for the one class the gate decides without jev.
//
// Deterministic, no jev, no multiplexer: a fresh gate ledger pins the
// audit rate at 1.0 (roll < 1.0 always audits), and a docs-only diff
// never reaches the model screens. The assertion is the law itself:
// after an AUDITED docs-only skip, the full rail must be levied — a
// Job row must exist on the store. HEAD levies nothing.
test("an AUDITED docs-only skip levies the full rail, as the gate's own law states", () => {
  // BASE shape: the gate does not exist in the bin — nothing to judge
  const bin = readFileSync(join(ROOT, "bin", "whitehartlane"), "utf8")
  if (!bin.includes("runGate")) return

  const t = mkdtempSync(join(tmpdir(), "whl-m15-"))
  const home = join(t, "home")
  const repo = join(t, "repo")
  mkdirSync(repo, { recursive: true })
  try {
    const git = (a: string) =>
      execFileSync("git", a.split(" ").filter(Boolean), { cwd: repo, encoding: "utf8" })
    execFileSync("git", ["init", "-q", "-b", "master", "."], { cwd: repo })
    git("config user.email t@t.local")
    git("config user.name t")
    writeFileSync(join(repo, "README.md"), "v1\n")
    git("add -A")
    git("commit -qm base")
    git("checkout -qb feat")
    writeFileSync(join(repo, "README.md"), "v2 docs\n")
    writeFileSync(join(repo, "NOTES.md"), "more docs\n")
    git("add -A")
    git("commit -qm docs")

    const run = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        join(ROOT, "bin", "whitehartlane"),
        "review",
        repo,
        "--base",
        "master",
        "--head",
        "feat",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 120_000,
        env: {
          ...process.env,
          AGENTIC_OS_HOME: home,
          WHL_GATE_LEDGER: join(t, "gate.jsonl"),
          AGENTIC_OS_NOTIFY: "0",
          SHEP_SCOPE: "whl-test",
        },
      },
    )
    const out = String(run.stdout ?? "")

    // sanity: the gate took the AUDITED-skip path (fresh class → rate
    // 1.0 → the roll always audits), so this test judges the escalation
    assert.match(
      out,
      /dropout audit of docs_only — full rail/,
      `sanity: the gate must take the audited docs_only skip (got exit=${run.status}, stdout=${JSON.stringify(out.slice(0, 400))})`,
    )

    // THE LAW: the escalation levies the full rail — the bin's own
    // comment (bin/whitehartlane:358: "the ESCALATION still levies")
    // and decideGate's receipt ("dropout audit of docs_only — full
    // rail") both state it. Observable: a Job row on the store.
    const jobRows: string[] = []
    const sessions = join(home, "sessions")
    if (existsSync(sessions)) {
      for (const sid of readdirSync(sessions)) {
        const jdir = join(sessions, sid, "jobs")
        if (!existsSync(jdir)) continue
        for (const jid of readdirSync(jdir)) {
          if (existsSync(join(jdir, jid, "job.json"))) jobRows.push(join(sid, "jobs", jid))
        }
      }
    }
    assert.ok(
      jobRows.length > 0,
      `INV-4 (claims are honest): the audited docs_only skip's own receipts claim the escalation levies ` +
        `"full rail" (review-gate.ts:268 "dropout audit of docs_only — full rail"; bin/whitehartlane:358 ` +
        `"the ESCALATION still levies"), but the door's pre-flight docs-only skip (review.ts:197) levied ` +
        `NOTHING: exit=${run.status}, no Job row exists on the store (looked under ${sessions}), and the same ` +
        `stdout carries both "full rail" and "nothing levied". The dropout's purpose — "the skip region is ` +
        `never unmeasured" (review-gate.ts header) — is dead for the docs_only class: no verdict can ever ` +
        `exist for an audited docs_only headSha, so verdictRedsByHeadSha never labels the row, greens can ` +
        `never accrue, classStats pins the rate at 1.0 forever, and every docs-only review re-prints the ` +
        `audit claim while measuring nothing. One decision — "does an audited skip levy?" — answered YES by ` +
        `the gate/bin law and NO by the door on the only path that produces it.`,
    )
    assert.doesNotMatch(
      out,
      /nothing levied/,
      "an audited skip that levied the full rail must not print the unaudited-skip receipt 'nothing levied'",
    )
  } finally {
    rmSync(t, { recursive: true, force: true })
  }
})
