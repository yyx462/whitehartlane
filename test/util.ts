import { cpSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const EXAMPLE = join(import.meta.dirname, "..", "examples", "three-lookups")

export async function copyExample(prefix = "agentic-os-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cpSync(EXAMPLE, dir, { recursive: true })
  return dir
}
