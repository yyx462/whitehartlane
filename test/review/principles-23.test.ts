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

function fixtureRepo(where: string): string {
  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
  mkdirSync(join(where, "src"), { recursive: true })
  g("init", "-q", "-b", "master")
  g("config", "user.email", "review@test")
  g("config", "user.name", "review")
  writeFileSync(join(where, "src", "app.ts"), "export const one = 0\n")
  g("add", "-A")
  g("commit", "-q", "-m", "base")
  g("checkout", "-q", "-b", "feat")
  writeFileSync(join(where, "src", "app.ts"), "export const one = 1\n")
  g("add", "-A")
  g("commit", "-q", "-m", "feat")
  return where
}

// INV-2 (refuse, never vanish — the door must not materialize a program
// whose spawns it knows will refuse) / INV-4 (the change's own receipt
// must be true).
//
// The model-less dropout audit (gate-r2 momentum-15): the bin levies a
// docs-only audit with NO --model and prints the receipt "temperature
// pins dropped; the lenses run on the host default, untuned". The door
// honors that contract by stripping the pins in its pin-plan
// (src/doors/review.ts, the `args.auditLevy === true && args.model ===
// undefined` arm): `templateToml = stripTemperaturePins(templateToml)`.
// But that stripped content is a LOCAL variable, and every writer of
// the materialized workflow.toml is keyed on other values:
//   - the pinned write fires only `if (pinnedWorkflowToml !==
//     undefined)`, and pinnedWorkflowToml is assigned only inside
//     `if (typeof args.model === "string")` — false here;
//   - the else-branch writes only the ROSTER strip — undefined here.
// So the audit materialization cpSync's the RAW template (pins intact)
// and the strip is dead. The booked audit then refuses every lens spawn
// at the host ("temperature … has no model to pin against — refusing
// spawn", src/adapters/opencode-host.ts) — the exact four-lenses-late
// death the door block exists to refuse, on the audit path whose whole
// purpose (momentum-15) is to produce a verdict for the skipped class.
// The receipt lies: the pins are NOT dropped.
//
// On BASE there is no auditLevy: the door's else-branch refuses a
// temperature-pinned template with no model (code 2), so the scenario
// cannot arise — the repro returns green there by construction.
test("a model-less dropout audit's materialized program carries no temperature pins, as its own receipt claims", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-p23-"))
  const out = join(tmp, "program") // must NOT exist beforehand
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const r = prepareReview(
      // the bin's exact shape for an audited docs_only skip: no model,
      // auditLevy set (bin/whitehartlane: gateAudit → auditLevy)
      { repo, base: "master", head: "feat", out, auditLevy: true },
      join(ROOT, "templates"),
    )
    if (!r.ok) return // BASE shape: the door refuses a model-less pinned template — nothing to judge
    assert.ok(
      !("skipped" in r && r.skipped),
      "sanity: the audit levy must materialize (the docs-only skip does not apply to it)",
    )
    // the consumer's own read of the materialized bytes: walk the parsed
    // document the way the pin-plan's hasTempPin walk does — a
    // temperature KEY anywhere means the pins were NOT dropped
    const toml = readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")
    const parsed = parseToml(toml) as unknown
    const tempKeys: string[] = []
    ;(function walk(node: unknown, path: string): void {
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`))
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (k === "temperature") tempKeys.push(`${path}.${k}`)
          walk(v, `${path}.${k}`)
        }
      }
    })(parsed, "")
    assert.deepEqual(
      tempKeys,
      [],
      `INV-2/INV-4: the model-less dropout audit's receipt (bin/whitehartlane: "review: dropout audit without ` +
        `--model — temperature pins dropped; the lenses run on the host default, untuned") is false. The door ` +
        `accepted the audit (ok=true) and its pin-plan stripped the pins into the LOCAL templateToml ` +
        `(review.ts, the auditLevy arm: templateToml = stripTemperaturePins(templateToml)) — but nothing writes ` +
        `that variable: the pinned write is gated on pinnedWorkflowToml (assigned only for a string --model) and ` +
        `the else-branch writes only the roster strip. The materialized program keeps the template's pins: ` +
        `temperature keys at ${JSON.stringify(tempKeys)} with NO workflow.model — every lens spawn then refuses at ` +
        `the host (opencode-host.ts: "temperature … has no model to pin against — refusing spawn"), the ` +
        `four-lenses-late death this door block exists to refuse, on the audit path whose whole purpose is to ` +
        `produce a verdict for the skipped class. Refuse, never vanish — or land the strip the receipt promises.`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
