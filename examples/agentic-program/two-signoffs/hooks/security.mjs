import { existsSync } from "node:fs"
import { join } from "node:path"
if (existsSync(join(process.cwd(), "signoffs", "security.md"))) console.log("done")
