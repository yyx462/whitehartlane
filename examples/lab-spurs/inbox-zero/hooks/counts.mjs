import { readFileSync } from "node:fs"
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"))
// a requeued ticket finished_by twice (rejected row, then its redraft);
// the counts name the tickets, not the attempts
const byId = new Map(rows.map((r) => [r.unit, r]))
const tickets = [...byId.values()]
console.log(JSON.stringify({
  tickets: tickets.length,
  replied: tickets.filter((r) => r.pass).length,
  failed: tickets.filter((r) => !r.pass).length,
}))
