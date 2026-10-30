// principles-101 — the supervisor's commission-end seat: ONE decision, ONE site.
//
// The change mints a supervisor (src/doors/ship-supervisor.ts) whose job is
// to OWN the review until it is over, and it answers "when is the commission
// over" in TWO places:
//
//   1. the WATCHER script (the .watch file) waits on
//        $OUT/data/review/merge.json
//      — the seat the LAST chain stage (merge) writes.
//
//   2. the BRIEF (supervisorBrief, the text the agent itself follows) tells
//      the agent to wait on
//        <staged>/data/review/verdict.json
//      — the seat the `prove` stage writes, which is stage 3 of 5
//      (intake → lenses → prove → divide → merge).
//
// The two answers disagree. The brief's answer is the one the AGENT
// executes: it wakes on the verdict, and its own step 5 asks for "the
// feedback pointers from the job run dir's feedback/MAP.md" — a file the
// `divide` stage writes AFTER the verdict, so at the moment the brief's
// wait resolves that file cannot exist yet. The PR receipt is composed
// before the feedback map exists and before the merge ran.
//
// Why the repo's own adopted test misses it: test/review/principles-4004.test.ts
// scans the brief, but it passes spawnSupervisor a STUB brief ("BRIEF"),
// never the rendered supervisorBrief() text — so the brief's polled seat is
// never seen. This repro renders the REAL brief.
//
// The law (INV-3, one function per decision): the seat that resolves "the
// commission is over" is ONE seat. The watcher and the brief must name the
// same file, and that file must be written by the LAST stage of the chain.
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

const REPO_ROOT = join(import.meta.dirname, "..", "..")
const TEMPLATES = join(REPO_ROOT, "templates")
const PR_REVIEW = join(TEMPLATES, "pr-review")

// the chain's stages, in order, with their hook scripts
function chainStages(): { id: string; hook: string }[] {
  const toml = readFileSync(join(PR_REVIEW, "workflow.toml"), "utf8")
  return toml
    .split(/\[\[stage\]\]/)
    .slice(1)
    .map((b) => ({
      id: /id\s*=\s*"([^"]+)"/.exec(b)?.[1] ?? "?",
      hook: (/run\s*=\s*"([^"]+)"/.exec(b)?.[1] ?? "").replace(/^bash\s+/, ""),
    }))
}

// does this hook script WRITE that seat? a WRITE, on the same line — not a
// read of the same name, not a write of a different file.
function writesSeat(hookText: string, rel: string): boolean {
  const base = rel.split("/").pop() ?? rel
  for (const line of hookText.split("\n")) {
    if (!line.includes(base)) continue
    if (!/writeFileSync|appendFileSync|createWriteStream|>>|>\s*["']?\$/.test(line)) continue
    return true
  }
  return false
}

// the seats the watcher polls: [ ! -f "$OUT<path>" ]
function watcherSeats(watcher: string): string[] {
  return [...watcher.matchAll(/\[ ! -f "\$OUT([^"]*)" \]/g)].map((m) => m[1].replace(/^\//, ""))
}

// the seats the BRIEF polls: any data/review/<file>.json it names
function briefSeats(brief: string): string[] {
  return [...new Set([...brief.matchAll(/([A-Za-z0-9_.-]*\/)*data\/review\/[A-Za-z0-9_.-]+\.json/g)].map((m) => m[0]))]
}

test("principles-101: the supervisor's wait is ONE seat, and it is the LAST stage's seat", async () => {
  // the seat is NEW in this change: on a BASE without the supervisor there is
  // no brief at all — the import is dynamic so a missing module FAILS the
  // test (an assertion) instead of breaking the load.
  const mod = (await import("../../src/doors/ship-supervisor.ts").catch(() => null)) as
    | typeof import("../../src/doors/ship-supervisor.ts")
    | null
  assert.ok(mod, "the supervisor seat must exist — the wait must have an owner")
  const { supervisorBrief } = mod

  const brief = supervisorBrief({
    levyCmd: "whl review /repo --model p/m",
    runDir: "/staged",
    pr: "42",
    repo: "/repo",
  })

  // the watcher script the same door writes: the brief and the watcher are
  // two answers to one question, so they must agree.
  const watcher = readFileSync(join(REPO_ROOT, "src", "doors", "ship-supervisor.ts"), "utf8")
  const watcherText = watcher
    .split("\n")
    .filter((l) => l.includes('[ ! -f "$OUT'))
    .join("\n")
  const wSeats = watcherSeats(watcherText)
  const bSeats = briefSeats(brief)
  assert.ok(wSeats.length > 0, "the watcher must wait on something")
  assert.ok(bSeats.length > 0, "the brief must tell the agent what to wait on")

  // THE TWIN: the two sites must name the SAME seat.
  const shared = wSeats.filter((s) => bSeats.includes(s))
  assert.ok(
    shared.length > 0,
    `the watcher and the brief wait on DIFFERENT seats — one decision, two answers.\n` +
      `  watcher waits on: ${wSeats.join(", ")}\n` +
      `  brief tells the agent to wait on: ${bSeats.join(", ")}\n` +
      `  the agent follows the BRIEF, so the PR receipt is composed when the brief's seat\n` +
      `  resolves — before the divide stage wrote feedback/MAP.md and before the merge ran.`,
  )

  // ...and that one seat must be written by the LAST stage of the chain.
  const stages = chainStages()
  const last = stages.length - 1
  for (const rel of new Set([...wSeats, ...bSeats])) {
    const writers = stages
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.hook && existsSync(join(PR_REVIEW, s.hook)) && writesSeat(readFileSync(join(PR_REVIEW, s.hook), "utf8"), rel))
    assert.ok(writers.length > 0, `the seat ${rel} must be written by some stage of the chain (writers found: none)`)
    for (const w of writers) {
      assert.equal(
        w.i,
        last,
        `the supervisor waits on ${rel}, which the '${w.s.id}' stage writes — but the chain continues (${stages
          .slice(w.i + 1)
          .map((x) => x.id)
          .join(", ")}) after it: the wait resolves while workers are still working, so the PR comment is composed before the feedback map exists and the outcome is announced before the merge ran`,
      )
    }
  }
})
