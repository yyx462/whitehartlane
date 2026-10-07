import { readFileSync } from "node:fs"
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"))
console.log(JSON.stringify({
  sections: rows.length,
  delivered: rows.filter((r) => r.pass).length,
}))
