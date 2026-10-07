import { existsSync } from "node:fs"
import { join } from "node:path"
// a gate reads the world and prints done, or prints nothing yet
if (existsSync(join(process.cwd(), "review-approved"))) console.log("done")
