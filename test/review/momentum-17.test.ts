import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the ledger rides the OS-disk trace and the fake DB rides OPENCODE_DB —
// pin both before anything reads them (the repo's own repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-m17-home-"))
const DB = join(mkdtempSync(join(tmpdir(), "whl-m17-db-")), "opencode.db")
process.env.OPENCODE_DB = DB
process.env.PATH = "" // no `opencode`/`shep` children: the fakes are the whole world

import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"
import type { RunnerResult } from "../../src/doors/runners.ts"

const ok = (): RunnerResult => ({ status: 0, stdout: "" })

function railOn(runDir: string): Rail {
  return new Rail({
    argvDir: runDir,
    transport: { exec: () => ({ status: 0, stdout: "{}" }) } as never,
    shepRunner: ok,
    herdrRunner: ok,
    // the fleet-tab path births panes through host.inhabit — fake it so
    // the REAL inhabitPane body (the code under judgment) runs whole
    host: { inhabit: () => true, usageOf: () => null } as never,
    log: () => {},
  })
}

// a resolvable agent session for `cwd`, born after `sinceIso`, whose
// first user message carries the brief's marker — the exact rows
// resolveOpencode/opencodeFirstUserHas query (session_v2 + session_message)
let msgSeq = 0
function seedSession(dir: string, cwd: string, sinceIso: string, marker: string, id: string): void {
  const db = new DatabaseSync(dir)
  db.exec("CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, directory TEXT, time_created REAL)")
  db.exec("CREATE TABLE IF NOT EXISTS session_message (seq INTEGER PRIMARY KEY, session_id TEXT, type TEXT, data TEXT)")
  db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?)").run(id, cwd, Date.parse(sinceIso) + 5_000)
  msgSeq += 1
  db.prepare("INSERT INTO session_message VALUES (?, ?, 'user', ?)").run(msgSeq, id, JSON.stringify({ text: `Work dir: ${marker}` }))
  db.close()
}

// INV-3 (one decision, one place — "what the birth judge's rebook needs
// to re-resolve a pane's session"). The diff adds Rail.tryBookSession —
// the birth judge's "one IMMEDIATE re-resolve before it is judged dead
// at birth" (rail.ts) — fed from per-pane spawn state:
// `const cwd = this.cwdOf.get(bare) ?? this.cwdOf.get(withW); const kind
// = this.kindOf.get(bare) ?? this.kindOf.get(withW); if (!cwd || !kind)
// return undefined`. THREE paths birth a pane, and the kind half of that
// state is written by TWO of them: spawnWorker sets kindOf (rail.ts,
// "the birth judge's second look … needs it to re-resolve a session"),
// and the r26 fix added it to resumeWorker (gate-r4 principles-25). The
// THIRD writer — inhabitPane, the FLEET-TAB birth that BOTH twins
// delegate to when layout.tab === "new" (`spawnWorker` → inhabitPane at
// rail.ts:705, `resumeWorker` → inhabitPane at rail.ts:760) — sets
// cwdOf/briefOf and NEVER kindOf. The fleet tab is not an edge: it is
// the pr-review production layout (this very review run's
// orchestrator.log: "layout=new/left … spawned w-principles … (opencode)
// in fleet tab pane"). On it the rebook is structurally dead for EVERY
// pane, and the booking chain has no other late booker: the birth
// resolve runs before the session mints (rail.ts's own comment: "The
// session mints on the first message and may land in the tool's store a
// beat later"), bookSessionLate is a ONE-SHOT +5s probe, and the birth
// judge's rebook is the designed second look. For a pane whose agent
// boards slower than the +5s probe (cold machine — the j-4a0009 class
// this judge was built for), the ledger row stays unbooked forever, and
// at born_ms the judge sees sessionOf === undefined and a rebook that
// refuses before the session store is consulted — so it retires +
// respawns a pane whose agent DID board, violating the judge's own r6
// doctrine ("boarded — however quiet" is spared; session existence is
// the only key), until RETRY_CAP closes the unit "dead at birth".
//
// Deterministic: two rails, a pane born through the shep branch
// (spawnWorker — kindOf set) and a pane born through inhabitPane (the
// fleet-tab body), identical cwd/brief/DB; the born pane's session is
// seeded AFTER its birth (the late-boarder shape: no session existed
// when the pane was born, nothing booked it since). The spawned pane's
// rebook resolves its session; the inhabited pane's cannot.
test("the birth judge's rebook resolves a fleet-tab pane's session too — inhabitPane feeds the same spawn state", () => {
  const runA = mkdtempSync(join(tmpdir(), "whl-m17-a-"))
  const runB = mkdtempSync(join(tmpdir(), "whl-m17-b-"))
  try {
    const railA = railOn(runA)
    // BASE shape: the rebook seam (rail.tryBookSession) is this diff's
    // own addition — on BASE there is no second look at all (green there)
    if (typeof (railA as { tryBookSession?: unknown }).tryBookSession !== "function") return

    // control: the SHEP-branch birth (spawnWorker) feeds the rebook —
    // kindOf set, session resolvable (principles-25's control, re-run
    // here to prove the harness on this exact rail build)
    const briefA = join(runA, "units", "france", "brief.md")
    mkdirSync(join(runA, "units", "france"), { recursive: true })
    writeFileSync(briefA, "work here")
    const okSpawn = railA.spawnWorker("w-france", "opencode", briefA, runA)
    assert.equal(okSpawn, true, "sanity: the shep-branch pane spawns")
    seedSession(DB, runA, new Date().toISOString(), join(runA, "units", "france"), "ses-a")
    assert.equal(
      railA.tryBookSession("france"),
      "ses-a",
      "sanity: the rebook resolves the session for a SPAWNED pane (kindOf was set at spawn)",
    )

    // the twin: the FLEET-TAB birth — the path both spawnWorker and
    // resumeWorker delegate to on the production layout (layout.tab ===
    // "new" + colPane). Same rail state except the one key inhabitPane
    // forgets. The session does NOT exist at birth (the late-boarder
    // shape: the birth resolve misses, and the one-shot +5s probe is
    // the only other booker on this path — it misses too), so the
    // birth judge's rebook is the ONLY booker left.
    const railB = railOn(runB)
    const briefB = join(runB, "units", "japan", "brief.md")
    mkdirSync(join(runB, "units", "japan"), { recursive: true })
    writeFileSync(briefB, "work here")
    const born = railB.inhabitPane("w-japan", "opencode", "pane-b", briefB, runB)
    assert.equal(born, true, "sanity: the fleet-tab pane births through the real inhabitPane body")
    // the agent boards LATE: the session lands in the store only now —
    // resolvable by (cwd, since, marker), exactly what the judge's
    // second look exists to resolve
    seedSession(DB, runB, new Date().toISOString(), join(runB, "units", "japan"), "ses-b")

    const row = railB.ledger!.job.panes.find((p) => p.unit === "w-japan")
    assert.ok(row, "sanity: the fleet-tab pane's ledger row exists")
    assert.equal(
      row?.transcript?.session_id,
      undefined,
      "sanity: the late boarder is UNBOOKED (the birth resolve and the +5s probe both missed — the shape the rebook exists for)",
    )

    const rebooked = railB.tryBookSession("japan")
    assert.equal(
      rebooked,
      "ses-b",
      `INV-3: "what the rebook needs to re-resolve a pane's session" is written by THREE pane-birth paths and ` +
        `inhabitPane — the FLEET-TAB birth both other paths delegate to on the production layout — forgot its half. ` +
        `spawnWorker sets kindOf ("spawn-time worker kind per label — tryBookSession needs it to re-resolve a ` +
        `session", rail.ts) and the r26 fix added the same write to resumeWorker (gate-r4 principles-25), but ` +
        `inhabitPane sets cwdOf/briefOf and NEVER kindOf — so tryBookSession's own guard ` +
        `(\`if (!cwd || !kind) return undefined\`) refuses before the session store is consulted: the pane's ` +
        `session ses-b sits resolvable in the very DB the control just resolved from, and the rebook returned ` +
        `${JSON.stringify(rebooked)}. The birth judge inherits it: on the pr-review fleet-tab layout (this run's ` +
        `own orchestrator.log: "layout=new/left … spawned w-principles … in fleet tab pane"), a pane whose agent ` +
        `boards slower than the one-shot +5s probe has sessionOf === undefined, a structurally dead rebook, and ` +
        `at born_ms is ruled "dead at birth" — retire + respawn of a unit whose worker DID board, the exact ` +
        `outcome the judge's r6 doctrine forbids ("boarded — however quiet"; session existence is the only key), ` +
        `repeated to RETRY_CAP. One decision, three writers; the incomplete half is inhabitPane.`,
    )
  } finally {
    rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
    rmSync(join(DB, ".."), { recursive: true, force: true })
    rmSync(runA, { recursive: true, force: true })
    rmSync(runB, { recursive: true, force: true })
  }
})
