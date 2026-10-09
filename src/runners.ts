// The runner seam: every external CLI dial (shep, herdr — today local
// panes, tomorrow maybe remote machines) funnels through one runner.
// The Rail injects these; the CLI doors reuse them. When the substrate
// changes, this module is the swap point — nothing else dials out.
import { execFileSync } from "node:child_process"

export type RunnerResult = { status: number; stdout: string }

export function defaultRunner(cmd: string): (args: string[]) => RunnerResult {
  return (args) => {
    try {
      const stdout = execFileSync(cmd, args, { encoding: "utf8", timeout: 90_000 })
      return { status: 0, stdout }
    } catch (err) {
      return { status: typeof err.status === "number" ? err.status : 1, stdout: err.stdout ?? "" }
    }
  }
}

export function jsonAt<T>(out: string, pick: (data: never) => T): T | null {
  for (const line of out.split("\n").reverse()) {
    const t = line.trim()
    if (!t.startsWith("{")) continue
    try {
      return pick(JSON.parse(t) as never)
    } catch {
      // keep looking
    }
  }
  return null
}
