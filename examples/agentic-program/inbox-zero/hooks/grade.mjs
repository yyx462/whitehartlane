import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const cwd = process.cwd()
const id = process.argv[2]
const replyPath = join(cwd, "units", id, "reply.md")
let pass = false
let row = "missing"
if (existsSync(replyPath)) {
  const reply = readFileSync(replyPath, "utf8")
  if (reply.trim().length >= 20 && reply.includes(id)) {
    pass = true
    row = "replied"
  } else {
    row = "thin"
  }
}
// the graded marker settles the ticket in the signal's eyes; the
// human verdict is the recovery path, not a regrade
mkdirSync(join(cwd, "units", id), { recursive: true })
writeFileSync(join(cwd, "units", id, "graded"), "")
console.log(row)
process.exit(pass ? 0 : 1)
