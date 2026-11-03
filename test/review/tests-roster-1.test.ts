// tests-roster-1 — the roster CEILING (this diff's lens universe) is NOT
// enforced on the dropout-AUDIT arm: the gate decides "these three
// lenses", the rail materializes four.
//
// WHAT THE DIFF CLAIMS (src/doors/review-gate.ts:497, the audit arm):
//   return audit
//     ? { action: "skip", roster: [...universe], ...capped, ps, …, audit: true }
//     : { action: "skip", roster: [], … }
//   review-gate.toml's own header (the file this diff edits):
//   "jev still trims WITHIN it (the band rides unchanged); the fail-safe
//    (jev down) and the strict hot-file rule fill TO this ceiling, never
//    past it."
//   The diff's own test says: "a skip's dropout audit escalates to the
//    CEILING (fresh class: every skip audited)".
//
// THE CONSUMER (bin/whitehartlane:433):
//   if (g.decision.action === "review" && g.decision.roster.length > 0)
//     gateRoster = g.decision.roster
// The audit arm's decision carries action:"skip" (the JUDGMENT is skip;
// the audit is the escalation), so the bin hands the door NO roster —
// and the door's strip only runs when args.roster is set
// (src/doors/review.ts:948), so the template is materialized WHOLE. The
// mint's fallback says the same thing (bin/whitehartlane:555:
//   const rosterCsv = (gateRoster ?? [...LENSES]).join(",")).
//
// THE INVARIANT (one law, two artifacts): the lenses that RUN must be
// exactly the lenses the gate's ledgered decision NAMED. On BASE the
// audit arm's decision named all four and all four ran — the record and
// the rail agreed. This diff names the CEILING in the decision (three)
// and the rail runs four: the ledger row claims the audit ran the three.
//
// THE REPRO drives the REAL door (bin/whitehartlane review) in a fixture
// repo whose BASE declares the ceiling, with jev stubbed to "no lens is
// needed" (the skip judgment) on a fresh class (empty ledger → rate
// 1.0 → every skip audits). The artifacts are the gate's own two
// records: the ledger row (what was decided) and the door's handoff
// <out>/data/review/lenses.txt ("which lens units did this program
// materialize?", src/doors/review.ts:1292).
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const ROOT = resolve(import.meta.dirname, "..", "..")
const BIN = join(ROOT, "bin", "whitehartlane")

// a fixture repo whose BASE (main) declares the lens ceiling
function fixtureRepo(where: string, baseToml: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "zz-ceiling-fixture.ts"), "export const wait = () => true\n")
  writeFileSync(join(where, "review-gate.toml"), baseToml)
  g("add -A && git commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "zz-ceiling-fixture.ts"), "export const wait = () => false\nexport const waitFast = () => true\n")
  g("add -A && git commit -qm feat")
  return where
}

// jev stub: one noul per lens, all the same value
function jevStub(dir: string, noul: number): string {
  const answers: Record<string, { type: string; noul: number }> = {}
  for (const l of ["principles", "tests", "momentum", "questions"]) answers[`l_${l}`] = { type: "noul", noul }
  const p = join(dir, "jev-stub.sh")
  writeFileSync(p, `#!/bin/sh\necho '${JSON.stringify({ answers })}'\n`)
  chmodSync(p, 0o755)
  return p
}

// the REAL bin, in a sandbox: isolated OS disk, isolated gate ledger,
// stubbed jev, and a stub orchestrator door (a scratch drive must never
// book a real workflow — the leaked-lens receipt)
function drive(repo: string, out: string, home: string, noul: number) {
  mkdirSync(home, { recursive: true })
  const stub = join(home, "engine-stub.mjs")
  writeFileSync(stub, "import { writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nwriteFileSync(join(process.argv[2] ?? '.', 'engine-started'), 'ok\\n')\n")
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.WHL_GATE
  delete env.WHL_FROM
  Object.assign(env, {
    AGENTIC_OS_HOME: home,
    AGENTIC_OS_NOTIFY: "0",
    WHL_GATE_LEDGER: join(home, "gate.jsonl"),
    WHL_JEV_BIN: jevStub(home, noul),
    AGENTIC_OS_ORCHESTRATOR: stub,
  })
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", BIN, "review", repo, "--base", "main", "--head", "feat", "--out", out, "--model", "acme/strong"],
    { encoding: "utf8", env, cwd: home, timeout: 120_000 },
  )
}

// the gate's own two records, read back from the sandbox
function records(home: string, out: string) {
  const row = JSON.parse(readFileSync(join(home, "gate.jsonl"), "utf8").trim().split("\n").filter(Boolean).at(-1)!)
  const lenses = readFileSync(join(out, "data", "review", "lenses.txt"), "utf8").trim().split("\n").filter(Boolean)
  return { row, lenses }
}

const CEILING = 'roster = ["principles", "tests", "questions"]\n'

test("tests-roster-1: the dropout-audit escalation must run exactly the lenses the gate decided (the ceiling is the universe the gate EVER runs)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-roster1-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"), CEILING)
    const home = join(tmp, "home")
    const out = join(tmp, "out") // the door's replace-guard: it must NOT exist beforehand
    // jev says "no lens is needed" (0.01 < medium's 0.35 bar) → the
    // judgment is SKIP; a fresh class (empty ledger → rate 1.0) audits
    // every skip, so the arm under test is the AUDIT escalation
    const r = drive(repo, out, home, 0.01)
    assert.ok(
      existsSync(join(out, "data", "review", "lenses.txt")),
      `the door must materialize a program for the audited skip (status ${String(r.status)})\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
    )
    const { row, lenses } = records(home, out)
    const decided: string[] = Array.isArray(row.roster) ? row.roster : []
    // 1. the record and the rail must agree — the lenses that ran are
    //    exactly the lenses the ledgered decision named
    assert.deepEqual(
      [...lenses].sort(),
      [...decided].sort(),
      `the gate decided roster ${JSON.stringify(decided)} (action=${String(row.action)}, audit=${String(row.audit)}) but the rail materialized ${JSON.stringify(lenses)} — the ledgered decision and the run disagree`,
    )
    // 2. and when the ceiling is in force, nothing outside it may run
    //    (on BASE the row carries no universe — the feature is absent, so
    //    this clause is vacuous there)
    if (Array.isArray(row.universe)) {
      const outside = lenses.filter((l) => !(row.universe as string[]).includes(l))
      assert.deepEqual(
        outside,
        [],
        `the project's BASE review-gate.toml declares roster = ${JSON.stringify(row.universe)} — the ceiling drops momentum. The audit escalation ran ${JSON.stringify(lenses)}: ${JSON.stringify(outside)} ran outside the declared ceiling.`,
      )
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("tests-roster-1b: the MINTED levy (the --auto ship arm) must carry the decision's roster, not the whole template", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-roster1b-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"), CEILING)
    const home = join(tmp, "home")
    const out = join(tmp, "out")
    mkdirSync(out, { recursive: true }) // the supervisor watcher waits on this dir; it must exist
    // the supervisor is STUBBED (a scratch drive never books a real
    // workflow) — but the MINT is the real code path, and the levy
    // command rides in the brief the mint writes
    const sup = join(home, "supervisor-stub.sh")
    mkdirSync(home, { recursive: true })
    writeFileSync(sup, "#!/bin/sh\necho supervisor up\n")
    chmodSync(sup, 0o755)
    const env: NodeJS.ProcessEnv = { ...process.env }
    delete env.WHL_GATE
    delete env.WHL_FROM
    delete env.OPENCODE_SESSION_ID
    delete env.HERDR_ENV
    delete env.HERDR_PANE_ID
    Object.assign(env, {
      AGENTIC_OS_HOME: home,
      AGENTIC_OS_NOTIFY: "0",
      WHL_GATE_LEDGER: join(home, "gate.jsonl"),
      WHL_JEV_BIN: jevStub(home, 0.01),
      WHL_SUPERVISOR_BIN: sup,
      AGENTIC_OS_ORCHESTRATOR: join(home, "engine-stub.mjs"),
    })
    writeFileSync(env.AGENTIC_OS_ORCHESTRATOR as string, "import { writeFileSync } from 'node:fs'\nwriteFileSync('engine-started', 'ok\\n')\n")
    const r = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--pr", "42", "--auto", "--model", "acme/strong", "--out", out],
      { encoding: "utf8", env, cwd: home, timeout: 120_000 },
    )
    const brief = `${out}.supervisor.log.brief`
    assert.ok(
      existsSync(brief),
      `the mint must write the supervisor brief (status ${String(r.status)})\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
    )
    const levy = readFileSync(brief, "utf8")
    const csv = levy.match(/--roster '([^']*)'/)?.[1] ?? ""
    const row = JSON.parse(readFileSync(join(home, "gate.jsonl"), "utf8").trim().split("\n").filter(Boolean).at(-1)!)
    const decided: string[] = Array.isArray(row.roster) ? row.roster : []
    assert.deepEqual(
      csv.split(",").filter(Boolean).sort(),
      [...decided].sort(),
      `the minted levy carries --roster '${csv}' but the gate decided roster ${JSON.stringify(decided)} (action=${String(row.action)}, audit=${String(row.audit)}) — the levy and the ledgered decision disagree`,
    )
    if (Array.isArray(row.universe)) {
      const outside = csv.split(",").filter(Boolean).filter((l) => !(row.universe as string[]).includes(l))
      assert.deepEqual(outside, [], `the minted levy runs ${JSON.stringify(outside)} — outside the declared ceiling ${JSON.stringify(row.universe)}`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("tests-roster-1 control: the SAME law on the plain review arm — the decision and the rail agree there", () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-roster1c-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"), CEILING)
    const home = join(tmp, "home")
    const out = join(tmp, "out")
    // jev says every lens is needed → the judgment is REVIEW → the bin
    // hands the door the decision's roster → the door strips the rest
    const r = drive(repo, out, home, 0.9)
    assert.ok(
      existsSync(join(out, "data", "review", "lenses.txt")),
      `the door must materialize a program (status ${String(r.status)})\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
    )
    const { row, lenses } = records(home, out)
    const decided: string[] = Array.isArray(row.roster) ? row.roster : []
    assert.deepEqual([...lenses].sort(), [...decided].sort(), "the review arm agrees with its own ledgered decision")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
