import { readFileSync } from "node:fs"
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"))
console.log(JSON.stringify({
  units: rows.length,
  passed: rows.filter((r) => r.pass).length,
  failed: rows.filter((r) => !r.pass).length,
}))
