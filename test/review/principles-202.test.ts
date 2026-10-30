import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// the unit ledger rides the OS-disk trace — pin a private home before
// anything imports the store (the repo's own repro convention)
const HOME = mkdtempSync(join(tmpdir(), "whl-p202-home-"))
process.env.AGENTIC_OS_HOME = HOME
process.env.AGENTIC_OS_NOTIFY = "0"

import test from "node:test"
import { runCoworker } from "../../src/engines/coworker-run.ts"
import { loadManifest } from "../../src/doors/hooks.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "../util.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// BASE shape guard (the momentum-14 device): workflow.born_ms — the field
// whose accepted-but-vanishing status this finding pins — is this diff's
// own addition to the manifest parser. Vacuous green on BASE.
const HAS_BORN_MS = readFileSync(join(ROOT, "src", "doors", "hooks.ts"), "utf8").includes("born_ms")

function coworkerDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      'kind = "coworker"',
      "",
      "[workflow]",
      'name = "p202-coworker"',
      'worker_kind = "opencode"',
      // the field the parser now accepts and range-checks for EVERY
      // workflow (hooks.ts, 30000-600000) — and the seat below ignores it
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

test("a coworker program's never-boarding member is judged, not deferred on 'working' forever (born_ms must not vanish at the coworker seat)", async () => {
  if (!HAS_BORN_MS) return // BASE: the field does not exist — nothing to judge

  const dir = coworkerDir("whl-p202-run-")
  try {
    // ── remedy arm: INV-2's honest refusal is a compliant fix — if the
    // parser refuses born_ms where no engine reads it, the law holds.
    let manifest: ReturnType<typeof loadManifest>
    try {
      manifest = loadManifest(dir)
    } catch {
      return // refused at the door — never vanish: compliant
    }

    // premise: the parser ACCEPTS the field for this coworker program
    assert.equal(
      (manifest.workflow as { born_ms?: number }).born_ms,
      30000,
      "premise: loadManifest accepts and range-checks born_ms for a coworker workflow (hooks.ts)",
    )

    const herdr = fakeHerdr()
    const ledger = fakeLedger()
    // alpha — the initiator — is the j-4a0009 shape: agent start SUCCEEDS
    // (a pane exists, a prompt was submitted) but no session EVER lands,
    // and the multiplexer reports the agent "working" the whole time
    // (the modal-inside-a-running-agent class).
    const origRunner = herdr.runner.bind(herdr)
    herdr.runner = ((args: string[]) => {
      const out = origRunner(args)
      if (args[0] === "agent" && args[1] === "start") herdr.phase[args[2]!] = "working"
      return out
    }) as typeof herdr.runner
    herdr.onPrompt = () => {} // never boards, never mails
    const rail = fakeRail(dir, herdr, ledger as never)

    // bound the exchange: the stop lands from beta at 34s — the judgment
    // window under test is everything before it. ADAPTED (gate-r32,
    // momentum-105): the birth patience is the DECLARED born_ms alone
    // (30s floor) — the r30 min(born_ms, stall_ms) formula was the
    // disease momentum-105 closed, so the ruling lands at ~30s and the
    // window must span it.
    setTimeout(() => {
      mkdirSync(join(dir, "messages"), { recursive: true })
      writeFileSync(
        join(dir, "messages", "1-beta.json"),
        JSON.stringify({ from: "beta", to: "alpha", type: "stop", body: "bound the run" }),
      )
    }, 34_000).unref()

    const run = Promise.race([
      runCoworker(rail, { stallMs: 300, beatMs: 60, graceMs: 0 }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("the exchange never ended — the repro bound failed")), 60_000).unref(),
      ),
    ])
    await run

    // premise: alpha never boarded — no session ever booked on its rows
    const alphaRows = ledger.job.panes.filter((p) => p.unit === "alpha")
    assert.ok(alphaRows.length > 0, "sanity: alpha birthed through the rail")
    assert.ok(
      alphaRows.every((p) => !p.transcript?.session_id),
      `premise: alpha NEVER boarded (no session on any of its ${alphaRows.length} pane rows) while herdr reported ` +
        `agent_status "working" the whole run`,
    )

    // THE LAW: the fan-out bench answers "a pane that never BOARDS is
    // transport class — kill + respawn within minutes, never ride the
    // ceiling" TWICE (templates/pr-review/workflow.toml's born_ms comment
    // and the birth judge's own doctrine, orchestrator.ts birthJudge —
    // this diff's own tests-500/5002 pin the ruling). The coworker bench
    // — the same manifest parser now accepting born_ms — answers with
    // NOTHING: the stall judge defers the ball-holder on "working"
    // unconditionally (coworker-run.ts:450), the liveness judge sees a
    // live pane, grace reprompts and moves on — so the member that never
    // boarded rides the entire exchange with zero birth-class rulings,
    // and the exchange's own stop-deadlock ("the run #17 shape: a member
    // nobody hears") has no ladder to break it. born_ms is an accepted
    // field with NO consumer on this seat (INV-2: refuse, never vanish).
    const birthRulings = ledger.events.filter(
      (e) =>
        (e.kind === "retry" && String((e.payload as { member?: string }).member) === "alpha") ||
        (e.kind === "unit.reborn" && String((e.payload as { unit?: string }).unit) === "alpha") ||
        (e.kind === "close" && String((e.payload as { unit?: string; member?: string }).unit ?? (e.payload as { member?: string }).member) === "alpha"),
    )
    assert.ok(
      birthRulings.length > 0,
      `INV-2/INV-3: "how long may an unboarded pane ride?" is ONE decision with TWO benches, and this diff ` +
        `answered it for one of them. The fan-out bench rules at born_ms (orchestrator.ts birthJudge: session ` +
        `existence is the only key; the working exemption dies at bornMs; unboarded = kill + respawn, capped) — ` +
        `its own template law: "a pane that never BOARDS (no agent session) is transport class, not silence — ` +
        `kill + respawn within minutes, never ride the ceiling". The coworker bench (coworker-run.ts) has NO ` +
        `birth seat: the stall judge defers the ball-holder on \`b.status === "working"\` UNCONDITIONALLY ` +
        `(coworker-run.ts:450 — exactly what the fan-out birth judge was written to stop trusting past bornMs), ` +
        `liveness sees a live pane, grace reprompts — so alpha, which never boarded (premise above) while ` +
        `herdr reported "working" (the j-4a0009 modal class, same host, same spawn machinery), rode the WHOLE ` +
        `exchange with zero birth-class rulings (events: ${JSON.stringify(ledger.events.map((e) => e.kind))}) — ` +
        `while loadManifest ACCEPTED born_ms for this very program (premise: 30000) with no consumer on this ` +
        `seat (INV-2: refuse, never vanish). Seat a birth ruling in the coworker bench (or refuse born_ms where ` +
        `no engine reads it) — a member nobody hears must not ride to the deadline twice over.`,
    )
  } finally {
    rmSync(join(HOME, "sessions"), { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
