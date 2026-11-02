// principles-1002 (P1, INV-3 twin): "is this model pin valid" is the
// door's ONE decision — review.ts refuses anything that is not
// provider/model ("bare ids are refused here, at the door"). The --auto
// mint re-makes the same decision with a weaker rule (any non-empty
// string passes, from --model OR review-gate.toml's model =), mints a
// supervisor, prints "verdict: will land at ... and as a comment on the
// PR", and exits 0 — for a levy its own door refuses on the next line.
// With model = "gpt4" (a bare id) in the ship contract, every parentless
// auto review is born dead: no verdict, PR never hears, exit 0.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const REPO_ROOT = resolve(import.meta.dirname, "..", "..")
const BIN = join(REPO_ROOT, "bin", "whitehartlane")

function fixtureRepo(where: string): string {
  const g = (a: string) => spawnSync("sh", ["-c", `git ${a}`], { cwd: where, encoding: "utf8" })
  mkdirSync(join(where, "src"), { recursive: true })
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("principles-1002: the mint must not accept a model pin its own door refuses (INV-3: one model-grammar decision)", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-p1002-"))
  const repo = fixtureRepo(join(tmp, "repo"))
  const out = join(tmp, "auto-out")
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.WHL_FROM
  delete env.HERDR_ENV
  delete env.HERDR_PANE_ID
  delete env.OPENCODE_SESSION_ID
  delete env.WHL_GATE
  Object.assign(env, {
    AGENTIC_OS_HOME: tmp,
    AGENTIC_OS_NOTIFY: "0",
    WHL_GATE_LEDGER: join(tmp, "gate.jsonl"),
    WHL_JEV_BIN: jevStub(tmp),
    WHL_SUPERVISOR_BIN: supervisorStub(tmp),
  })
  try {
    // 1. the mint with a BARE model id on the CLI (the same string a
    // typo'd review-gate.toml `model = "gpt4"` feeds it).
    // ADOPTED WITH THE FIX: the repro pinned the buggy shape (mint
    // accepts, status 0, then the inner door refuses). The fix moves
    // the refusal to ITS seat — the mint refuses the bare pin itself,
    // refuses to promise a verdict, and never mints a supervisor.
    const outer = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--pr", "42", "--auto", "--model", "gpt4", "--out", out],
      { encoding: "utf8", env, cwd: tmp, timeout: 120_000 },
    )
    assert.notEqual(outer.status, 0, "the mint must refuse a bare model pin (one grammar, the door's)")
    assert.match(outer.stderr, /provider\/model/, "the refusal names the grammar the door enforces")
    assert.doesNotMatch(outer.stdout, /verdict: will land at/, "no verdict is promised for a pin the door refuses")
    assert.doesNotMatch(outer.stdout, /supervisor: pid/, "no supervisor is minted for a dead levy")

    // 2. the supervisor was never commissioned: no brief, no log, no out dir
    let argv = ""
    for (let i = 0; i < 20 && !argv; i++) {
      await sleep(50)
      if (existsSync(join(tmp, "argv.txt"))) argv = readFileSync(join(tmp, "argv.txt"), "utf8")
    }
    assert.equal(argv, "", "the supervisor stub never ran — a bare pin commissions nobody")
    assert.ok(!existsSync(out), "no --out dir was created for a refused levy")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
