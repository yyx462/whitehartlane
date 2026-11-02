import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtemp } from "node:fs/promises"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { Rail } from "../../src/adapters/rail.ts"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// r25's same-day causes (the override round, 2026-11-02). Three laws,
// three pins: the label seat routes EVERY post-birth resolution, the
// P0 guard fails loudly on unreadable input, the reflection ask names
// its round. (The inert-cliff cause is pinned separately at
// test/review/deadline-manifest.test.ts — one pin per cause.)

function fixtureRepo(where: string): string {
  const g = (...args: string[]) => execFileSync("git", ["-C", where, ...args], { encoding: "utf8" })
  mkdirSync(join(where, "src"), { recursive: true })
  g("init", "-q", "-b", "main")
  g("config", "user.email", "t@t.local")
  g("config", "user.name", "t")
  writeFileSync(join(where, "src", "f.ts"), "export const v = 0\n")
  g("add", "-A")
  g("commit", "-qm", "base")
  g("checkout", "-qb", "feat")
  writeFileSync(join(where, "src", "f.ts"), "export const v = 1\n")
  g("add", "-A")
  g("commit", "-qm", "feat")
  return where
}

// THE ONE LABEL SEAT (momentum-3 / principles-19 / tests-11003, r25):
// the fault lane resolves unit ids AFTER births — a raw derivation of
// the bare spelling mints a label herdr never had (unit "u1" born as
// w-u1-runId; scopedFn("u1") said u1-runId). Every post-birth
// resolution must route through the birth maps.
test("r25 label seat: workerStatus and promptAgent resolve through the BIRTH label, never a fresh derivation of the spelling", async () => {
  const taskDir = await mkdtemp(join(tmpdir(), "whl-r25-label-"))
  try {
    const seen: string[] = []
    const host = {
      status: (label: string) => {
        seen.push(`status:${label}`)
        return "idle"
      },
      prompt: (label: string, _text: string) => {
        seen.push(`prompt:${label}`)
        return { status: 0, stdout: "" }
      },
    }
    const rail = new Rail({ argvDir: taskDir, ledger: null, log: () => {}, host: host as never })
    // seed the birth exactly as the birth seat does: rawName w-u1,
    // born label w-u1-r25 (alias "u1" remembers the same label)
    ;(rail as unknown as { rememberLabel: (raw: string, label: string) => void }).rememberLabel("w-u1", "w-u1-r25")
    rail.workerStatus("u1")
    rail.promptAgent("u1", "continue")
    assert.deepEqual(seen, ["status:w-u1-r25", "prompt:w-u1-r25"], "both host calls must address the BORN label — a bare spelling must reach the same registered pane")
    assert.ok(!seen.some((s) => /(^|:)u1-/.test(s) && !s.includes("w-u1-r25")), "no call may mint a fresh derivation of the bare spelling")
  } finally {
    rmSync(taskDir, { recursive: true, force: true })
  }
})

function gate(dir: string, repo: string, extraConfig: string[]): { code: number | null; stderr: string } {
  mkdirSync(join(dir, "hooks"), { recursive: true })
  mkdirSync(join(dir, "data", "review"), { recursive: true })
  writeFileSync(join(dir, "hooks", "merge.sh"), readFileSync(join(ROOT, "templates", "pr-review", "hooks", "merge.sh"), "utf8"))
  const base = execFileSync("git", ["-C", repo, "rev-parse", "main"], { encoding: "utf8" }).trim()
  const head = execFileSync("git", ["-C", repo, "rev-parse", "feat"], { encoding: "utf8" }).trim()
  writeFileSync(
    join(dir, "data", "review", "config.sh"),
    [
      `REPO='${repo}'`,
      `BASE_BRANCH='main'`,
      `BASE_SHA='${base}'`,
      `HEAD_BRANCH='feat'`,
      `HEAD_SHA='${head}'`,
      `TITLE='t'`,
      `MERGE_CMD='true'`,
      ...extraConfig,
      "",
    ].join("\n"),
  )
  writeFileSync(join(dir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "accept", blocked: [] }))
  const r = spawnSync("bash", [join(dir, "hooks", "merge.sh")], { cwd: dir, encoding: "utf8", timeout: 60_000 })
  return { code: r.status, stderr: r.stderr }
}

// THE GUARD'S OWN INPUT LAW (principles-48, r25): a guard that cannot
// read its input must fail LOUDLY — an unparsable stop history used to
// compute an EMPTY pair list, indistinguishable from "no history yet",
// and the accept merged without ever asking the question.
test("r25 loud guard: an unparsable stop history refuses the merge — a broken receipt never reads as an answered question", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "whl-r25-guard-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const broken = gate(join(tmp, "broken"), repo, [`STOP_HISTORY='not json at all'`])
    assert.notEqual(broken.code, 0, "an accept carrying an unreadable stop history must refuse")
    assert.match(broken.stderr, /will not run blind/, `the refusal names the blind guard — got: ${broken.stderr}`)
    // control: a readable history with no P0 flags merges cleanly
    const ok = gate(join(tmp, "ok"), repo, [`STOP_HISTORY='[{"buckets":["src/f.ts:0"],"p0":false}]'`])
    assert.equal(ok.code, 0, `a readable history with no P0 flags must merge — got: ${ok.stderr}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// THE REFLECTION ASK NAMES ITS ROUND (principles-21 / tests-11004,
// r25): the message printed a literal escaped \\$(node …) instead of
// the round number it claimed to name.
test("r25 reflection echo: the ask names the round NUMBER, never the command that would compute it", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "whl-r25-echo-"))
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const dir = join(tmp, "gate")
    const r = gate(dir, repo, [])
    // reject + a stop.json on the cadence beat (round 5, not eligible)
    writeFileSync(join(dir, "data", "review", "verdict.json"), JSON.stringify({ verdict: "reject", blocked: [{ id: "x-1", severity: "P1", claim: "c" }] }))
    writeFileSync(join(dir, "data", "review", "stop.json"), JSON.stringify({ rounds: 5, eligible: false, novel: 2, stuck: [], at: "t" }))
    const again = spawnSync("bash", [join(dir, "hooks", "merge.sh")], { cwd: dir, encoding: "utf8", timeout: 60_000 })
    assert.match(again.stderr, /THE REFLECTION ASK/)
    assert.match(again.stderr, /round 5\b/, `the ask names its round — got: ${again.stderr}`)
    assert.ok(!again.stderr.includes("$(node"), "no literal command substitution may ride the message")
    assert.equal(r.code, 0)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
