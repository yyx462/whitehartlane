// counts — the room's report: members, messages, and the signing.
import { readdirSync, readFileSync, existsSync } from "node:fs"

const table = JSON.parse(readFileSync(process.argv[2], "utf8"))
let messages = 0
try {
  messages = readdirSync("messages").filter((f) => f.endsWith(".json")).length
} catch {}
let signings = 0
try {
  signings = readdirSync("sandboxes/professor/signing").filter((f) => f.endsWith(".md")).length
} catch {}
console.log(JSON.stringify({
  members: table.filter((r) => !r.unit || r.unit !== "exchange").length,
  messages,
  signings,
}))
