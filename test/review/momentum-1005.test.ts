// momentum-1005 (momentum lens — the long trace / lifecycle ordering).
//
// THE WATCHER'S BACKSTOP WITNESSES THE WRONG ARTIFACT: the comment
// FILE, not the POST.
//
// src/doors/ship-supervisor.ts:170 (the watcher script):
//
//   if test -f "$OUT/supervisor-comment.md"; then :; elif [ -n "$PR" ] &&
//     command -v gh >/dev/null 2>&1 && ! kill -0 "$AGENT" 2>/dev/null; then
//     ... post the backstop receipt ...
//   fi
//
// The backstop exists to speak FOR an agent that never told the PR —
// the code's own words (ship-supervisor.ts:157): "if the agent never
// posted (it died at once), the PR still hears — the watcher is the
// last word".
//
// But the witness it checks is a FILE the agent writes BEFORE it
// posts. The brief's step 5 (ship-supervisor.ts:36) is "Write
// <runDir>/supervisor-comment.md, THEN post it as ONE comment on PR
// #<n>". So the file's existence proves the agent got as far as the
// write — it proves NOTHING about whether the PR heard.
//
// THE GAP: the post fails (gh's auth expired, a rate limit, a network
// blip) or the agent is killed between the write and the post → the
// file exists → the watcher reads "the agent posted" → it stays SILENT
// and exits 0. The PR is left with no outcome at all, while the
// gate's ledger row still says action=review. The watcher is NOT "the
// last word" here: it says nothing.
//
// The sibling arm of the SAME watcher already learned this lesson
// (momentum-1003, the code's own receipt): "a backstop that asks
// 'posted yet?' spoke over a live agent and left TWO receipts … speak
// only over a DEAD agent that never posted" — the backstop was fixed
// to wait for the agent's death, but its WITNESS was never corrected.
//
// BASE behaviour: the whole supervisor (src/doors/ship-supervisor.ts)
// and the --auto mint are introduced by this diff → on BASE no
// supervisor is ever minted → there is nothing to witness → the
// conditional assertion passes → the prove gate classifies this as
// introduced.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const ROOT = join(import.meta.dirname, "..", "..")
const BIN = join(ROOT, "bin", "whitehartlane")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// the mint spawns a DETACHED watcher — a scratch drive must not leave
// it behind (the leaked-lens receipt)
const killWatchers = (out: string) => {
  const wrapper = `${out}.supervisor.log.watch`
  try {
    const ps = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" })
    for (const line of ps.split("\n")) {
      if (!line.includes(wrapper)) continue
      const pid = Number(line.trim().split(/\s+/)[0])
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGKILL")
        } catch {
          /* already gone */
        }
      }
    }
  } catch {
    /* ps unavailable — the repo's own sweeper has the last word */
  }
}

function fixtureRepo(where: string): string {
  mkdirSync(join(where, "src"), { recursive: true })
  const g = (args: string) => execFileSync("git", args.split(" "), { cwd: where, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  g("init -q -b main .")
  g("config user.email t@t.local")
  g("config user.name t")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => true\n")
  g("add -A")
  g("commit -qm base")
  g("checkout -qb feat")
  writeFileSync(join(where, "src", "wait.ts"), "export const wait = () => false\n")
  g("add -A")
  g("commit -qm feat")
  return where
}

// the jev stub the gate's own tests use: every lens at 0.9 → the
// caller's gate keeps the full roster and decides REVIEW
function jevStub(dir: string): string {
  const answers: Record<string, { type: string; noul: number }> = {}
  for (const l of ["principles", "tests", "momentum", "questions"]) answers[`l_${l}`] = { type: "noul", noul: 0.9 }
  const p = join(dir, "jev-stub.sh")
  writeFileSync(p, `#!/bin/sh\necho '${JSON.stringify({ answers })}'\n`)
  chmodSync(p, 0o755)
  return p
}

test("momentum-1005: the watcher's backstop must speak when the agent's POST never landed — the comment FILE is not a witness for the post", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom1005-"))
  const out = join(tmp, "out")
  try {
    const repo = fixtureRepo(join(tmp, "repo"))
    const home = join(tmp, "home")
    mkdirSync(home, { recursive: true })
    const ghLog = join(tmp, "gh.log")
    const stubs = join(tmp, "stubs")
    mkdirSync(stubs, { recursive: true })

    // gh: the PR's comment channel, recorded
    const gh = join(stubs, "gh")
    writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${ghLog}\n`)
    chmodSync(gh, 0o755)
    // notify: the watcher's DM channel, recorded
    const notify = join(stubs, "notify")
    writeFileSync(notify, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${join(tmp, "notify.log")}\n`)
    chmodSync(notify, 0o755)

    // the supervisor AGENT (WHL_SUPERVISOR_BIN): the seat lands (the
    // merge stage ran), the agent writes its receipt file — and the
    // POST never happens (gh's auth expired / the agent died here).
    const agent = join(tmp, "agent-stub.sh")
    writeFileSync(
      agent,
      [
        "#!/bin/sh",
        `mkdir -p ${join(out, "data", "review")}`,
        `printf '{"outcome":"accept"}' > ${join(out, "data", "review", "merge.json")}`,
        `printf 'ship-gate: accept\\n' > ${join(out, "supervisor-comment.md")}`,
        "# the POST to the PR never happened (gh failed / the agent died)",
        "exit 0",
        "",
      ].join("\n"),
    )
    chmodSync(agent, 0o755)

    // a no-op orchestrator door: a scratch drive must never book a
    // real workflow (the leaked-lens receipt)
    writeFileSync(join(tmp, "orchestrator-stub.mjs"), "process.exit(0)\n")

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AGENTIC_OS_HOME: home,
      AGENTIC_OS_NOTIFY: "0",
      WHL_GATE_LEDGER: join(tmp, "gate.jsonl"),
      WHL_JEV_BIN: jevStub(tmp),
      WHL_SUPERVISOR_BIN: agent,
      AGENTIC_OS_ORCHESTRATOR: join(tmp, "orchestrator-stub.mjs"),
      PATH: `${stubs}:${process.env.PATH ?? ""}`,
    }
    delete env.WHL_FROM
    delete env.HERDR_ENV
    delete env.HERDR_PANE_ID
    delete env.OPENCODE_SESSION_ID
    delete env.WHL_GATE
    delete env.AGENTIC_OS_JID

    // the outer door: the gate decides REVIEW, then the mint runs
    const outer = spawnSync(
      process.execPath,
      ["--experimental-strip-types", BIN, "review", repo, "--auto", "--pr", "42", "--model", "p/m", "--out", out],
      { env, encoding: "utf8", timeout: 120_000 },
    )
    assert.equal(outer.status, 0, `the outer door failed: ${outer.stdout}\n${outer.stderr}`)

    // BASE: no supervisor is ever minted → there is no watcher and
    // nothing to witness → nothing to assert.
    const wrapper = `${out}.supervisor.log.watch`
    if (!existsSync(wrapper)) return

    // the watcher's own command line carries its wrapper path
    const watcherRunning = (): boolean => {
      try {
        const ps = execFileSync("ps", ["-ax", "-o", "command="], { encoding: "utf8" })
        return ps.split("\n").some((l) => l.includes(wrapper))
      } catch {
        return false
      }
    }

    // wait for the watcher's end: the PR hears, or the watcher exits
    for (let i = 0; i < 200; i++) {
      await sleep(100)
      if (existsSync(ghLog) && readFileSync(ghLog, "utf8").trim()) break
      if (i > 15 && !watcherRunning()) break
    }

    const heard = existsSync(ghLog) ? readFileSync(ghLog, "utf8").trim() : ""
    assert.ok(
      heard.length > 0,
      "the PR never heard: the agent wrote ${runDir}/supervisor-comment.md but the POST to the PR never landed, and the watcher's backstop read the FILE as proof of the post — it stayed silent and exited 0 (the gate's ledger row still says action=review)",
    )
  } finally {
    killWatchers(out)
    rmSync(tmp, { recursive: true, force: true })
  }
})
