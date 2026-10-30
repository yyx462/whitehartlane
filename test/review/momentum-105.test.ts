import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// the ledger rides the OS-disk trace and the boarding oracle reads the
// opencode store — pin both before anything imports the store (the
// repo's own repro convention)
const HOME = mkdtempSync(join(tmpdir(), "whl-m105-home-"))
process.env.AGENTIC_OS_HOME = HOME
process.env.AGENTIC_OS_NOTIFY = "0"
// bound the stop-settle: with the declared born_ms honored (the fix
// direction) alpha is still "working" when beta's stop lands — the
// settle ceiling must not ride 10 minutes
process.env.AGENTIC_OS_DRAIN_MS = "500"
// a readable store whose tables are absent: no session ever resolves
// (resolveOpencode falls through) — alpha never boards, deterministically
const DB = join(mkdtempSync(join(tmpdir(), "whl-m105-db-")), "opencode.db")
process.env.OPENCODE_DB = DB

import test from "node:test"
import { runCoworker } from "../../src/engines/coworker-run.ts"
import { loadManifest } from "../../src/doors/hooks.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "../util.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape guard (the momentum-14 device): workflow.born_ms and the
// member birth seat are this diff's own additions. Vacuous green on BASE.
const HAS_BORN_MS = readFileSync(join(ROOT, "src", "doors", "hooks.ts"), "utf8").includes("born_ms")

function coworkerDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      'kind = "coworker"',
      "",
      "[workflow]",
      'name = "m105-coworker"',
      'worker_kind = "opencode"',
      "born_ms = 30000",
      "",
      "[hooks]",
      'grade = "echo pass"',
      'counts = "printf \'{}\'"',
      "",
      "[members.alpha]",
      "initiates = true",
      "",
      "[members.beta]",
      "",
    ].join("\n"),
  )
  mkdirSync(join(dir, "members"), { recursive: true })
  writeFileSync(join(dir, "members", "alpha.md"), "Find the capital and tell beta.\n")
  writeFileSync(join(dir, "members", "beta.md"), "Wait for alpha, then wrap up.\n")
  return dir
}

test("the member birth patience honors the DECLARED born_ms — the stall ceiling must not override it (the fan-out twin answers at born_ms alone)", async () => {
  if (!HAS_BORN_MS) return // BASE: the field does not exist — nothing to judge

  const dir = coworkerDir("whl-m105-run-")
  try {
    // premise: the parser accepts and range-checks born_ms for this
    // coworker program — the operator DECLARED a 30s birth patience
    const manifest = loadManifest(dir) as { workflow?: { born_ms?: number } }
    assert.equal(manifest.workflow?.born_ms, 30000, "premise: born_ms accepted for the coworker program")

    const herdr = fakeHerdr()
    const ledger = fakeLedger()
    // alpha never boards and the multiplexer reports "working" forever
    // (the #249 class) — the exact shape the member birth seat judges.
    // No predecessor rows: this is a CLEAN first generation, so the
    // boarding question itself is not in dispute (momentum-104's arc).
    const origRunner = herdr.runner.bind(herdr)
    herdr.runner = ((args: string[]) => {
      const out = origRunner(args)
      if (args[0] === "agent" && args[1] === "start") herdr.phase[args[2]!] = "working"
      return out
    }) as typeof herdr.runner
    herdr.onPrompt = () => {} // never boards, never mails
    const rail = fakeRail(dir, herdr, ledger as never)

    const t0 = Date.now()
    // bound the exchange: beta's stop lands at 2.5s (the drain ceiling
    // env above keeps the stop-settle honest while alpha still reads
    // "working" on a compliant fix)
    setTimeout(() => {
      mkdirSync(join(dir, "messages"), { recursive: true })
      writeFileSync(
        join(dir, "messages", "1-beta.json"),
        JSON.stringify({ from: "beta", to: "alpha", type: "stop", body: "bound the run" }),
      )
    }, 2_500).unref()

    // opts.stallMs is the value engine.ts forwards from
    // manifest.workflow.stall_ms (src/engines/engine.ts:150); 300 stands
    // in for a declared stall_ms below born_ms (the parser floors
    // stall_ms at 60s — real seconds-scale is impossible in a test, the
    // mechanism is identical)
    const report = await Promise.race([
      runCoworker(rail, { stallMs: 300, beatMs: 60, graceMs: 0 }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("the exchange never ended — the repro bound failed")), 15_000).unref(),
      ),
    ])
    const elapsed = Date.now() - t0

    // premise: alpha never boarded — no session on any of its rows
    const alphaRows = ledger.job.panes.filter((p) => p.unit === "alpha")
    assert.ok(alphaRows.length > 0, `sanity: alpha birthed through the rail (${alphaRows.length} rows)`)
    assert.ok(
      alphaRows.every((p) => !p.transcript?.session_id),
      `premise: alpha NEVER boarded (no session on any of its ${alphaRows.length} pane rows) while herdr reported agent_status "working" the whole run`,
    )

    const rulings = ledger.events.filter(
      (e) =>
        (e.kind === "retry" && String((e.payload as { member?: string }).member) === "alpha") ||
        (e.kind === "wake" && String((e.payload as { why?: string }).why ?? "").includes("dead at birth")),
    )
    // eslint-disable-next-line no-console
    console.log(`m105 probe: elapsed=${elapsed}ms rulings=${JSON.stringify(rulings.map((r) => ({ k: r.kind, p: r.payload })))} report=${JSON.stringify(report?.status ?? null)}`)

    // THE LAW (INV-3): "how long may an unboarded pane ride before the
    // birth seat judges it?" is ONE decision. The fan-out bench answers
    // it with the DECLARED field alone — orchestrator.ts birthJudge:
    // `if (b.age <= bornMs) return none`, born_ms 30000 → the first
    // ruling lands at 30s, the stall ceiling (300 here) never enters.
    // The member seat instead computes Math.min(born_ms, stallMs)
    // (coworker-run.ts bornPatience) — the stall ceiling silently
    // overrides the operator's declared patience, and with a declared
    // stall_ms below born_ms the member is retried/closed while the
    // fan-out twin on the SAME manifest spares it. A clean-generation
    // member must not see a birth ruling before its declared born_ms.
    assert.deepEqual(
      rulings,
      [],
      `INV-3: the birth patience is ONE decision and the two benches answer it with different formulas. ` +
        `The manifest declares born_ms = 30000; the fan-out twin (orchestrator.ts birthJudge) honors it ` +
        `alone and would rule at 30s on this identical config, but coworker-run.ts computes ` +
        `bornPatience = Math.min(born_ms, stallMs) — the stall ceiling engine.ts forwards ` +
        `(manifest.workflow.stall_ms) silently overrides the operator's declared patience, and alpha was ` +
        `birth-retried/closed at ${elapsed}ms, ${30000 - elapsed}ms before its declared patience elapsed. ` +
        `The member seat must answer at born_ms (the earlier clock claim is the twin's own comment, ` +
        `not the twin's code).`,
    )
  } finally {
    rmSync(join(HOME, "sessions"), { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
