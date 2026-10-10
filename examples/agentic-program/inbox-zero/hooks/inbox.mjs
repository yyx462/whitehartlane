import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const cwd = process.cwd()
// the live mailbox wins; the staged seed is the demo fallback
const mailbox = existsSync(join(cwd, "inbox")) ? "inbox" : existsSync(join(cwd, "data", "inbox")) ? join("data", "inbox") : null
if (existsSync(join(cwd, "inbox", "STOP"))) {
  console.log(JSON.stringify({ stop: true }))
  process.exit(0)
}
if (!mailbox) process.exit(0)
// the signal NAMES the wave (like protocol.json does): a ticket stays
// in it until its reply is both sent and graded — silence before that
// would leave the wave unable to close
const units = []
for (const file of readdirSync(join(cwd, mailbox)).sort()) {
  if (!file.endsWith(".ticket")) continue
  const id = `t${file.replace(/\.ticket$/, "")}`
  const home = join(cwd, "units", id)
  const finished = existsSync(join(home, "reply-sent")) && existsSync(join(home, "graded"))
  if (finished) continue
  units.push({
    id,
    brief: [
      "A support ticket arrived. Body (verbatim):",
      readFileSync(join(cwd, mailbox, file), "utf8").trim(),
      `Draft the customer reply. Write it to units/${id}/reply.md.`,
      `Reference the ticket id ${id}. Sign as 'Support'.`,
    ].join("\n"),
  })
}
if (units.length > 0) console.log(JSON.stringify({ units }))
