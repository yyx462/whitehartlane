import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"
import { parse as parseToml } from "smol-toml"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// a docs-only BASE..HEAD — the audited class. decideGate answers docs_only
// WITHOUT jev, and a fresh class's audit rate is 1.0, so the audited skip +
// auditLevy levy is the NORMAL shape there (the gate's own dropout law).
function docsOnlyRepo(where: string): string {
  mkdirSync(where, { recursive: true })
  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
  g("init", "-q", "-b", "master")
  g("config", "user.email", "review@test")
  g("config", "user.name", "review")
  writeFileSync(join(where, "README.md"), "base\n")
  g("add", "-A")
  g("commit", "-q", "-m", "base")
  g("checkout", "-q", "-b", "feat")
  writeFileSync(join(where, "README.md"), "base\nfeat docs\n")
  g("add", "-A")
  g("commit", "-q", "-m", "docs")
  return where
}

// the door's own consumer read (the same deep walk prepareReview runs at
// the pin-plan): a temperature KEY anywhere in the PARSED document pins.
function tempKeyPaths(toml: string): string[] {
  const paths: string[] = []
  const walk = (node: unknown, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${at}[${i}]`))
      return
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === "temperature") paths.push(`${at}.${k}`)
        else walk(v, `${at}.${k}`)
      }
    }
  }
  walk(parseToml(toml), "")
  return paths
}

// The model-less dropout audit (bin/whitehartlane:365 — gate-audited
// docs_only skip levied without --model) makes TWO claims the door must
// keep:
//   bin/whitehartlane:365  "review: dropout audit without --model —
//     temperature pins dropped; the lenses run on the host default,
//     untuned"
//   review.ts audit branch  "The pins are TUNING, not law: strip them and
//     the lenses spawn on the host default, untuned."
// Meta-ACH, reverted-half: the strip mutates the pin-plan's LOCAL
// templateToml — but the materialization write fires only for
// pinnedWorkflowToml (undefined here: no --model) or a roster<4 strip
// (the audit's roster is all four lenses) — so the STRIPPED BYTES NEVER
// REACH DISK. The staged workflow.toml keeps every unit temperature pin
// with NO [workflow].model, and the consumer the claims name — the host
// — refuses every spawn: "temperature … has no model to pin against …
// refusing spawn" (opencode-host.ts:95). The audit the momentum-15 fix
// built levies a rail whose four lenses all die at spawn refusal and
// measure nothing — the exact dead end ("an audit nobody runs measures
// nothing") the auditLevy flag exists to end. INV-4 (the receipt is
// false) + INV-2 (the strip, the promised landing, silently vanishes).
test("a model-less dropout audit materializes UNTUNED — the promised strip must reach the materialized bytes", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-t50-"))
  try {
    const repo = docsOnlyRepo(join(tmp, "repo"))
    const out = join(tmp, "program") // must NOT exist beforehand
    const args = { repo, base: "master", head: "feat", out, auditLevy: true }
    const r = prepareReview(args, join(ROOT, "templates"))
    // BASE shape: no auditLevy arm — the docs-only pre-flight skip stands
    // and nothing materializes; this repro judges the HEAD audit levy.
    if (r.ok && "skipped" in r && r.skipped) return
    assert.ok(
      r.ok && "dir" in r && !!r.dir,
      `sanity: the model-less audit levy must be ADMITTED (the momentum-15 law: an audit nobody levies measures nothing); got: ${JSON.stringify(r)}`,
    )
    const dir = (r as { dir: string }).dir
    const toml = readFileSync(join(dir, "workflow.toml"), "utf8")

    // THE LAW, in the consumer's own read: no temperature key may survive
    // in the materialized program — the pins were promised DROPPED.
    const pins = tempKeyPaths(toml)
    assert.deepEqual(
      pins,
      [],
      `INV-4/INV-2: the model-less dropout audit's own receipts promise the temperature pins never reach the ` +
        `materialized program — bin/whitehartlane:365 ("temperature pins dropped; the lenses run on the host ` +
        `default, untuned") and the door's audit branch ("strip them and the lenses spawn on the host default, ` +
        `untuned"). The strip runs on the pin-plan's LOCAL templateToml (review.ts:353) while the only ` +
        `materialization writes fire for pinnedWorkflowToml (undefined — no --model) or a roster<4 strip ` +
        `(the audit's roster is all four lenses), so the STRIPPED BYTES NEVER REACH DISK: the staged ` +
        `workflow.toml still carries the temperature keys ${JSON.stringify(pins)} with no [workflow].model. ` +
        `The consumer named by both claims — opencode-host.ts:95 — refuses every such spawn ("temperature … ` +
        `has no model to pin against … refusing spawn"): the audit levies a rail whose four lenses all die at ` +
        `spawn refusal and measure nothing. The strip must land in the materialized bytes (or the door must ` +
        `refuse) — never vanish into a program that cannot run.`,
    )

    // and the strip must be SURGICAL: dropping pins never drops units.
    const parsed = parseToml(toml) as { stage?: Array<{ units?: Array<{ id?: string }> }> }
    const ids = (parsed.stage ?? []).flatMap((s) => (s.units ?? []).map((u) => u.id)).filter(Boolean) as string[]
    assert.deepEqual(
      ids.sort(),
      ["momentum", "principles", "questions", "tests"],
      "sanity: the audit materialization keeps the full lens roster — the fix drops the pins, not the units",
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
