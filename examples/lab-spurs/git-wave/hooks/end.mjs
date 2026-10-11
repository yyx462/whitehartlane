import { existsSync } from "node:fs"
import { join } from "node:path"
const id = process.argv[2]
if (existsSync(join(process.cwd(), "units", id, "result.md"))) console.log("done")
