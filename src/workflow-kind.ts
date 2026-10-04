export type WorkflowKind = "fan-out" | "lab"

export function workflowKind(toml: string): WorkflowKind {
  const named = toml.match(/^\s*kind\s*=\s*"([^"]+)"/m)?.[1]
  if (named === "lab" || named === "fan-out") return named
  if (named) throw new Error(`workflow.kind must be fan-out or lab: ${named}`)
  if (/^\s*live\s*=\s*true\s*$/m.test(toml)) return "lab"
  return "fan-out"
}

export function orchestratorBin(kind: WorkflowKind): string {
  return kind === "lab" ? "lab-orchestrator" : "fan-out-orchestrator"
}
