import assert from "node:assert/strict"
import test from "node:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { formatGate, promoteFindings, submitPr } from "../src/doors/promote.ts"
import type { JobRecord } from "../src/adapters/store.ts"

function job(over: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "j-1",
    sid: "s-1",
    stoodUpBy: "first_mate",
    workflow: "fan-out",
    task: "add --dry-run",
    dir: "/tmp/run",
    state: "retired",
    created: "t",
    panes: [],
    worktree: "/repo/dry-run",
    receipt: {
      panesRemaining: 0,
      panesTotal: 2,
      unitsDone: 2,
      unitsFailed: 0,
      status: "done",
      finished: "t",
    },
    ...over,
  }
}

test("a clean retired job is a ship; a canary stop is a finding", () => {
  assert.deepEqual(promoteFindings({ job: job(), worktreeExists: true, hasWork: true }), [])
  const stopped = promoteFindings({
    job: job({ receipt: { ...job().receipt!, status: "canary-stopped" } }),
    worktreeExists: true,
    hasWork: true,
  })
  assert.match(stopped.map((f) => f.detail).join(" "), /not a ship/)
  const text = formatGate("j-1", stopped)
  assert.match(text, /nothing was pushed/)
  assert.match(formatGate("j-1", [], "https://example/pr/1"), /not a merge/)
})

test("a missing worktree or an empty diff stops the gate", () => {
  const gone = promoteFindings({ job: job(), worktreeExists: false, hasWork: false })
  assert.match(gone.map((f) => f.check).join(" "), /worktree/)
  const empty = promoteFindings({ job: job(), worktreeExists: true, hasWork: false })
  assert.match(empty.map((f) => f.detail).join(" "), /nothing ahead/)
})

// gwt #127 makes --seam REQUIRED on `gwt submit-pr`, and today's gwt
// rejects unknown flags — so promote PROBES before appending (same
// probe shape gwt uses on whl: --help | grep; receipt: the installed
// gwt's `submit-pr --help` exits 0 on stdout with no --seam, the
// seam-gate one prints `flag --seam "<one name>" (required)`). The
// seam VALUE is the Job id: one promote PR serves one Job, and an id
// can never read as two names — a prose title carrying " and " or a
// comma would be REFUSED by the #127 multi-name gate, and whl has no
// rename path (the title derives from the stored job.task).
function stubSubmit(name: string, help: "old" | "seam" | "crash"): { tmp: string; calls: string } {
  const tmp = mkdtempSync(join(tmpdir(), "whl-seam-"))
  const calls = join(tmp, "calls.txt")
  const helpBody =
    help === "seam"
      ? `echo 'flag --seam "<one name>"  (required) the ONE seam this branch serves'`
      : `echo 'usage: gwt submit-pr "<title>" "<body>" [base_branch]'`
  writeFileSync(
    join(tmp, name),
    [
      `#!/bin/sh`,
      `case "$1 $2" in`,
      `  "submit-pr --help")`,
      `    printf 'submit-pr --help\\n' >> ${JSON.stringify(calls)}`,
      help === "crash" ? `    exit 3` : `    ${helpBody}\n    exit 0`,
      `    ;;`,
      `esac`,
      `printf '%s\\n' "$@" >> ${JSON.stringify(calls)}`,
      `echo "https://github.com/foo/bar/pull/9"`,
      `exit 0`,
    ].join("\n") + "\n",
  )
  chmodSync(join(tmp, name), 0o755)
  return { tmp, calls }
}

test("submitPr appends --seam only when the probed gwt knows it (gwt #127)", () => {
  const arms: Array<{ help: "old" | "seam" | "crash"; want: string[] }> = [
    // old gwt: probe ran (logged), no --seam in the answer → old shape
    { help: "old", want: ["submit-pr --help", "submit-pr", "fix the watcher", "one purpose line"] },
    // a gwt whose --help dies → same old shape, the submit itself reports real failures
    { help: "crash", want: ["submit-pr --help", "submit-pr", "fix the watcher", "one purpose line"] },
    // seam-gate gwt: flag appended with the Job id as the one seam
    { help: "seam", want: ["submit-pr --help", "submit-pr", "fix the watcher", "one purpose line", "--seam", "j-77"] },
  ]
  const hadPath = process.env.PATH
  const hadSubmit = "AGENTIC_OS_SUBMIT" in process.env
  const oldSubmit = process.env.AGENTIC_OS_SUBMIT
  delete process.env.AGENTIC_OS_SUBMIT
  const tmps: string[] = []
  try {
    for (const arm of arms) {
      const { tmp, calls } = stubSubmit("gwt", arm.help)
      tmps.push(tmp)
      process.env.PATH = `${tmp}:${hadPath}`
      const out = submitPr(tmp, "fix the watcher", "one purpose line", "j-77")
      assert.equal(out, "https://github.com/foo/bar/pull/9")
      assert.deepEqual(
        readFileSync(calls, "utf8").split("\n").filter(Boolean),
        arm.want,
        `help=${arm.help}: the probe answer must decide the --seam append`,
      )
    }
  } finally {
    process.env.PATH = hadPath
    if (hadSubmit) process.env.AGENTIC_OS_SUBMIT = oldSubmit
    else delete process.env.AGENTIC_OS_SUBMIT
    for (const t of tmps) rmSync(t, { recursive: true, force: true })
  }
})

test("submitPr: a foreign AGENTIC_OS_SUBMIT bin keeps [title, body] and is never probed", () => {
  // even a help that knows --seam must not leak into a non-gwt submit
  // tool's call — the probe is gwt's contract, not everybody's
  const { tmp, calls } = stubSubmit("submit-other", "seam")
  const hadSubmit = "AGENTIC_OS_SUBMIT" in process.env
  const oldSubmit = process.env.AGENTIC_OS_SUBMIT
  try {
    process.env.AGENTIC_OS_SUBMIT = join(tmp, "submit-other")
    const out = submitPr(tmp, "fix the watcher", "one purpose line", "j-77")
    assert.equal(out, "https://github.com/foo/bar/pull/9")
    assert.deepEqual(
      readFileSync(calls, "utf8").split("\n").filter(Boolean),
      ["fix the watcher", "one purpose line"],
      "the foreign-bin contract is [title, body] — no submit-pr, no probe, no --seam",
    )
  } finally {
    if (hadSubmit) process.env.AGENTIC_OS_SUBMIT = oldSubmit
    else delete process.env.AGENTIC_OS_SUBMIT
    rmSync(tmp, { recursive: true, force: true })
  }
})
