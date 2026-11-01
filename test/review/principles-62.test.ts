import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { prepareReview } from "../../src/doors/review.ts"
import { parse as parseToml } from "smol-toml"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const BIN = join(ROOT, "bin", "whitehartlane")

// The scenario needs the GATE's audit path, so this repro pins its own
// machine: a temp AGENTIC_OS_HOME (the store the gate's label scans
// read), a fresh WHL_GATE_LEDGER (fresh class → audit rate 1.0), and a
// jev stub that answers "no lens clears the bar" (noul 0 ×4 → empty
// roster → the dropout audit escalates the skip — "an audit nobody
// runs measures nothing").
const STORE = mkdtempSync(join(tmpdir(), "whl-p62-store-"))
process.env.AGENTIC_OS_HOME = STORE
process.env.AGENTIC_OS_NOTIFY = "0"
process.env.WHL_GATE_LEDGER = join(STORE, "gate.jsonl")

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

// the SHIPPED template with ONE edit: a valid model declared in
// [workflow]. The template author pinned a model precisely so the
// temperature pins always have something to ride.
function modelPinnedTemplate(where: string): string {
  cpSync(join(ROOT, "templates", "pr-review"), where, { recursive: true })
  const tomlPath = join(where, "workflow.toml")
  const toml = readFileSync(tomlPath, "utf8")
  writeFileSync(tomlPath, toml.replace(/\[workflow\]\n/, `[workflow]\nmodel = "acme/strong"\n`))
  return where
}

function jevStub(where: string): string {
  mkdirSync(where, { recursive: true })
  const s = join(where, "jev-stub.sh")
  writeFileSync(
    s,
    `#!/bin/sh\ncat >&2\necho '{"answers":{"l_principles":{"noul":0},"l_tests":{"noul":0},"l_momentum":{"noul":0},"l_questions":{"noul":0}}}'\n`,
  )
  chmodSync(s, 0o755)
  return s
}

test("the audit receipt claims what the materialized program carries — model-carrying template included", () => {
  const tmp = mkdtempSync(join(tmpdir(), "whl-p62-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const tpl = modelPinnedTemplate(join(tmp, "tpl"))
    process.env.WHL_JEV_BIN = jevStub(join(tmp, "bin"))

    // --body-file at a nonexistent path: the door refuses AFTER the
    // gate has decided and printed, BEFORE any levy — the bin exits
    // without spawning a runner (this repro must start no panes).
    let stdout = ""
    try {
      stdout = execFileSync(
        process.execPath,
        [BIN, "review", repo, "--base", "master", "--head", "feat", "--template", tpl, "--out", join(tmp, "prog"), "--body-file", join(tmp, "nope.md")],
        { encoding: "utf8", env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
      )
    } catch (err) {
      const e = err as { status?: number; stdout?: string }
      stdout = e.stdout ?? ""
      assert.equal(e.status, 2, `sanity: the door refused the missing --body-file with its code-2 receipt (got status ${String(e.status)})`)
    }

    // BASE shape: no gate exists there — the audit receipt line cannot
    // fire and nothing about the audit path is judged (vacuous green,
    // so the prove gate classifies this repro as introduced).
    // ADAPTED AT ADOPTION (gate-r26, the momentum-34 r19 precedent):
    // the original receipt pinned the DISEASE — the bin printed the
    // drop-claim here (gateAudit && no --model-arg) while the door
    // kept the pins (the template's own model rides them). The fix
    // seats the fact at the DOOR: the receipt reports ready.untuned,
    // so a refused door prints no claims at all, and a model-carrying
    // template never earns the line. The end-to-end law — a receipt
    // never claims what the shipped program does not carry — untouched.
    const receiptClaimed = stdout.includes("temperature pins dropped")
    assert.ok(
      !receiptClaimed,
      `INV-4 (the receipt is a claim): the bin printed "temperature pins dropped" for a model-carrying template ` +
        `(the door refuses later on the poisoned --body-file, and even a successful run would keep the pins — ` +
        `the template's own model rides them): a receipt may only report what the door shipped (ready.untuned), ` +
        `never predict it from the gate's decision alone.`,
    )

    // the receipt's claim, checked against what the door SHIPS: the
    // same args (minus the poisoned --body-file) materialize the
    // program the audit would run.
    const r = prepareReview(
      { repo, base: "master", head: "feat", template: tpl, out: join(tmp, "prog2") },
      join(ROOT, "templates"),
    )
    assert.ok(r.ok && !("skipped" in r && r.skipped), `sanity: the door materialized the model-carrying template: ${(r as { why?: string }).why ?? "ok"}`)
    const mat = parseToml(readFileSync(join((r as { dir: string }).dir, "workflow.toml"), "utf8")) as {
      workflow?: { model?: string }
      stage?: Array<{ units?: Array<Record<string, unknown>> }>
    }
    assert.equal(mat.workflow?.model, "acme/strong", "sanity: the template's own model survived (the pin never rides)")
    const pinnedUnits: string[] = []
    for (const s of mat.stage ?? []) {
      for (const u of s.units ?? []) {
        if (u && typeof u === "object" && "temperature" in u) pinnedUnits.push(String((u as { id?: string }).id))
      }
    }
    // the door's own answer for the same template: pins ride (the
    // template's model carries them) and the door reports NO untuned
    // flag — the receipt's silence is the door's fact, not an omission
    assert.equal(
      ("untuned" in r && r.untuned) ?? false,
      false,
      `the door's untuned flag must stay unset for a model-carrying template — the strip never ran; ` +
        `the receipt's silence reports this flag`,
    )
    assert.ok(
      pinnedUnits.length > 0,
      `adapted at adoption (gate-r26): pins riding the template's OWN model are CORRECT materialization — ` +
        `the disease was never the pins, it was the receipt claiming they were dropped. Got ${JSON.stringify(pinnedUnits)} riding acme/strong.`,
    )
  } finally {
    delete process.env.WHL_JEV_BIN
    rmSync(tmp, { recursive: true, force: true })
    rmSync(STORE, { recursive: true, force: true })
  }
})
