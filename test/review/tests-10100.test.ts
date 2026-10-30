// tests-10100 — resolveCaller's tier-2 uniqueness bind is decided inside
// a BOUNDED WINDOW: the session list is asked with `-n 5`
// (ship-supervisor.ts:122), and "exactly ONE session in the project"
// is concluded from `matching.length === 1` over THAT SAMPLE
// (:125-132). Uniqueness over a sample is not uniqueness: a project
// with TWO sessions — a whl fan-out sibling mid-turn, the exact
// scenario the module's own comment says tier 2 exists for
// (:90-97, "Two or more candidates, fresh or stale → null") — reads as
// ONE candidate whenever the sibling sits outside the newest-5 window
// (four fresher sessions anywhere else on the machine is all it
// takes). The bind then lands on `opencode:<the visible one>` with via
// = "the project's ONLY session" — a claim that is false, and the
// wrong-owner wake this tier exists to prevent (INV-6; the
// momentum-1/principles-2000 law: a minted owner beats a guessed one,
// always).
//
// The stub here is FAITHFUL to the flag resolveCaller itself passes:
// it honors `-n <k>` the way the real `opencode session list` does.
// Prior rounds' stubs returned the whole list regardless of -n, so the
// window was never exercised.
//
// BASE shape: no ship-supervisor module — vacuous green (the repo's
// convention, cf. test/review/momentum-1-r26.test.ts).
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const MOD_URL = new URL("../../src/doors/ship-supervisor.ts", import.meta.url)
const mod = existsSync(MOD_URL) ? await import(MOD_URL) : undefined

// a stub that emulates `opencode session list --format json -n <k>`:
// newest-first, truncated to the -n bound — the documented meaning of
// the very flag resolveCaller passes
function ocWindowStub(dir: string, name: string, sessions: Array<{ id: string; directory: string; updated: number }>): string {
  const listFile = join(dir, `${name}.json`)
  writeFileSync(listFile, JSON.stringify(sessions))
  const p = join(dir, name)
  writeFileSync(
    p,
    [
      "#!/bin/sh",
      `K=5`,
      `prev=""`,
      `for a in "$@"; do`,
      `  if [ "$prev" = "-n" ]; then K="$a"; fi`,
      `  prev="$a"`,
      `done`,
      `exec node -e 'const K=Number(process.argv[1]);const all=JSON.parse(require("node:fs").readFileSync(process.argv[2],"utf8"));process.stdout.write(JSON.stringify(all.slice(0,K)))' "$K" ${JSON.stringify(listFile)}`,
      "",
    ].join("\n"),
  )
  chmodSync(p, 0o755)
  return p
}

const stubBin = (dir: string, name: string, out: string): string => {
  const p = join(dir, name)
  writeFileSync(p, `#!/bin/sh\ncat <<'EOF'\n${out}\nEOF\n`)
  chmodSync(p, 0o755)
  return p
}

test("the uniqueness bind must count the project's REAL sessions, not the newest-5 sample — a sibling outside the window is still a sibling (INV-6: never a guessed wake owner)", () => {
  if (!mod) return // BASE: no ship-supervisor — nothing to judge
  const { resolveCaller } = mod as typeof import("../../src/doors/ship-supervisor.ts")

  const tmp = mkdtempSync(join(tmpdir(), "aos-t10100-"))
  try {
    const repo = join(tmp, "repo")
    mkdirSync(repo, { recursive: true }) // execFileSync spawns with this cwd — it must exist
    const herdr = stubBin(tmp, "herdr", JSON.stringify({ result: { agent: { agent: "opencode" } } }))
    const now = 1793339266367

    // the machine: four fresher sessions in OTHER projects, then the
    // project's two — the commissioner (ses_a, mid-turn, quiet-looking
    // for 30m) and its fan-out sibling (ses_b, quiet 45m). Newest
    // first, exactly as `session list` orders them.
    const world = [
      { id: "ses_f1", directory: join(tmp, "elsewhere-1"), updated: now - 1 * 60 * 1000 },
      { id: "ses_f2", directory: join(tmp, "elsewhere-2"), updated: now - 2 * 60 * 1000 },
      { id: "ses_f3", directory: join(tmp, "elsewhere-3"), updated: now - 3 * 60 * 1000 },
      { id: "ses_f4", directory: join(tmp, "elsewhere-4"), updated: now - 4 * 60 * 1000 },
      { id: "ses_a", directory: repo, updated: now - 30 * 60 * 1000 },
      { id: "ses_b", directory: repo, updated: now - 45 * 60 * 1000 },
    ]

    const env = (oc: string) => ({ HERDR_ENV: "1", HERDR_PANE_ID: "wK:pSV", WHL_HERDR_BIN: herdr, WHL_OPENCODE_BIN: oc })

    // CONTROL — the whole world visible (the window covers everyone):
    // the uniqueness law works, two project sessions refuse the bind.
    // (stub ignores -n entirely — an unbounded list)
    const unbounded = stubBin(tmp, "oc-full", JSON.stringify(world))
    assert.equal(
      resolveCaller(repo, { env: env(unbounded), now }) as unknown,
      null,
      "control: two project sessions visible → refuse (the law, working)",
    )

    // THE CASE — the window resolveCaller actually asks for (-n 5):
    // ses_b is real, same project, simply ranked 6th machine-wide.
    // The bind must still refuse: the project has two sessions and
    // neither is provably the commissioner. Binding ses_a — and
    // LABELING it "the project's ONLY session" — is the guessed
    // wrong-owner wake.
    const windowed = ocWindowStub(tmp, "oc-window", world)
    const c = resolveCaller(repo, { env: env(windowed), now })
    assert.equal(
      c as unknown,
      null,
      `INV-6 (wrong-owner wake; ship-supervisor.ts:122-137): the project has TWO sessions (ses_a, ses_b) but the -n 5 window hides the sibling, so "matching.length === 1" proved nothing — yet the bind landed on ${JSON.stringify(c)} labeled the project's ONLY session. A minted owner beats a guessed one, always`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
