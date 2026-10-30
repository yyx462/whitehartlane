// principles-4004 — the supervisor's wait must resolve when the commission
// is OVER, not when the verdict file appears.
//
// The change adds the seat + the supervisor: the door promises the verdict
// at the staged dir, the supervisor's bounded wait polls that path, and
// when it resolves the supervisor posts the outcome to the PR and dies.
//
// But the verdict file is written by the `prove` stage — the rail's chain
// is intake → lenses → prove → divide → merge (templates/pr-review/
// workflow.toml), so TWO stages still have to run after the seat resolves:
//   - `divide` writes the feedback/ shelf the brief tells the supervisor
//     to quote ("the feedback pointers from the job run dir's
//     feedback/MAP.md when it exists") — at prove time it does NOT exist,
//   - `merge` is the stage that actually merges (or refuses).
//
// So the supervisor's "the review is over" observation is premature: the
// PR comment is composed before the feedback map exists, the outcome is
// announced before the merge ran, and the watcher (the "last word" on
// silence) exits while the divide/merge workers are still working — so a
// chain that dies after prove leaves a PR that says "accept" and no merge,
// with nobody left to say so.
//
// The repro: derive the path the supervisor actually waits on (from the
// watcher script and the brief the door generates), find the chain stage
// that writes it, and require that stage to be the LAST one.
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const TEMPLATES = join(import.meta.dirname, "..", "..", "templates")
const PR_REVIEW = join(TEMPLATES, "pr-review")

// the chain's stages, in order, with their hook scripts
function chainStages(): { id: string; hook: string }[] {
  const toml = readFileSync(join(PR_REVIEW, "workflow.toml"), "utf8")
  const blocks = toml.split(/\[\[stage\]\]/).slice(1)
  return blocks.map((b) => {
    const id = /id\s*=\s*"([^"]+)"/.exec(b)?.[1] ?? "?"
    const run = /run\s*=\s*"([^"]+)"/.exec(b)?.[1] ?? ""
    return { id, hook: run.replace(/^bash\s+/, "") }
  })
}

// does this hook script WRITE that file (the seat)? a write, not a read.
function writesSeat(hookText: string, rel: string): boolean {
  const base = rel.split("/").pop() ?? rel
  if (!hookText.includes(base)) return false
  return /writeFileSync|appendFileSync|createWriteStream|>>\s*`?[^`\n]*\$\{?prog/.test(hookText)
}

test("the supervisor's wait resolves only when the commission is over", async () => {
  // the seat is NEW in this change: on a BASE without it the wait has no
  // owner at all — the import is dynamic so the missing seat FAILS the
  // test instead of breaking the load.
  const mod = (await import("../../src/doors/ship-supervisor.ts").catch(() => null)) as
    | typeof import("../../src/doors/ship-supervisor.ts")
    | null
  assert.ok(mod, "the supervisor seat must exist — the wait must have an owner")
  const { spawnSupervisor } = mod
  const tmp = mkdtempSync(join(tmpdir(), "aos-seat-order-"))
  try {
    // the real door's own artifacts: the watcher script and the brief
    const bin = join(tmp, "stub-opencode")
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(join(tmp, "argv.txt"))}\n`)
    chmodSync(bin, 0o755)
    const logPath = join(tmp, "supervisor.log")
    const s = spawnSupervisor({ brief: "BRIEF", cwd: tmp, logPath, bin, outDir: join(tmp, "run") })
    if (s.ok) {
      try {
        process.kill(s.pid, "SIGKILL")
      } catch {
        /* already gone */
      }
    }
    const watcher = readFileSync(`${logPath}.watch`, "utf8")
    const brief = readFileSync(`${logPath}.brief`, "utf8")

    // every path the supervisor waits on
    const polled = new Set<string>()
    for (const m of watcher.matchAll(/\[ ! -f "\$OUT([^"]*)" \]/g)) polled.add(m[1].replace(/^\//, ""))
    for (const m of brief.matchAll(/([A-Za-z0-9_.-]*\/)*data\/review\/[A-Za-z0-9_.-]+\.json/g)) polled.add(m[0])
    assert.ok(polled.size > 0, "the supervisor must wait on something (the watcher/brief spell it)")

    const stages = chainStages()
    const last = stages.length - 1
    for (const rel of polled) {
      const writers = stages
        .map((s2, i) => ({ s2, i }))
        .filter(({ s2 }) => s2.hook && existsSync(join(PR_REVIEW, s2.hook)) && writesSeat(readFileSync(join(PR_REVIEW, s2.hook), "utf8"), rel))
      assert.ok(
        writers.length > 0,
        `the seat ${rel} must be written by some stage of the chain (writers found: none)`,
      )
      for (const w of writers) {
        assert.equal(
          w.i,
          last,
          `the supervisor waits on ${rel}, which the '${w.s2.id}' stage writes — but the chain continues (${stages
            .slice(w.i + 1)
            .map((x) => x.id)
            .join(", ")}) after it: the wait resolves while workers are still working, so the PR comment is composed before the feedback map exists and the outcome is announced before the merge ran`,
        )
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
