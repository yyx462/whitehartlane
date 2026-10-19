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
  // the rail's own label, not a recompute: runIdFor seeds on Date.now(),
  // so an independent paneLabeler(runIdFor(dir)) call can straddle a
  // millisecond boundary, script a label the rail never queries, and
  // flake this test "none" under suite load — rail.scopedName is the
  // exact string answerPermission reads (same pattern as rail.test.ts).
  const scoped = rail.scopedName("alpha")
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
  // The probe must be an existing path NO temp root covers. This
  // suite's own directory is not a safe probe: the merge gate clones
  // into $TMPDIR, where scopeCovers counts the checkout itself as
  // temp scratch and the door would rightly admit. /Users/Shared
  // exists on every macOS and is never temp and never a scope root.
  const elsewhere = "/Users/Shared"
  writeFileSync(
    join(prog, "workflow.toml"),
    [
      "[workflow]",
      'name = "t"',
      'worker_kind = "opencode"',
      "",
      "[[stage]]",
      'id = "work"',
      'topology = "solo"',
      'brief = "do the work described in task.txt"',
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
  // the stop is EVENT-CHOREOGRAPHED, not wall-clock: it lands after the
  // third dialog is asked, on the engine's own beat. A setTimeout stop
  // raced the ladder under suite load (#52 flake): slow beats meant the
  // stop could arrive before two verdicts accumulated.
  let asked = 0
  herdr.readFor = (n) => {
    if (!n.startsWith("alpha")) return ""
    asked++
    if (asked === 3) {
      mkdirSync(join(dir, "messages"), { recursive: true })
      writeFileSync(
        join(dir, "messages", "9-beta.json"),
        JSON.stringify({ from: "beta", to: "alpha", type: "stop", body: "goal reached" }),
      )
    }
    return askFor(join(dir, "notes", `x-${Math.random()}.txt`))
  }
  herdr.onKeys = () => {}

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
  // Home is planted INSIDE the temp tree. A probe at this suite's own
  // checkout is not location-proof: the merge gate clones into $TMPDIR,
  // where the probe sits outside home under temp — allowed on the spot,
  // no deny guidance, no defer. Under a planted home the same temp path
  // keeps its judged gray zone (the predicate's own carve-out), so the
  // probe below is denied-unneeded in every checkout location.
  const home = await mkdtemp(join(tmpdir(), "perm-home-"))
  const rail = fakeRail(dir, herdr, ledger as never, { judge: () => 0, home })

  // alpha's brain: first turn ends on an OUTSIDE-roots dialog (denied,
  // judge at 0). The esc dismisses it to idle — but the pane then
  // refuses every prompt (held): the deny guidance cannot land, exactly
  // the j-a532f9 race. The ladder must nudge, nudge, DEFER at the cap
  // (guidance queued), then die honestly on the second expiry.
  // The wandering path lives under HOME, never under this checkout: the
  // merge gate clones the head into a TMPDIR, and temp-outside-home is
  // free scratch by design (j-ba18b7) — a checkout-local "uncovered"
  // path stops being uncovered exactly where the gate tests, the ask
  // flips to allow, no deny queues, and the defer never happens. HOME
  // itself is the planted temp tree above, so the probe holds in every
  // checkout location without touching the operator's real home.
  const outside = join(home, "no-root-covers-this.txt") // under home, covered by no root
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

  // the stop is a 30s BACKSTOP only — the ladder's honest death is what
  // ends this run. At 2600ms it raced the ladder under suite load
  // (#53a flake): stretched beats let the stop land first, the
  // exchange finished "done", and the honest-death assertion failed.
  // try/catch: if the ladder already ended the run and the fixture dir
  // is gone, the backstop dies quietly instead of throwing in an
  // unref'd timer.
  setTimeout(() => {
    try {
      mkdirSync(join(dir, "messages"), { recursive: true })
      writeFileSync(
        join(dir, "messages", "9-beta.json"),
        JSON.stringify({ from: "beta", to: "alpha", type: "stop", body: "goal reached" }),
      )
    } catch {
      /* the run already ended and the fixture is gone */
    }
  }, 30_000).unref?.()

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

// (sanitizeRoots pin retired with the export, §5 slice 2: the strip is
// internal to the canonical predicate now — its behavior + the LOUD
// warning are pinned in permission.test.ts via declareScope/scopeFromDir,
// and the fold itself in engine.test.ts programRootsOf)
