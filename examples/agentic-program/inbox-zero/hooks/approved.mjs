import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import { join } from "node:path"

const cwd = process.cwd()
const verdictPath = join(cwd, "inbox", "verdict.json")
if (!existsSync(verdictPath)) process.exit(0)
const archive = () => {
  mkdirSync(join(cwd, "inbox", "verdicts"), { recursive: true })
  renameSync(verdictPath, join(cwd, "inbox", "verdicts", `${Date.now()}.json`))
}
let verdict = null
try {
  verdict = JSON.parse(readFileSync(verdictPath, "utf8"))
} catch {}
if (!verdict) process.exit(0)
if (verdict.approve === true) {
  archive()
  console.log("done")
} else if (Array.isArray(verdict.reject)) {
  // rejection is requeue through the world: the ticket is no longer
  // finished (its reply is no longer sent, no longer graded), the
  // signal names it again, and tick reopens the wave for a redraft
  for (const id of verdict.reject) {
    rmSync(join(cwd, "units", id, "reply-sent"), { force: true })
    rmSync(join(cwd, "units", id, "graded"), { force: true })
  }
  archive()
}
