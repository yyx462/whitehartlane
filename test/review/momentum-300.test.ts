// momentum-300 — the twin arm momentum-200's fix left unpinned (INV-3,
// one site per decision; INV-4, verdicts honest). The f2bcc1f-era fix
// ("the gate's OWN resolution is the one 'which bytes' site") pins the
// head SHA the gate judged — but ONLY on the --auto MINT arm
// (bin/whitehartlane `headPinned = gateHeadSha`). The FALL-THROUGH arm
// — every hand-run `whl review`, and `--auto --from <parent>` (the
// traceable-parent case, the code's own "this process levies below") —
// still hands prepareReview the RAW REF (`head: val("head")`,
// bin/whitehartlane prepareReview args), and prepareReview re-resolves
// it itself (src/doors/review.ts:726 `git rev-parse ${head}^{commit}`)
// — a SECOND site making the "which bytes does the levy judge"
// decision that the gate already made and ledgered (gateFeatures'
// rev-parse, review-gate.ts:117, the row's headSha). The window is the
// same one momentum-200 named — the gate's own jev call (up to 30s)
// runs between the two resolutions — so a branch that moves in it
// makes the door materialize a rail for bytes the gate NEVER judged,
// carrying `roster: gateRoster` drawn for the ledgered sha. Repro
// drives the REAL bin in the plain form with a jev stub that commits
// to the branch before answering, sequenced strictly between the two
// rev-parses by the bin's own call order — deterministic, no race.
// (File named momentum-300: momentum-1..105 and 200 belong to prior
// review rounds and stay untouched.)
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const BIN = resolve(import.meta.dirname, "..", "..", "bin", "whitehartlane")

function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  g("add -A")
  g("commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\nexport const waitFast = () => true\n")
  g("add -A")
  g("commit -qm feat")
  return where
}

// the stateful judge: BEFORE answering it moves the branch the gate is
// judging — exactly what a concurrent push does inside the gate's jev
// window (features read at T0, jev runs at T1, prepareReview re-resolves
// at T2). 0.9 on all four lenses → roster kept, action "review",
// deterministic.
function jevStubThatMovesTheBranch(dir: string, repo: string): string {
  const answers: Record<string, { type: string; noul: number }> = {}
  for (const l of ["principles", "tests", "momentum", "questions"]) answers[`l_${l}`] = { type: "noul", noul: 0.9 }
  const p = join(dir, "jev-drift.sh")
  writeFileSync(
    p,
    `#!/bin/sh\ngit -C ${JSON.stringify(repo)} commit --allow-empty -qm gate-window-drift\necho '${JSON.stringify({ answers })}'\n`,
  )
  chmodSync(p, 0o755)
  return p
}

test("momentum-300: the fall-through arm re-resolves the ref the gate already judged — the staged rail must carry the gate's own headSha (INV-3/INV-4)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-m300-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    // X: the sha the gate's features will read (the branch tip BEFORE the judge runs)
    const judged = execSync("git rev-parse feat^{commit}", { cwd: repo, encoding: "utf8" }).trim()
    const ledger = join(tmp, "gate.jsonl")
    const stage = join(tmp, "stage")
    const env: NodeJS.ProcessEnv = { ...process.env }
    delete env.WHL_FROM
    delete env.HERDR_ENV
    delete env.HERDR_PANE_ID
    delete env.OPENCODE_SESSION_ID
    delete env.WHL_GATE
    Object.assign(env, {
      AGENTIC_OS_HOME: tmp,
      AGENTIC_OS_NOTIFY: "0",
      WHL_GATE_LEDGER: ledger,
      WHL_JEV_BIN: jevStubThatMovesTheBranch(tmp, repo),
    })
    // the fall-through arm: plain `whl review` (no --auto mint) — the
    // arm a hand-run review and a parented `--auto --from` both take.
    // No --from/--unattended: the door materializes the program and
    // prints the receipt, nothing booked — the staged bytes are the
    // levy's contract either way.
    const out = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--base", "main", "--head", "feat", "--model", "acme/strong", "--out", stage],
      { encoding: "utf8", env, cwd: tmp, timeout: 120_000 },
    )
    assert.equal(out.status, 0, `the door run itself must succeed (stderr: ${out.stderr})`)
    assert.ok(existsSync(join(stage, "data", "review", "config.sh")), "the program was materialized (not skipped)")

    // the branch really moved inside the gate→prepare window
    const drifted = execSync("git rev-parse feat^{commit}", { cwd: repo, encoding: "utf8" }).trim()
    assert.notEqual(drifted, judged, "sanity: the jev stub moved the branch the gate was judging")

    // what the gate judged and ledgered: the row MUST name X
    const rows = readFileSync(ledger, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { headSha: string; roster: string[]; action: string })
    assert.ok(rows.length > 0, "the gate wrote its ledger row")
    const row = rows[rows.length - 1]
    assert.equal(row.headSha, judged, "the gate's ledger row names the pre-drift sha it actually judged")
    assert.equal(row.action, "review", "the gate decided review (roster drawn for the judged sha)")
    assert.ok(row.roster.length > 0, "a roster was pinned for the judged sha")

    // what the staged levy will judge: the door's own re-resolve
    const cfg = readFileSync(join(stage, "data", "review", "config.sh"), "utf8")
    const staged = cfg.match(/^HEAD_SHA='([^']*)'/m)?.[1] ?? ""
    assert.match(staged, /^[0-9a-f]{40}$/, "the staged config carries a HEAD_SHA")

    // THE invariant (momentum-200's own law, the twin arm): the bytes
    // the rail judges must be the bytes the gate judged and ledgered —
    // prepareReview's rev-parse is a second "which bytes" site that
    // here disagrees with the first, while `roster: gateRoster` (drawn
    // for X) rides the materialization.
    assert.equal(
      staged,
      row.headSha,
      `INV-3/INV-4: the gate judged and ledgered ${row.headSha.slice(0, 12)} (and drew its roster for it), but the fall-through arm re-resolved the moving ref and staged HEAD_SHA ${staged.slice(0, 12)} — prepareReview's own rev-parse (src/doors/review.ts:726) is a second "which bytes" site the momentum-200 fix never pinned; the fix must hand gateHeadSha down here too, not only to the --auto mint`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
