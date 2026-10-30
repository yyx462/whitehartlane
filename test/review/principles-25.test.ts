import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// the ledger rides the OS-disk trace and the fake DB rides OPENCODE_DB —
// pin both before anything reads them (the repo's own repro convention)
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p25-home-"))
const DB = join(mkdtempSync(join(tmpdir(), "whl-p25-db-")), "opencode.db")
process.env.OPENCODE_DB = DB
process.env.PATH = "" // no `opencode`/`git` children: the fakes are the whole world

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
// at birth" (rail.ts) — and feeds it from per-pane spawn state:
// `const cwd = this.cwdOf.get(label); const kind = this.kindOf.get(label);
// if (!cwd || !kind) return undefined`. The kind half of that state is
// written by ONE spawn path only: spawnWorker sets kindOf (rail.ts, "the
// birth judge's second look … needs it to re-resolve a session"); the
// TWIN writer — resumeWorker, the ADR-5 continue path every `whl
// continue` resumed unit spawns through (orchestrator resumeSpawn
// prefers shep.resumeWorker) — sets cwdOf and briefOf but NEVER kindOf.
// So for every RESUMED pane the rebook structurally cannot run: the
// guard returns undefined before the session store is consulted. The
// consequence rides the birth judge: a resumed pane whose agent boarded
// late (or whose resume pointer was unbooked — the shape resumeWorker
// itself logs, "unbooked — briefed takeover") has no booked session_id,
// sessionOf misses it, rebook is disabled by the missing kind — and at
// born_ms the judge rules "dead at birth": retire + respawn of a unit
// whose worker DID board, violating the judge's own r6 doctrine
// ("boarded — however quiet" is spared; session existence is the only
// key). One decision — "the pane's kind, needed to re-resolve its
// session" — two spawn paths, one forgets. Deterministic: two rails, a
// spawned pane and a resumed pane, identical cwd/brief/DB; the spawned
// pane's rebook resolves its session, the resumed pane's cannot. On
// BASE the rebook seam does not exist (green there — nothing to judge).
test("the birth judge's rebook resolves a resumed pane's session too — resumeWorker feeds the same spawn state", () => {
  const runA = mkdtempSync(join(tmpdir(), "whl-p25-a-"))
  const runB = mkdtempSync(join(tmpdir(), "whl-p25-b-"))
  try {
    const railA = railOn(runA)
    // BASE shape: the rebook seam (rail.tryBookSession) is this diff's
    // own addition — on BASE there is no second look at all (green there)
    if (typeof (railA as { tryBookSession?: unknown }).tryBookSession !== "function") return

    // control: the SPAWN path feeds the rebook — kindOf set, session resolvable
    const briefA = join(runA, "units", "france", "brief.md")
    mkdirSync(join(runA, "units", "france"), { recursive: true })
    writeFileSync(briefA, "work here")
    const okSpawn = railA.spawnWorker("w-france", "opencode", briefA, runA)
    assert.equal(okSpawn, true, "sanity: the spawn-path pane spawns")
    seedSession(DB, runA, new Date().toISOString(), join(runA, "units", "france"), "ses-a")
    assert.equal(
      // gate-r9: the rebook speaks the BARE unit id (the birth judge's
      // b.id — the production contract; the w- form was the pre-r9 habit)
      railA.tryBookSession("france"),
      "ses-a",
      "sanity: the rebook resolves the session for a SPAWNED pane (kindOf was set at spawn)",
    )

    // the twin: the RESUME path (ADR-5 continue) — same rail state
    // except the one key resumeWorker forgets
    const railB = railOn(runB)
    const briefB = join(runB, "units", "japan", "continue.md")
    mkdirSync(join(runB, "units", "japan"), { recursive: true })
    writeFileSync(briefB, "continue here")
    // the unbooked resume pointer — resumeWorker's own documented shape
    // ("unbooked — briefed takeover"): no session_id on the pointer, so
    // the attach books no session and the rebook is the ONLY booker
    const okResume = railB.resumeWorker("w-japan", { tool: "opencode", cwd: runB }, briefB, runB)
    assert.equal(okResume, true, "sanity: the resumed pane spawns through the same fake transport")
    seedSession(DB, runB, new Date().toISOString(), join(runB, "units", "japan"), "ses-b")

    const rebooked = railB.tryBookSession("japan") // bare id — the judge's spelling (gate-r9)
    assert.equal(
      rebooked,
      "ses-b",
      `INV-3: "what the rebook needs to re-resolve a pane's session" is written by two spawn paths and ` +
        `resumeWorker forgot its half. spawnWorker sets kindOf ("spawn-time worker kind per label — ` +
        `tryBookSession needs it to re-resolve a session", rail.ts) but resumeWorker — the ADR-5 continue ` +
        `path every \`whl continue\` resumed unit spawns through — sets cwdOf/briefOf and NEVER kindOf, so ` +
        `tryBookSession's own guard (\`if (!cwd || !kind) return undefined\`) refuses before the session store ` +
        `is consulted: the pane's session ses-b sits resolvable in the very DB the control just resolved from, ` +
        `and the rebook returned ${JSON.stringify(rebooked)}. The birth judge inherits it: a resumed pane ` +
        `whose agent boarded late has sessionOf === undefined, a structurally dead rebook, and at born_ms is ` +
        `ruled "dead at birth" — retire + respawn of a unit whose worker DID board, the exact outcome the ` +
        `judge's r6 doctrine forbids ("boarded — however quiet"; session existence is the only key). ` +
        `One decision, two writers; the incomplete half is resumeWorker.`,
    )
  } finally {
    rmSync(process.env.AGENTIC_OS_HOME!, { recursive: true, force: true })
    rmSync(join(DB, ".."), { recursive: true, force: true })
    rmSync(runA, { recursive: true, force: true })
    rmSync(runB, { recursive: true, force: true })
  }
})
