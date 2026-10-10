// counts — the program names the report's counts (RAILS.md): members
// and the messages they exchanged.
import { readdirSync, readFileSync } from "node:fs"

const table = JSON.parse(readFileSync(process.argv[2], "utf8"))
let messages = 0
try {
  messages = readdirSync("messages").filter((f) => f.endsWith(".json")).length
} catch {}
console.log(JSON.stringify({ members: table.filter((r) => !r.unit || r.unit !== "exchange").length, messages }))
