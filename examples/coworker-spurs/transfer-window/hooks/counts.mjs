// counts — the report for the transfer-window spur: members, the
// messages they exchanged, and whether the deal memo landed.
import { readdirSync, readFileSync, existsSync } from "node:fs"

const table = JSON.parse(readFileSync(process.argv[2], "utf8"))
let messages = 0
try {
  messages = readdirSync("messages").filter((f) => f.endsWith(".json")).length
} catch {}
let deal = 0
try {
  const memo = readdirSync("sandboxes/finance").find((f) => f === "deal-done.md")
  if (memo) deal = 1
} catch {}
console.log(JSON.stringify({
  members: table.filter((r) => !r.unit || r.unit !== "exchange").length,
  messages,
  deal,
}))
