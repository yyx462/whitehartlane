import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape: the auditLevy seam and the model-less audit receipt do not
// exist on BASE — nothing to judge there (the same guard device as
// momentum-14/tests-35).
const doorSrc = readFileSync(join(ROOT, "src", "doors", "review.ts"), "utf8")
const binSrc = readFileSync(join(ROOT, "bin", "whitehartlane"), "utf8")
const doorOwnsTheAudit = doorSrc.includes("auditLevy") && binSrc.includes("dropout audit without --model")

function fixtureDocsRepo(where: string): string {
  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
  mkdirSync(join(where, "docs"), { recursive: true })
  g("init", "-q", "-b", "master")
  g("config", "user.email", "review@test")
  g("config", "user.name", "review")
  writeFileSync(join(where, "README.md"), "base\n")
  g("add", "-A")
  g("commit", "-q", "-m", "base")
  g("checkout", "-q", "-b", "feat")
  writeFileSync(join(where, "docs", "notes.md"), "docs-only change\n")
  g("add", "-A")
  g("commit", "-q", "-m", "docs")
  return where
}

// INV-2 / INV-4 — the model-less dropout audit (bin/whitehartlane:365):
// the bin prints "dropout audit without --model — temperature pins
// dropped; the lenses run on the host default, untuned", and the door
// strips the pins into a LOCAL templateToml (src/doors/review.ts:353).
// But the materialization persists only the MODEL-pin content
// (review.ts:444-445) or the roster strip (review.ts:449-452) — the
// stripped bytes are written NOWHERE. A model-less audit therefore
// stages the raw template: temperature pins intact, no model — and every
// lens unit dies at src/adapters/opencode-host.ts:95 ("temperature … has
// no model to pin against — refusing spawn"). The audit the gate levies
// cannot produce a verdict: verdictRedsByHeadSha never labels the
// docs_only row, greens never accrue, classStats pins the rate at 1.0,
// and every docs-only review forever prints the audit receipt, levies
// the full rail, and dies four lenses late — the exact "an audit nobody
// runs measures nothing" outcome the strip was written to prevent
// (review.ts:347-352's own comment). The change's own claim (bin:365) is
// false; the receipt reports an answer the program cannot deliver.
test("a model-less dropout audit's materialized lenses really run untuned — the receipt's promise lands in the bytes", () => {
  if (!doorOwnsTheAudit) return // BASE shape: no audit levy, nothing to judge
  const tmp = mkdtempSync(join(tmpdir(), "whl-q6-"))
  try {
    const repo = fixtureDocsRepo(join(tmp, "repo"))
    const out = join(tmp, "program") // must NOT exist beforehand
    // the exact shape the bin's gate produces for a fresh docs_only
    // class: audit escalation, no --model (bin:364-366)
    const r = prepareReview(
      { repo, base: "master", head: "feat", out, auditLevy: true },
      join(ROOT, "templates"),
    )
    assert.ok(
      r.ok && !("skipped" in r && r.skipped),
      `sanity: the audit levy must materialize past the docs-only pre-flight (auditLevy bypasses it): got ${JSON.stringify(r)}`,
    )
    const dir = (r as { dir: string }).dir
    const toml = readFileSync(join(dir, "workflow.toml"), "utf8")
    const pinsLeft = /\btemperature\s*=/.test(toml)
    const modelDeclared = /^model\s*=/m.test(toml)
    assert.ok(
      !pinsLeft || modelDeclared,
      `INV-2/INV-4: the model-less dropout audit's receipt (bin/whitehartlane:365, "temperature pins dropped; ` +
        `the lenses run on the host default, untuned") is false in the bytes: the materialized ` +
        `${join(dir, "workflow.toml")} carries temperature pins with NO model ` +
        `(pins present: ${pinsLeft}, model declared: ${modelDeclared}). The door strips the pins into a local ` +
        `templateToml (review.ts:353) but persists only the model-pin content (review.ts:444-445) or the roster ` +
        `strip (review.ts:449-452) — the stripped bytes are written nowhere, so the audit's four lens units each ` +
        `refuse at spawn (opencode-host.ts:95: "temperature … has no model to pin against — refusing spawn"). ` +
        `The audit cannot produce a verdict, the docs_only label never lands, the rate pins at 1.0, and every ` +
        `docs-only review forever levies a rail that dies four lenses late — the "measures nothing" dead-end the ` +
        `strip's own comment (review.ts:347-352) claims to prevent.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
