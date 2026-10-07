import { existsSync } from "node:fs"
import { join } from "node:path"
// prints done only when the reply has been sent; silence = still working
if (existsSync(join(process.cwd(), "units", process.argv[2], "reply-sent"))) console.log("done")
