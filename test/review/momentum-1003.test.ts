// momentum-1003 — the watcher's BACKSTOP fires on the happy path: it asks
// "has the supervisor posted YET?" where it means "did the supervisor EVER
// post?".
//
// src/doors/ship-supervisor.ts, the wrapper the door writes:
//
//   `while [ ! -f "$OUT/data/review/merge.json" ]; do … done`
//   …
//   // the BACKSTOP receipt (momentum-908): if the agent never posted
//   // (it died at once), the PR still hears — the watcher is the last
//   // word.
//   `if test -f "$OUT/supervisor-comment.md"; then :; elif [ -n "$PR" ] && command -v gh >/dev/null 2>&1; then`
//   `  … gh pr comment "$PR" --body "ship-gate: ${V:-unfinished} — the supervisor did not post; …"`
//
// The watcher's poll is 1s; the SUPERVISOR AGENT's poll (the brief's step
// 2) is 15s — and the agent only writes ${runDir}/supervisor-comment.md
// AFTER its own wait ends (brief step 5). So the watcher sees the seat
// first (within 1s) and checks for the comment file BEFORE the agent has
// had any chance to write it (up to 15s + its composing time later).
//
// The result on every --auto commission: the watcher posts its backstop
// comment — a receipt that says "the supervisor did not post" (FALSE: the
// supervisor posts, seconds later) — and then the agent posts its own.
// TWO receipts for ONE commission (INV-6: one wake per commission), and
// the first one is a false statement about the commission's state
// (INV-4: signal/end observe — an observed fact that is not one).
//
// The repro drives the real spawnSupervisor with a stub agent that
// behaves like the real one (seat first, then the comment file, then its
// own gh post) and counts the receipts the PR receives.
//
// BASE behaviour: src/doors/ship-supervisor.ts does not exist on BASE →
// the import is absent → this test passes there.
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("one commission, one receipt: the watcher does not publish a second (and false) comment", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "aos-mom1003-"))
  const prevJid = process.env.AGENTIC_OS_JID
  const prevOrch = process.env.AGENTIC_OS_ORCHESTRATOR
  const prevPath = process.env.PATH
  let watcherPid: number | undefined
  try {
    // the seat dir EXISTS here (the watcher's gone-world exit is a
    // separate finding — momentum-1000 — and must not mask this one)
    const out = join(tmp, "auto-reviews", "pr42")
    mkdirSync(join(out, "data", "review"), { recursive: true })

    const calls = join(tmp, "gh-calls.txt")
    const gh = join(tmp, "gh")
    writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(calls)}\nexit 0\n`)
    chmodSync(gh, 0o755)

    // the stub supervisor AGENT, in the real order: the seat lands, then
    // (its 15s poll later) it writes its comment file and posts
    const seat = join(out, "data", "review", "merge.json")
    const comment = join(out, "supervisor-comment.md")
    const bin = join(tmp, "stub-opencode")
    writeFileSync(
      bin,
      [
        "#!/bin/sh",
        "sleep 2",
        `printf '%s\\n' '{"outcome":"accept"}' > ${JSON.stringify(seat)}`,
        "sleep 3",
        `printf '%s\\n' 'ship-gate: accept — the supervisor own receipt' > ${JSON.stringify(comment)}`,
        `gh pr comment 42 --body-file ${JSON.stringify(comment)}`,
        "",
      ].join("\n"),
    )
    chmodSync(bin, 0o755)

    process.env.PATH = `${tmp}:${prevPath ?? ""}`
    delete process.env.AGENTIC_OS_JID
    process.env.AGENTIC_OS_ORCHESTRATOR = join(tmp, "orch-stub.mjs")

    const supervisor = await import("../../src/doors/ship-supervisor.ts").catch(() => null)
    if (!supervisor) return // BASE shape: no supervisor at all
    const s = supervisor.spawnSupervisor({
      brief: "BRIEF",
      cwd: join(tmp, "auto-reviews"),
      logPath: `${out}.supervisor.log`,
      bin,
      outDir: out,
      pr: "42",
      repo: tmp,
    })
    assert.ok(s.ok, `the spawn must succeed (why: ${s.ok ? "" : s.why})`)
    if (!s.ok) return
    watcherPid = s.pid

    // wait for BOTH receipts to have had their chance
    await sleep(9000)
    const posted = existsSync(calls)
      ? readFileSync(calls, "utf8")
          .split("\n")
          .filter((l) => l.includes("pr comment 42"))
      : []
    assert.equal(
      posted.length,
      1,
      `ONE commission must leave ONE receipt on the PR — got ${posted.length}:\n${posted.join("\n")}\n(the watcher's backstop fired because the supervisor had not posted YET: it asks "has the agent posted?" where it means "did the agent ever post?", so it publishes a second — and false — receipt, "the supervisor did not post", seconds before the supervisor posts)`,
    )
    assert.ok(
      !posted.some((l) => l.includes("the supervisor did not post")),
      `the watcher published "the supervisor did not post" — the supervisor DID post (seconds later); a receipt must not state an unobserved fact`,
    )
  } finally {
    if (watcherPid) {
      try {
        process.kill(watcherPid, "SIGTERM")
      } catch {
        /* already gone */
      }
    }
    if (prevJid === undefined) delete process.env.AGENTIC_OS_JID
    else process.env.AGENTIC_OS_JID = prevJid
    if (prevOrch === undefined) delete process.env.AGENTIC_OS_ORCHESTRATOR
    else process.env.AGENTIC_OS_ORCHESTRATOR = prevOrch
    if (prevPath === undefined) delete process.env.PATH
    else process.env.PATH = prevPath
    rmSync(tmp, { recursive: true, force: true })
  }
})
