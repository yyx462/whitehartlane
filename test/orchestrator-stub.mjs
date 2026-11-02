// the suite-wide orchestrator stub (2026-10-30, the leaked-lens receipt):
// a test that drives the review/run verbs without its own
// AGENTIC_OS_ORCHESTRATOR used to spawn REAL workflows — real lens
// panes in herdr, grinding against fixture dirs the test had already
// deleted (two live "reviewer sessions" the user could see). The npm
// test script pins this stub as the DEFAULT orchestrator door: any
// test may override it with its own stub; nobody accidentally levies.
// It keeps the door's one observable contract doctor probes for: a
// program-less dir is refused BY NAME.
import { appendFileSync, existsSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
const dir = process.argv[2]
if (!dir || !existsSync(join(dir, "workflow.toml"))) {
  console.error("fatal: no workflow.toml")
  process.exit(1)
}
const log = join(process.env.AGENTIC_OS_HOME ?? join(homedir(), ".local", "share", "agentic-os"), "test-orchestrator-calls.log")
try {
  appendFileSync(log, `${new Date().toISOString()} ${process.argv.slice(2).join(" ")}\n`)
} catch {
  /* the marker is a convenience, never a requirement */
}
