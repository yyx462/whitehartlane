// questions-1 (round 2) — INV-2 (every validated field reaches an
// engine): shipConfigOf parses `auto` (review-gate.ts:356-367, "auto =
// true → levy the review after every gwt submit-pr"), the repo's own
// review-gate.toml sets it, and the shipConfigOf test round-trips the
// value — but NO engine reads the VALUE. In-repo grep: zero readers of
// `.auto` (strictness → runGate :424, model → the --auto mint
// bin:495); the one consumer the toml names, `gwt submit-pr`'s auto
// levy tail (~/…/yyx-gwt-axi/lib/cmd_submit_pr.sh:562), gates on FILE
// PRESENCE (`[ -f review-gate.toml ]`), not the field. So a repo that
// writes `auto = false` — or a strictness/model-only toml, or an
// unparsable one, which shipConfigOf maps to auto:false with the
// comment "an unparsable contract is not a reason to skip anything" —
// is levied anyway: gate row, minted supervisor, PR comments the owner
// declined. The parser accepts the field; the field's value vanishes.
// Repro: the REAL choke point — gwt submit-pr in a fixture worktree
// (github-shaped remote, gh stubbed, whl = THIS checkout's bin via a
// PATH wrapper, jev/supervisor stubbed). auto=false must levy nothing.
import assert from "node:assert/strict"
import { execSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const BIN = resolve(import.meta.dirname, "..", "..", "bin", "whitehartlane")
const GWT = (() => {
  try {
    return execSync("command -v gwt", { shell: "/bin/sh", encoding: "utf8" }).trim()
  } catch {
    return ""
  }
})()

// one fixture worktree (dir name == branch, the gwt invariant) + the
// stub village; runs gwt submit-pr; returns every whl invocation
function submitPrWith(toml: string | null): { status: number | null; stdout: string; stderr: string; whlCalls: string } {
  const tmp = mkdtempSync(join(tmpdir(), "aos-q1-auto-"))
  const bare = join(tmp, "origin.git")
  execSync(`git init -q --bare ${JSON.stringify(bare)}`)
  const repo = join(tmp, "proj", "wt-q1")
  execSync(`git clone -q ${JSON.stringify(bare)} ${JSON.stringify(repo)}`, { stdio: ["ignore", "pipe", "pipe"] })
  const g = (a: string) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("config user.email t@t.local")
  g("config user.name t")
  g("checkout -qb main")
  writeFileSync(join(repo, "f.ts"), "export const wait = () => true\n")
  g("add -A && git commit -qm base")
  g("push -q origin main")
  g("checkout -qb wt-q1")
  writeFileSync(join(repo, "f.ts"), "export const wait = () => false\n")
  if (toml !== null) writeFileSync(join(repo, "review-gate.toml"), toml)
  // the remote must LOOK github (REMOTE case *github.com*) while the
  // push stays local: fetch/ls-remote NXDOMAIN-fails fast and degrades
  // silently in gwt; the push url is the local bare
  g(`remote set-url origin https://github.com.foo.invalid/foo/bar.git`)
  g(`remote set-url --push origin ${JSON.stringify(bare)}`)
  // gh stub: pr list → empty, pr create → a PR url
  writeFileSync(
    join(tmp, "gh"),
    `#!/bin/sh\ncase "$1 $2" in\n  "pr list") exit 0 ;;\n  "pr create") echo "https://github.com/foo/bar/pull/4242" ;;\nesac\nexit 0\n`,
  )
  // whl wrapper: THIS checkout's bin, every invocation logged
  writeFileSync(
    join(tmp, "whl"),
    `#!/bin/sh\nprintf 'whl %s\\n' "$*" >> ${JSON.stringify(join(tmp, "whl-calls.txt"))}\nexec node --experimental-strip-types ${JSON.stringify(BIN)} "$@"\n`,
  )
  const answers = JSON.stringify({
    answers: Object.fromEntries(
      ["principles", "tests", "momentum", "questions"].map((l) => [`l_${l}`, { type: "noul", noul: 0.9 }]),
    ),
  })
  writeFileSync(join(tmp, "jev-stub"), `#!/bin/sh\necho '${answers}'\n`)
  writeFileSync(join(tmp, "supervisor-stub"), `#!/bin/sh\necho "supervisor up"\n`)
  for (const f of ["gh", "whl", "jev-stub", "supervisor-stub"]) chmodSync(join(tmp, f), 0o755)
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.WHL_FROM
  delete env.HERDR_ENV
  delete env.HERDR_PANE_ID
  delete env.OPENCODE_SESSION_ID
  delete env.WHL_GATE
  Object.assign(env, {
    PATH: `${tmp}:${process.env.PATH}`,
    GIT_TERMINAL_PROMPT: "0",
    AGENTIC_OS_HOME: join(tmp, "home"),
    AGENTIC_OS_NOTIFY: "0",
    WHL_GATE_LEDGER: join(tmp, "gate.jsonl"),
    WHL_JEV_BIN: join(tmp, "jev-stub"),
    WHL_SUPERVISOR_BIN: join(tmp, "supervisor-stub"),
  })
  const r = spawnSync(GWT, ["submit-pr", "q1 title", "one purpose line", "main"], {
    cwd: repo,
    env,
    encoding: "utf8",
    timeout: 120_000,
  })
  const whlCalls = existsSync(join(tmp, "whl-calls.txt")) ? readFileSync(join(tmp, "whl-calls.txt"), "utf8") : ""
  const out = { status: r.status, stdout: r.stdout, stderr: r.stderr, whlCalls }
  rmSync(tmp, { recursive: true, force: true })
  return out
}

test("questions-1: auto = false must NOT levy the ship gate — the parsed field has to reach an engine (INV-2)", () => {
  assert.ok(GWT, "the repro needs the real gwt (the auto levy's one choke point) on PATH")
  const r = submitPrWith('auto = false\nmodel = "acme/strong"\nstrictness = "strict"\n')
  assert.equal(r.status, 0, `submit-pr itself must succeed (stderr: ${r.stderr})`)
  const levied = r.whlCalls.split("\n").some((l) => l.includes("--auto"))
  assert.ok(
    !levied,
    `INV-2: review-gate.toml says auto = false, shipConfigOf parses it (auto:false), yet the submit-pr tail levied the full auto gate anyway. whl invocations:\n${r.whlCalls}`,
  )
})

test("questions-1 control: toml ABSENT — no levy (the absence contract holds today)", () => {
  assert.ok(GWT, "the repro needs the real gwt on PATH")
  const r = submitPrWith(null)
  assert.equal(r.status, 0, `submit-pr itself must succeed (stderr: ${r.stderr})`)
  assert.ok(
    !r.whlCalls.split("\n").some((l) => l.includes("--auto")),
    "absent toml must not levy — it does not; only the VALUE is dead",
  )
})

test("questions-1 control: auto = true — the levy happens (a fix must keep the true case working)", () => {
  assert.ok(GWT, "the repro needs the real gwt on PATH")
  const r = submitPrWith('auto = true\nmodel = "acme/strong"\nstrictness = "strict"\n')
  assert.equal(r.status, 0, `submit-pr itself must succeed (stderr: ${r.stderr})`)
  assert.ok(
    r.whlCalls.split("\n").some((l) => l.includes("--auto")),
    "auto = true is the documented opt-in — the levy must fire",
  )
})
