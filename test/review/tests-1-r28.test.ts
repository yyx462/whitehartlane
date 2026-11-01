// tests-1 — the head-drift guard this diff adds to merge.sh is INERT in
// the flagship --auto flow, so the accept merge can land bytes no verdict
// judged.
//
// What the diff adds (templates/pr-review/hooks/merge.sh:16-34):
//   "THE HEAD-DRIFT GUARD (momentum-902, the base twin): the MERGE_CMD arm
//    merges the PR's CURRENT head — a push during the review would land
//    bytes no verdict judged. The local arm merges HEAD_SHA by
//    construction; this arm must prove the branch still points at the
//    judged sha before it hands the merge over. The local ref is the proof
//    we always have; the PR's remote head is the stronger one when gh
//    answers."
//
// Two seats that guard actually read:
//   1. the LOCAL ref: `git -C "$REPO" rev-parse "$HEAD_BRANCH"` — it can
//      only fire when HEAD_BRANCH is a REF THAT MOVES. The --auto flow
//      never gives it one: the mint pins the gate's own sha
//      (bin/whitehartlane: "let headPinned = headRef; if (gateHeadSha)
//      headPinned = gateHeadSha") and hands the levy "--head <sha>", so
//      prepareReview writes HEAD_BRANCH=<the judged sha>
//      (src/doors/review.ts: `HEAD_BRANCH=${shellQuote(head)}` with
//      head = args.head). `git rev-parse <sha>` returns that same sha —
//      the check compares the sha with itself and can never fire.
//   2. the REMOTE head: `gh pr view "$PR_NUM"` — PR_NUM is written by
//      NOTHING. The door's config.sh (src/doors/review.ts: the `lines`
//      array) carries REPO/BASE_*/HEAD_*/TITLE/AUTHOR/MERGE_CMD and no
//      PR_NUM; nothing else in the repo writes it (grep PR_NUM: only
//      merge.sh). So `[ -n "${PR_NUM:-}" ]` is always false and gh is
//      never asked.
//
// The consequence: in the --auto flow — the flow this whole PR is about —
// `gh pr merge <pr>` merges the PR's CURRENT remote head with no
// observation at all. A push during the (long) review rides the accept.
//
// The repro drives the REAL mint (parentless --auto, stubbed jev and
// supervisor), takes the levy VERBATIM out of the brief, runs it (the
// orchestrator seam stubbed — a scratch drive never books a real
// workflow), and then runs the REAL merge hook at the program the mint
// produced, with a gh stub that behaves like `gh pr merge` (it lands the
// branch's CURRENT tip). The invariant: the accept must land exactly the
// judged bytes — either the merge is refused, or it lands HEAD_SHA.
//
// BASE behaviour: no head-drift guard and no --auto default merge command
// (the local arm merges HEAD_SHA by construction) — so on BASE this test
// passes.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const REPO_ROOT = resolve(import.meta.dirname, "..", "..")
const BIN = join(REPO_ROOT, "bin", "whitehartlane")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (a: string) => execSync(`git ${a}`, { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  g("add -A && git commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\n")
  g("add -A && git commit -qm feat")
  return where
}

// jev says every lens is needed → the outer gate decides review → the
// --auto block mints the supervisor
function jevStub(dir: string): string {
  const answers: Record<string, { type: string; noul: number }> = {}
  for (const l of ["principles", "tests", "momentum", "questions"]) answers[`l_${l}`] = { type: "noul", noul: 0.9 }
  const p = join(dir, "jev-stub.sh")
  writeFileSync(p, `#!/bin/sh\necho '${JSON.stringify({ answers })}'\n`)
  chmodSync(p, 0o755)
  return p
}

function supervisorStub(dir: string): string {
  const p = join(dir, "supervisor-stub.sh")
  writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' "$@" > ${join(dir, "argv.txt")}\necho "supervisor up"\n`)
  chmodSync(p, 0o755)
  return p
}

test("tests-1: the accept merge must land exactly the judged bytes in the --auto flow", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-tests1-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  const out = join(tmp, "auto-out")
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.WHL_FROM
  delete env.HERDR_ENV
  delete env.HERDR_PANE_ID
  delete env.OPENCODE_SESSION_ID
  delete env.WHL_GATE
  delete env.AGENTIC_OS_ORCHESTRATOR
  Object.assign(env, {
    AGENTIC_OS_HOME: tmp,
    AGENTIC_OS_NOTIFY: "0",
    WHL_GATE_LEDGER: join(tmp, "gate.jsonl"),
    WHL_JEV_BIN: jevStub(tmp),
    WHL_SUPERVISOR_BIN: supervisorStub(tmp),
  })
  try {
    // ── 1. the real mint: parentless --auto ──────────────────────────
    const outer = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--pr", "42", "--auto", "--model", "acme/strong", "--out", out],
      { encoding: "utf8", env, cwd: tmp, timeout: 120_000 },
    )
    assert.equal(outer.status, 0, `the mint itself must succeed (stderr: ${outer.stderr})`)
    assert.match(outer.stdout, /verdict: will land at/, "the mint promises a verdict")

    // ── 2. the commission: the levy, VERBATIM out of the brief ───────
    let argv = ""
    for (let i = 0; i < 100 && !argv; i++) {
      await sleep(50)
      if (existsSync(join(tmp, "argv.txt"))) argv = readFileSync(join(tmp, "argv.txt"), "utf8")
    }
    const m = argv.match(/^\s*\S+\s+review\s.+$/m)
    assert.ok(m, `the brief carries the levy verbatim (argv: ${argv.slice(0, 300)})`)
    const nodeWhl = `${JSON.stringify(process.execPath)} --experimental-strip-types ${JSON.stringify(BIN)}`
    const levyCmd = m[0].replace(/^(\s*)whl /, `$1${nodeWhl} `).trim()

    // ── 3. run the levy as the supervisor would (the orchestrator seam
    //       stubbed — a scratch drive must never book a real workflow) ─
    const orch = join(tmp, "orch-door.mjs")
    writeFileSync(
      orch,
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(tmp, "orchestrator-ran.txt"))}, process.argv.slice(2).join(' ') + '\\n')\n`,
    )
    const inner = spawnSync("sh", ["-c", levyCmd], {
      encoding: "utf8",
      env: { ...env, AGENTIC_OS_ORCHESTRATOR: orch },
      cwd: tmp,
      timeout: 120_000,
    })
    assert.equal(inner.status, 0, `the minted levy must run (stderr: ${inner.stderr})`)
    assert.ok(existsSync(join(out, "workflow.toml")), "the levy materialized its program in the out dir")

    // ── 4. the config the mint's own program carries ─────────────────
    // EVIDENCE (not assertions — a fix may change the shape): the
    // --auto flow pins the head SHA, so the guard's LOCAL seat has no
    // moving ref to observe, and PR_NUM (the gh seat) is written by
    // nothing in the repo.
    const config = readFileSync(join(out, "data", "review", "config.sh"), "utf8")
    const judgedSha = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim()
    const headBranch = config.match(/^HEAD_BRANCH='(.*)'$/m)?.[1] ?? ""
    const prNum = config.match(/^PR_NUM='?(.*?)'?$/m)?.[1] ?? ""
    const evidence = `HEAD_BRANCH=${headBranch} (the judged sha is ${judgedSha}); PR_NUM=${prNum || "(unset)"}`

    // ── 5. a push lands WHILE the review runs ────────────────────────
    writeFileSync(join(repo, "src", "wait.ts"), "export const wait = () => false\nexport const pushed = () => true\n")
    execSync("git add -A && git commit -qm pushed-during-review", { cwd: repo, encoding: "utf8" })
    const pushedSha = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf8" }).trim()
    assert.notEqual(pushedSha, judgedSha, "the push moved the head")

    // ── 6. the accept arm, at the REAL hook, with a gh stub that
    //       behaves like `gh pr merge` (it lands the CURRENT tip) ────
    const seat = join(out, "data", "review", "verdict.json")
    if (existsSync(seat)) rmSync(seat, { force: true })
    writeFileSync(seat, JSON.stringify({ verdict: "accept", head: judgedSha, blocked: [] }))
    const bin = join(tmp, "bin")
    mkdirSync(bin, { recursive: true })
    const landed = join(tmp, "landed.txt")
    const ghStub = join(bin, "gh")
    writeFileSync(
      ghStub,
      `#!/bin/sh
# the PR's remote head is the pushed sha (the branch moved during the review)
if [ "$1 $2" = "pr view" ]; then echo ${JSON.stringify(pushedSha)}; fi
# \`gh pr merge\` lands the PR's CURRENT remote head
if [ "$1 $2" = "pr merge" ]; then echo ${JSON.stringify(pushedSha)} > ${JSON.stringify(landed)}; fi
exit 0
`,
    )
    chmodSync(ghStub, 0o755)

    const seatDir = join(tmp, "not-a-work-tree")
    mkdirSync(seatDir, { recursive: true })
    const r = spawnSync("bash", [join(out, "hooks", "merge.sh")], {
      cwd: seatDir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    })
    const landedSha = existsSync(landed) ? readFileSync(landed, "utf8").trim() : null
    if (landedSha !== null) {
      assert.equal(
        landedSha,
        judgedSha,
        `the accept must land exactly the judged bytes (${judgedSha.slice(0, 12)}) or refuse; it landed ${landedSha.slice(
          0,
          12,
        )} — unreviewed bytes rode the accept.\nevidence: ${evidence}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      )
    } else {
      // nothing landed: the merge must have REFUSED, and said why
      assert.match(
        r.stderr,
        /moved|unreviewed bytes|re-run the review/,
        `the accept landed nothing without refusing — the drift guard neither refused nor merged (evidence: ${evidence})\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      )
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
