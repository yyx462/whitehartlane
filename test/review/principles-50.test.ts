import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import test from "node:test"

// the coworker ledger rides the OS-disk trace — this repro points
// AGENTIC_OS_HOME at its own temp disk so no real session is touched
process.env.AGENTIC_OS_HOME = mkdtempSync(join(tmpdir(), "whl-p50-"))

import { runCoworker } from "../../src/engines/coworker-run.ts"
import { fakeHerdr, fakeLedger, fakeRail } from "../util.ts"

// BASE shape: the "THE ONE SPELLING" law in rail.ts is this diff's own
// addition (gate-r9 tests-300 rewrote rail.bookedSessionOf to the strict
// `w-${name}` form). On BASE there is no such law — nothing to judge
// (the momentum-18 device: guarded on the marker this diff introduced,
// vacuous green where it is absent).
const RAIL_LAW = readFileSync(join(import.meta.dirname, "..", "..", "src", "adapters", "rail.ts"), "utf8").includes(
  "THE ONE SPELLING",
)

function coworkerDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  writeFileSync(
    join(dir, "workflow.toml"),
    [
      'kind = "coworker"',
      "",
      "[workflow]",
      'name = "p50-coworker"',
      'worker_kind = "opencode"',
      "",
      "[hooks]",
      'grade = "echo pass"',
      'counts = "printf \'{}\'"',
      "",
      "[members.api]",
      "initiates = true",
      "",
      "[members.api-v2]",
      "",
    ].join("\n"),
  )
  mkdirSync(join(dir, "members"), { recursive: true })
  writeFileSync(join(dir, "members", "api.md"), "Find the capital and tell api-v2.\n")
  writeFileSync(join(dir, "members", "api-v2.md"), "Wait for api, then wrap up.\n")
  return dir
}

// INV-3 (one decision, one place) — "how is a pane's ledger row matched
// to a unit id?" is answered by TWO sites after this diff, and they
// answer OPPOSITELY on the same rows:
//   rail.bookedSessionOf (src/adapters/rail.ts:1204) — THE ONE SPELLING,
//     strict `p.unit === \`w-${name}\``; its own comment declares the old
//     dual spelling "pure collision surface: a unit literally named
//     w-api made lookup("api") answer w-api's panes … the momentum-18
//     class surviving one spelling later";
//   coworker-run's local bookedSessionOf (src/engines/coworker-run.ts:97)
//     — the SAME decision for coworker members, still the old dual
//     spelling `p.unit === name || p.unit?.startsWith(`${name}-`)`.
// The collision the diff's own law names is therefore alive in the twin:
// members are validated by the same SHEP_SAFE_ID grammar (coworker.ts
// parseMembers), so one member legally named `api` and another `api-v2`
// is the natural wave/generation naming (the momentum-18 receipt: the
// ledger itself matches generations via startsWith). The twin's
// startsWith arm answers ANOTHER member's session as api's booking
// evidence, and the ADR-5 resume path acts on it: api is born as a
// RESUMED member of api-v2's session — held idle, never briefed — and
// the station's only initiator never speaks (the run #17 shape: a
// member nobody hears sits idle to the deadline).
test("a member's booked-session lookup answers only its own pane's row (the twin matches the one-spelling law)", async () => {
  if (!RAIL_LAW) return // BASE: no one-spelling law — nothing to judge
  const dir = coworkerDir("whl-p50-run-")
  try {
    // premise: both names are legal member ids — the collision is
    // between two ids the door's own validator accepts
    const { SHEP_SAFE_ID } = await import("../../src/doors/hooks.ts")
    assert.ok(
      SHEP_SAFE_ID.test("api") && SHEP_SAFE_ID.test("api-v2"),
      "premise: dash-prefix sibling ids are legal member names (the wave/generation naming pattern)",
    )

    const herdr = fakeHerdr()
    const ledger = fakeLedger()
    // seed: ONLY api-v2 ever boarded — its pane row (unit "api-v2")
    // carries a session. api has NO row of its own (never boarded).
    ledger.job.panes.push({
      label: "api-v2",
      pane: "p-seed",
      unit: "api-v2",
      transcript: { tool: "opencode", cwd: dir, since: "2026-01-01T00:00:00.000Z", session_id: "ses-v2" },
      born: "2026-01-02T00:00:00.000Z",
    })
    const rail = fakeRail(dir, herdr, ledger)
    const births: { name: string; hold: boolean; resumeSession: string | undefined }[] = []
    const orig = rail.inhabitPane.bind(rail)
    rail.inhabitPane = ((...args: Parameters<typeof orig>) => {
      births.push({ name: args[0], hold: args[7], resumeSession: args[8] })
      return orig(...args)
    }) as typeof rail.inhabitPane
    // whichever member is first prompted ends the exchange — the run
    // must always terminate (the probe never rides the deadline)
    herdr.onPrompt = (name, _text, later) => {
      const from = name.startsWith("api-v2") ? "api-v2" : "api"
      const to = from === "api" ? "api-v2" : "api"
      later(() => {
        mkdirSync(join(dir, "messages"), { recursive: true })
        writeFileSync(
          join(dir, "messages", `1-${from}.json`),
          JSON.stringify({ from, to, type: "stop", body: "probe done" }),
        )
      })
    }
    await runCoworker(rail, { stallMs: 300, beatMs: 60, graceMs: 0 })

    const apiBirth = births.find((b) => b.name === "api")
    assert.ok(apiBirth, "sanity: the api member birthed through inhabitPane")
    assert.equal(
      apiBirth.resumeSession,
      undefined,
      `INV-3 ("how is a pane's ledger row matched to a unit id" is decided by TWO sites that disagree): ` +
        `member api NEVER boarded — it has no pane row of its own — yet its birth carried ` +
        `resumeSession ${JSON.stringify(apiBirth.resumeSession)} with hold=${apiBirth.hold}. The twin lookup ` +
        `(coworker-run.ts:97, the local bookedSessionOf) still answers the DUAL spelling ` +
        `\`p.unit === name || p.unit?.startsWith(name + "-")\` that rail.bookedSessionOf's own law ` +
        `(rail.ts "THE ONE SPELLING", this diff) declares "pure collision surface … the momentum-18 class ` +
        `surviving one spelling later": the startsWith arm matched member api-V2's row (unit "api-v2") and ` +
        `returned api-v2's session ses-v2 as api's booking evidence. The ADR-5 resume path acted on it: the ` +
        `station's only INITIATOR was born as a resumed member of another member's session — held idle ` +
        `(hold=true), its brief never delivered, the exchange deadlocked until the 2h deadline. Route the ` +
        `coworker lookup through the one owner (or match the exact spawn spelling), like the fan-out path does.`,
    )
    assert.equal(
      apiBirth.hold,
      false,
      `INV-3, the second half: api is the station's initiator — born fresh (no booking of its own) it must ` +
        `wake on its brief alone. The twin's false booking evidence held it idle instead.`,
    )
  } finally {
    rmSync(join(process.env.AGENTIC_OS_HOME!, "sessions"), { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
