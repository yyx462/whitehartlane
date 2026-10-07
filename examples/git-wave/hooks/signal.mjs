import { readFileSync } from "node:fs"
import { join } from "node:path"
// the wave source is the program's choice: here protocol.json, read by
// the program's own command — it could be `gh pr list --json` instead
try {
  process.stdout.write(readFileSync(join(process.cwd(), "protocol.json"), "utf8"))
} catch {}
