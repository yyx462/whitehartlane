import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// isolated OS disk + gate ledger + a stub orchestrator so the probe
// never spawns real panes (the repo's own repro convention, run.test.ts)
const HOME = mkdtempSync(join(tmpdir(), "whl-m25-home-"))
process.env.AGENTIC_OS_HOME = HOME
process.env.WHL_GATE_LEDGER = join(HOME, "gate.jsonl")
process.env.AGENTIC_OS_NOTIFY = "0"
const STUB = join(HOME, "engine-stub.mjs")
writeFileSync(STUB, "import { writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nwriteFileSync(join(process.argv[2], 'engine-started'), 'ok\\n')\n")

// INV-4 (claims are honest — the change's own manual is part of the
// change): the diff's `whl review --help` hard rules say
//   "docs-only diffs skip at the door (receipt printed, exit 0)".
// The SAME diff seats the review gate (src/doors/review-gate.ts) in
// front of the door, and its dropout law makes a FRESH class audit
// every skip — rate 1.0, `roll < 1.0` is always true — and an audited
// skip does NOT return: `gateAudit = true` reaches prepareReview as
// `auditLevy`, which bypasses the door's docs-only pre-flight skip
// ("the audit exists to measure the skipped class"), and then the bin
// self-levies ("an audit nobody runs measures nothing"): prepareRun +
// spawnRunner — a full 4-lens review run of a docs-only diff.
//
// On a fresh machine (empty ledger — EVERY first contact) the rate is
// 1.0, so the hard rule is false deterministically, 100% of the time:
// the operator who read the manual gets a levied review run where the
// manual promised a receipt and nothing else. The behavior is the
// gate's own designed law (gate-r2 momentum-15) — the claim is what
// never caught up: the help block this diff wrote still describes the
// pre-gate door.
test("the manual's docs-only hard rule holds: no audit levy without a levying flag", () => {
  // docs-only fixture repo: a .md change on a docs branch
  const tmp = mkdtempSync(join(tmpdir(), "whl-m25-"))
  const repo = join(tmp, "repo")
  try {
    mkdirSync(repo, { recursive: true })
    const g = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" })
    g("init", "-q", "-b", "main")
    g("config", "user.email", "review@test")
    g("config", "user.name", "review")
    writeFileSync(join(repo, "README.md"), "base\n")
    g("add", "-A")
    g("commit", "-q", "-m", "base")
    g("checkout", "-q", "-b", "docs-branch")
    writeFileSync(join(repo, "NOTES.md"), "# notes\n")
    g("add", "-A")
    g("commit", "-q", "-m", "docs")
    // sanity: the diff really is docs-only under the door's own classes
    const filesChanged = g("diff", "--name-only", "main", "docs-branch").trim().split("\n").filter(Boolean)
    assert.deepEqual(filesChanged, ["NOTES.md"], "sanity: the fixture diff is one markdown file")

    const out = join(tmp, "program") // must NOT exist beforehand
    const cli = execFileSync(
      process.execPath,
      [join(ROOT, "bin", "whitehartlane"), "review", repo, "--base", "main", "--head", "docs-branch", "--model", "p/m", "--out", out],
      { encoding: "utf8", timeout: 120_000, env: { ...process.env, AGENTIC_OS_ORCHESTRATOR: STUB } },
    )

    assert.ok(
      /docs-only diff/.test(cli),
      `INV-4: the manual's hard rule — "docs-only diffs skip at the door (receipt printed, exit 0)" — must hold on ` +
        `the default path. The command levied instead: the gate's fresh-class dropout audit (rate 1.0 → audit ` +
        `always) set auditLevy, prepareReview bypassed the door's docs-only pre-flight skip, and the bin ` +
        `self-levied a full 4-lens review run of a one-markdown-file diff. stdout was:\n${cli.split("\n").slice(0, 12).join("\n")}`,
    )
    assert.doesNotMatch(
      cli,
      /^job: /m,
      `INV-4: the manual promises "receipt printed, exit 0" — a runner must not spawn for a docs-only diff on ` +
        `the plain spell. The output booked a job (a levied audit run) where the same diff's help block promises ` +
        `nothing levies. The help block is this diff's own text; the audit-levy is this diff's own behavior — ` +
        `one of them must move (state the gate exception, or gate the self-levy behind --unattended).`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(HOME, { recursive: true, force: true })
  }
})
