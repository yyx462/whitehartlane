import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

// INV-4 (a claim is a measurement) — two lines the diff itself added
// promise this tool works where it is pointed:
//   templates/pr-review/README.md: "scripts/review-trace.mjs re-traces
//   any machine"
//   bin/whitehartlane review --help: "trace past runs: node
//   scripts/review-trace.mjs"
// The tracer opens the sessions dir unguarded (scripts/review-trace.mjs
// `for (const sid of readdirSync(AOS))`): on any machine where no run
// has landed yet — day one after install, or a fresh AGENTIC_OS_HOME —
// readdirSync throws a raw ENOENT stack and the tool exits nonzero
// instead of printing an empty report. The r13 receipt (tests-3: "hard-
// coding the legacy disk crashed with ENOENT on the default layout")
// fixed the ROOT decision; the sessions/ subdir underneath it was left
// holding the same class. A first-run operator following the manual's
// own pointer gets a stack trace, not a table.
test("review-trace on a machine with no runs prints an empty report, not a stack trace", () => {
  const script = join(ROOT, "scripts", "review-trace.mjs")
  const runIt = (home: string) =>
    spawnSync(process.execPath, [script, "--json"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, AGENTIC_OS_HOME: "" },
    })

  // shape 1: a machine where whl has never written anything
  const bare = mkdtempSync(join(tmpdir(), "whl-t9-bare-"))
  try {
    const r = runIt(bare)
    assert.equal(
      r.status,
      0,
      `INV-4: the diff's own README promises review-trace.mjs "re-traces any machine", but on a machine ` +
        `with zero runs it crashes: exit=${r.status}, stderr starts: ` +
        `${(r.stderr ?? "").split("\n").slice(0, 2).join(" | ")} — the manual's own pointer ` +
        `("trace past runs: node scripts/review-trace.mjs") hands a first-run operator a stack trace`,
    )
    const report = JSON.parse(r.stdout ?? "{}")
    assert.deepEqual(report.jobs, [], "no runs — an empty jobs table is the honest report")
  } finally {
    rmSync(bare, { recursive: true, force: true })
  }

  // shape 2: the trace root exists but no session ever landed (the
  // r13-fixed root decision passes; the sessions/ subdir still throws)
  const rootOnly = mkdtempSync(join(tmpdir(), "whl-t9-root-"))
  try {
    mkdirSync(join(rootOnly, ".local", "share", "whitehartlane"), { recursive: true })
    const r = runIt(rootOnly)
    assert.equal(
      r.status,
      0,
      `INV-4: the r13 fix made traceRoot() resolve the default disk, but the sessions/ subdir under it is ` +
        `still opened unguarded — exit=${r.status}, stderr starts: ` +
        `${(r.stderr ?? "").split("\n").slice(0, 2).join(" | ")}`,
    )
    const report = JSON.parse(r.stdout ?? "{}")
    assert.deepEqual(report.jobs, [], "no sessions — an empty jobs table is the honest report")
  } finally {
    rmSync(rootOnly, { recursive: true, force: true })
  }
})
