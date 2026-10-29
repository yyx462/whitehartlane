import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parse as parseToml } from "smol-toml"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-4 (claims are honest) — the diff's own model-less AUDIT receipt:
//   bin/whitehartlane (review verb): "review: dropout audit without
//   --model — temperature pins dropped; the lenses run on the host
//   default, untuned"
// and review.ts:347-352: "The pins are TUNING, not law: strip them and
// the lenses spawn on the host default, untuned."
//
// The strip never reaches the disk. review.ts:353 assigns the stripped
// bytes to the LOCAL `templateToml`, but the only write arms for the
// materialized workflow.toml are (review.ts:444-452):
//   - `pinnedWorkflowToml !== undefined` — set ONLY inside
//     `if (typeof args.model === "string")` (review.ts:362), which is
//     FALSE on the model-less audit path;
//   - `else if (args.roster && args.roster.length < 4)` — the bin sets
//     `gateRoster` only for `action === "review"` decisions
//     (bin/whitehartlane: `if (g.decision.action === "review" && …)`),
//     and an audit's action is "skip" — so roster is undefined here too.
// The materialization is `cpSync(template, dir)` (review.ts:427) — the
// RAW template bytes. The stripped local is dead.
//
// The path that breaks (deterministic, the FIRST docs-only diff on a
// fresh machine: classStats greens < 3 → rate 1.0 → the roll always
// audits): `whl review <docs-only-repo>` with no --model → the gate
// escalates (auditLevy) → the door materializes the pr-review template
// with all four lens units carrying `temperature` pins and NO model
// anywhere → every lens spawn is refused by the host
// (src/adapters/opencode-host.ts: "temperature … has no model to pin
// against (no unit/stage/workflow model) — refusing spawn") → the
// levied audit books a Job whose four lenses all die at spawn — the
// audit measures nothing, the exact dead-end it was built to end
// (momentum-15's own law), one level deeper: the Job is levied, the
// program cannot run a single lens. On BASE there is no auditLevy: a
// model-less review of a temp-pinned template is REFUSED at the door
// (code 2) — the broken arm, and the false receipt, are introduced by
// this change.
test("a model-less dropout audit materializes UNPINNED units — the strip must reach the disk", () => {
  // BASE shape: the audit levy does not exist (no auditLevy in the door,
  // no dropout receipt in the bin) — nothing to judge there
  if (!readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8").includes("auditLevy")) return
  const tmp = mkdtempSync(join(tmpdir(), "whl-m16-"))
  const out = join(tmp, "program") // must NOT exist beforehand
  try {
    const repo = join(tmp, "repo")
    // gate-r12 momentum-25: docs-only never audits anymore (a file-list
    // fact is not a judgment), so the audit's strip law is pinned on the
    // LIVE shape — the judgment-class audit, a code diff
    mkdirSync(join(repo, "src"), { recursive: true })
    const g = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" })
    g("init", "-q", "-b", "master")
    g("config", "user.email", "review@test")
    g("config", "user.name", "review")
    writeFileSync(join(repo, "README.md"), "base\n")
    g("add", "-A")
    g("commit", "-q", "-m", "base")
    g("checkout", "-q", "-b", "feat")
    writeFileSync(join(repo, "src", "app.ts"), "export const one = 1\n")
    g("add", "-A")
    g("commit", "-q", "-m", "feat")

    // the door must NOT refuse (the momentum-15 law: an audited docs-only
    // skip levies — refusing here dead-ends the dropout). It materializes.
    const r = prepareReview(
      { repo, base: "master", head: "feat", out, auditLevy: true },
      join(ROOT, "templates"),
    )
    assert.ok(
      r.ok && !("skipped" in r && r.skipped),
      `sanity: the model-less audit levy must materialize (review.ts:346: "refusing here dead-ends the audit"); got ${JSON.stringify(r)}`,
    )
    const dir = (r as { dir: string }).dir

    // THE LAW, in the consumer's own read: the materialized program's
    // units must carry NO temperature pin — the receipt claims "pins
    // dropped; the lenses run on the host default". Every surviving pin
    // is a spawn refusal: the host refuses a temperature spawn with no
    // unit/stage/workflow model (opencode-host.ts), and the template
    // declares no model and none was passed.
    const parsed = parseToml(readFileSync(join(dir, "workflow.toml"), "utf8")) as unknown
    const pins: string[] = []
    ;(function walk(node: unknown, at: string): void {
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, `${at}[${i}]`))
        return
      }
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (k === "temperature") pins.push(`${at}.${k}`)
          else walk(v, `${at}.${k}`)
        }
      }
    })(parsed, "workflow.toml")
    assert.equal(
      pins.length,
      0,
      `INV-4 (the change's own claim is false): the model-less audit receipt says "temperature pins dropped; ` +
        `the lenses run on the host default, untuned" (bin/whitehartlane review verb) and review.ts:350-352 says ` +
        `"strip them and the lenses spawn on the host default" — but the strip (review.ts:353) mutates a LOCAL ` +
        `that neither write arm (review.ts:444 pinnedWorkflowToml — model-path only; review.ts:446 roster<4 — ` +
        `undefined for an audit, whose action is "skip") ever writes: the materialized program carries the RAW ` +
        `template with ${pins.length} temperature pin(s) (${pins.slice(0, 4).join(", ")}) and NO model anywhere, ` +
        `so every lens spawn is refused by the host ("temperature … has no model to pin against — refusing ` +
        `spawn", opencode-host.ts). The audited levy books a Job whose four lenses all die at spawn — the audit ` +
        `measures nothing while printing "the skip region stays measured": the exact dead-end (momentum-15) the ` +
        `audit exists to end, one level deeper. On BASE the model-less audit does not exist (the door refused ` +
        `any model-less temp-pinned review with code 2) — the broken arm is introduced by this change. The fix ` +
        `is one write: materialize the stripped bytes (or strip the staged copy) on the no-model audit path.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
