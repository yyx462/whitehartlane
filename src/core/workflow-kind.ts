export type WorkflowKind = "fan-out" | "lab" | "coworker"

export function workflowKind(toml: string): WorkflowKind {
  const named = toml.match(/^\s*kind\s*=\s*"([^"]+)"/m)?.[1]
  if (named === "lab" || named === "fan-out" || named === "coworker") return named
  if (named) throw new Error(`workflow.kind must be fan-out, lab, or coworker: ${named}`)
  if (/^\s*live\s*=\s*true\s*$/m.test(toml)) return "lab"
  return "fan-out"
}

// The one runner door: every kind spawns bin/orchestrator, which picks
// the engine in-process (src/engine.ts) — the kind→bin mapping is gone.
