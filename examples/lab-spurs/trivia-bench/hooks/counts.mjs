import { readFileSync } from "node:fs"
const rows = JSON.parse(readFileSync(process.argv[2], "utf8"))
const right = rows.filter((r) => r.pass).length
console.log(JSON.stringify({
  questions: rows.length,
  right,
  wrong: rows.length - right,
  score: rows.length === 0 ? 0 : Math.round((100 * right) / rows.length),
}))
