// The j-a532f9 postmortem, pinned: (#51) admission refuses briefs
// naming paths no root covers; (#52) a dialog the rail answered is
// progress, not idle; (#53) the nudge-cap kill defers while guidance
// is still queued, and the permission trace carries the verdict
// message; (#54) queued-note flush never double-scopes the label.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { paneLabeler, runIdFor } from "../src/orchestrator.ts"
import { Rail } from "../src/rail.ts"
import { prepareRun } from "../src/run.ts"
import { runCoworker } from "../src/coworker-run.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "./util.ts"

process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "aos-perm-hard-"))

test.after(() => rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true }))

function askFor(path: string): string {
  return `Permission required\nwrite to ${path}\nthe agent wants to touch this file`
}

// -- #54 + #53b: the rail level -------------------------------------------

test("a queued deny note flushes with a single-scoped label, and the trace carries the verdict message (#54, #53b)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "perm-flush-"))
  const ledger = fakeLedger()
  const herdr = fakeHerdr()
  const rail = fakeRail(dir, herdr, ledger as never, { judge: () => 0, home: homedir() })
  const scoped = paneLabeler(runIdFor(dir))("alpha")
  herdr.phase[scoped] = "dialog"
  herdr.readFor = () => askFor("/definitely/not/a/root/x.txt")

  const verdict = rail.answerPermission("alpha")
  assert.equal(verdict, "deny")
  // the blocked pane refused the prompt — the note queues
  assert.equal(rail.hasPendingNote("alpha"), true)
  // the trace names WHY, not just what
  const ev = ledger.events.find((e) => e.kind === "permission")
  assert.ok(ev, "permission event on the trace")
  assert.match(String(ev.payload.message), /denied/)

  // unblock → flush delivers, and no herdr call ever carries a
  // double-scoped label (the styler-x-x bug)
  herdr.phase[scoped] = "idle"
  assert.equal(rail.flushPendingNotes(), 1)
  const doubled = herdr.calls.filter(
    (c) => c[0] === "agent" && typeof c[2] === "string" && c[2].startsWith(`${scoped}-`),
  )
  assert.equal(doubled.length, 0)
  assert.equal(rail.hasPendingNote("alpha"), false)
})

// -- #51: the door ----------------------------------------------------------

test("admission refuses briefs naming existing paths no root covers (#51)", async () => {
  const prog = await mkdtemp(join(tmpdir(), "adm-noroots-"))
  // macOS tmpdir is /var/folders — temp scratch, always free. A real
  // uncovered path: this test's own directory.
  const elsewhere = import.meta.dirname
  writeFileSync(
    join(prog, "workflow.toml"),
    [
      "[workflow]",
      'name = "t"',
      'worker_kind = "opencode"',
      "",
    ].join("\n"),
  )
  // temp + nonexistent paths never count; an existing uncovered one does
  writeFileSync(join(prog, "task.txt"), `work in ${elsewhere} — logs at /tmp/x/y.log, see also /no/such/dir/z\n`)

  const refused = prepareRun(prog)
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? "" : refused.why, /no root covers/)
  assert.ok((refused.ok ? "" : refused.why).includes(elsewhere))

  // covered by roots.txt → admitted
  writeFileSync(join(prog, "roots.txt"), `${elsewhere}\n`)
  const ready = prepareRun(prog)
  assert.equal(ready.ok, true)
})

// -- #52 + #53a: the coworker engine ---------------------------------------

async function coworkerDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      'kind = "coworker"',
      "",
      "[workflow]",
      'name = "t"',
      'worker_kind = "opencode"',
      "",
      "[members.alpha]",
      "initiates = true",
      "",
      "[members.beta]",
      "",
    ].join("\n"),
  )
  mkdirSync(join(dir, "members"), { recursive: true })
  writeFileSync(join(dir, "members", "alpha.md"), "Hold the ball; beta stops the exchange.\n")
  writeFileSync(join(dir, "members", "beta.md"), "Stop the exchange when told.\n")
  return dir
}

test("a dialog the rail keeps answering is progress — the nudge budget is not spent (#52)", async () => {
  const dir = await coworkerDir("cw-verdict-progress-")
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const rail = fakeRail(dir, herdr, ledger as never, { home: homedir() })

  // alpha's brain: every turn ends on an in-roots dialog, and answering
  // it just presents the next one — blocked on dialogs, never "working"
  herdr.onPrompt = (name) => {
    herdr.phase[name] = "dialog"
  }
  herdr.readFor = (n) => (n.startsWith("alpha") ? askFor(join(dir, "notes", `x-${Math.random()}.txt`)) : "")
  herdr.onKeys = () => {}

  setTimeout(() => {
    mkdirSync(join(dir, "messages"), { recursive: true })
    writeFileSync(
      join(dir, "messages", "9-beta.json"),
      JSON.stringify({ from: "beta", to: "alpha", type: "stop", body: "goal reached" }),
    )
  }, 900).unref?.()

  const report = await runCoworker(rail, { stallMs: 250, beatMs: 80 })
  const nudges = ledger.events.filter((e) => e.kind === "reprompt" && e.payload.nudge)
  assert.equal(nudges.length, 0, "verdicts reset the stall clock — no nudges on dialog churn")
  const verdicts = ledger.events.filter((e) => e.kind === "permission")
  assert.ok(verdicts.length >= 2, "dialogs kept coming and kept being answered")
  assert.equal(report.status, "done")
})

test("a nudge-cap kill defers one beat while the deny guidance is still queued (#53a)", async () => {
  const dir = await coworkerDir("cw-defer-")
  const herdr = fakeHerdr()
  const ledger = fakeLedger()
  const rail = fakeRail(dir, herdr, ledger as never, { judge: () => 0, home: homedir() })

  // alpha's brain: first turn ends on an OUTSIDE-roots dialog (denied,
  // judge at 0). The esc dismisses it to idle — but the pane then
  // refuses every prompt (held): the deny guidance cannot land, exactly
  // the j-a532f9 race. The ladder must nudge, nudge, DEFER at the cap
  // (guidance queued), then die honestly on the second expiry.
  const outside = join(import.meta.dirname, "perm-hardening.test.ts") // exists, covered by no root
  let asked = false
  herdr.onPrompt = (name) => {
    if (!asked) {
      asked = true
      herdr.phase[name] = "dialog"
      herdr.readFor = (n) => (n.startsWith("alpha") ? askFor(outside) : "")
    }
  }
  herdr.onKeys = (name) => {
    herdr.phase[name] = "idle"
    herdr.hold.add(name) // the pane will not take another prompt
  }

  setTimeout(() => {
    mkdirSync(join(dir, "messages"), { recursive: true })
    writeFileSync(
      join(dir, "messages", "9-beta.json"),
      JSON.stringify({ from: "beta", to: "alpha", type: "stop", body: "goal reached" }),
    )
  }, 2600).unref?.()

  const report = await runCoworker(rail, { stallMs: 250, beatMs: 80 })
  const kinds = ledger.events.map((e) => `${e.kind}:${e.payload.nudge ?? e.payload.deferred ?? ""}`)
  assert.ok(kinds.includes("reprompt:1"), "first nudge")
  assert.ok(kinds.includes("reprompt:2"), "second nudge")
  assert.ok(
    ledger.events.some((e) => e.kind === "reprompt" && e.payload.deferred === true),
    "death deferred — guidance still queued",
  )
  assert.ok(
    ledger.events.some((e) => e.kind === "wake" && String(e.payload.why).includes("stalled past the nudge cap")),
    "second expiry is honest death",
  )
  assert.equal(report.status, "failed")
})

test("sanitizeRoots strips hard-deny paths from a program's declared roots (j-1deef9)", async () => {
  const { sanitizeRoots } = await import("../src/permission.ts")
  const { kept, stripped } = sanitizeRoots([
    "/Users/x/proj",
    "/Users/x/.ssh",
    "/Users/x/vault/.env",
    "/Users/x/normal/tree",
  ])
  assert.deepEqual(kept, ["/Users/x/proj", "/Users/x/normal/tree"])
  assert.deepEqual(stripped, ["/Users/x/.ssh", "/Users/x/vault/.env"])
})
