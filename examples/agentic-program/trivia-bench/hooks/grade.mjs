import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const cwd = process.cwd()
const id = process.argv[2]
const normalize = (s) => s.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ")
let expected = null
try {
  expected = JSON.parse(readFileSync(join(cwd, "key.json"), "utf8"))[id] ?? null
} catch {}
const resultPath = join(cwd, "units", id, "result.md")
const got = existsSync(resultPath) ? normalize(readFileSync(resultPath, "utf8").split("\n")[0] ?? "") : ""
const pass = expected !== null && got !== "" && got === normalize(expected)
console.log(pass ? "right" : `wrong: ${got.slice(0, 50) || "no answer"}`)
process.exit(pass ? 0 : 1)
